import { Hono } from "hono";
import { collectQuotes, computeImpacts, validateRuleSet, verifyQuotes, type RuleSet } from "../engine";
import { runCheckCases } from "../engine/checkCases";
import {
  confirmRequestSchema,
  withdrawRequestSchema,
  type ConfirmResponse,
  type LatestProposalResponse,
  type ProposalResponse,
  type Respondent,
  type StoredProposal,
} from "../shared/api";
import { createDataset, datasets, findRecordedProposal, findSource, type Dataset } from "./datasets";

type Source = NonNullable<ReturnType<typeof findSource>>;

type RuleSetRow = {
  id: number;
  source_id: string;
  handbook: string;
  proposal: string;
};

type ConfirmationRow = {
  rule_set_id: number;
  action: "confirm" | "withdraw";
  accepted_rule_ids: string;
  respondent: Respondent;
  confirmed_at: string;
};

const DATASET_PREFIX = "ruleset-";

export const ruleSetRoutes = new Hono<{ Bindings: Env }>();

ruleSetRoutes.onError((cause, c) => {
  console.error("ルール案の記録に失敗しました", cause.message);
  return c.json({ error: "ルール案を記録できませんでした。確定は反映していません。" }, 503);
});

async function loadRuleSet(db: D1Database, id: number) {
  const { results } = await db
    .prepare("SELECT id, source_id, handbook, proposal FROM rule_sets WHERE id = ?1")
    .bind(id)
    .all<RuleSetRow>();
  return results[0];
}

// 案ごとに最新の行を見る。取り消しの行が最新なら確定していない。
async function loadConfirmation(db: D1Database, ruleSetId: number) {
  const { results } = await db
    .prepare(
      `SELECT rule_set_id, action, accepted_rule_ids, respondent, confirmed_at
       FROM rule_set_confirmations WHERE rule_set_id = ?1 ORDER BY id DESC LIMIT 1`,
    )
    .bind(ruleSetId)
    .all<ConfirmationRow>();
  const latest = results[0];
  return latest?.action === "confirm" ? latest : undefined;
}

// 職員が認めたルールだけ、要確認を外す。
function acceptRules(rules: RuleSet, acceptedRuleIds: string[]): RuleSet {
  const accepted = new Set(acceptedRuleIds);
  const clear = <T extends { id: string; status?: "confirmed" | "needs_review" }>(rule: T): T => {
    if (!accepted.has(rule.id)) return rule;
    const { status: _status, ...rest } = rule;
    return rest as T;
  };
  return {
    ...rules,
    graduation: clear(rules.graduation),
    categories: rules.categories.map(clear),
    gates: rules.gates.map(clear),
    loadLimits: rules.loadLimits.map(clear),
    courseCountLimits: rules.courseCountLimits.map(clear),
    prerequisites: rules.prerequisites.map(clear),
    ...(rules.enrollment ? { enrollment: clear(rules.enrollment) } : {}),
  };
}

function needsReviewIds(rules: RuleSet) {
  return [
    rules.graduation,
    ...rules.categories,
    ...rules.gates,
    ...rules.loadLimits,
    ...rules.courseCountLimits,
    ...rules.prerequisites,
    ...(rules.enrollment ? [rules.enrollment] : []),
  ]
    .filter(({ status }) => status === "needs_review")
    .map(({ id }) => id);
}

function buildDataset(row: RuleSetRow, source: Source, confirmation: ConfirmationRow): Dataset {
  const { rules } = JSON.parse(row.proposal) as StoredProposal;
  const accepted = JSON.parse(confirmation.accepted_rule_ids) as string[];
  const name = `${source.name} 確定ルール 第${row.id}版`;
  return {
    ...createDataset(`${DATASET_PREFIX}${row.id}`, name, acceptRules(rules, accepted), source.courses, source.students),
    confirmation: {
      proposalId: row.id,
      respondent: confirmation.respondent,
      confirmedAt: confirmation.confirmed_at,
    },
  };
}

export async function resolveDataset(db: D1Database | undefined, id: string): Promise<Dataset | undefined> {
  const fixed = datasets.find((dataset) => dataset.id === id);
  if (fixed) return fixed;
  const match = /^ruleset-(\d+)$/.exec(id);
  if (!match || !db) return undefined;

  const ruleSetId = Number(match[1]);
  const row = await loadRuleSet(db, ruleSetId);
  const source = row && findSource(row.source_id);
  const confirmation = source && (await loadConfirmation(db, ruleSetId));
  return row && source && confirmation ? buildDataset(row, source, confirmation) : undefined;
}

// 同じ大学の確定ルールは最新の1件だけを判定の対象にする。
export async function listDatasets(db: D1Database | undefined): Promise<Dataset[]> {
  if (!db) return datasets;
  const { results } = await db
    .prepare(
      `SELECT r.id, r.source_id, r.handbook, r.proposal
       FROM rule_sets r
       JOIN rule_set_confirmations c ON c.rule_set_id = r.id
       WHERE c.action = 'confirm'
         AND c.id IN (SELECT MAX(id) FROM rule_set_confirmations GROUP BY rule_set_id)
       ORDER BY r.id DESC`,
    )
    .all<RuleSetRow>();

  const seen = new Set<string>();
  const confirmed: Dataset[] = [];
  for (const row of results) {
    const source = findSource(row.source_id);
    if (seen.has(row.source_id) || !source) continue;
    seen.add(row.source_id);
    const confirmation = await loadConfirmation(db, row.id);
    if (confirmation) confirmed.push(buildDataset(row, source, confirmation));
  }
  return [...confirmed, ...datasets];
}

// 費用をかけて作った案を失わないよう、保存できなくても案は画面に返す。
export async function saveProposal(
  db: D1Database | undefined,
  sourceId: string,
  handbook: string,
  proposal: StoredProposal,
) {
  if (!db) return null;
  try {
    const { results } = await db
      .prepare(
        `INSERT INTO rule_sets (source_id, handbook, proposal, created_at)
         VALUES (?1, ?2, ?3, ?4) RETURNING id`,
      )
      .bind(sourceId, handbook, JSON.stringify(proposal), new Date().toISOString())
      .all<{ id: number }>();
    return results[0]?.id ?? null;
  } catch (cause) {
    console.error("ルール案を保存できませんでした", cause instanceof Error ? cause.message : "");
    return null;
  }
}

export function toProposalResponse(
  proposal: StoredProposal,
  source: Source,
  proposalId: number | null,
): ProposalResponse {
  const { rules, problems } = proposal;
  return {
    ...proposal,
    proposalId,
    impacts: problems.length === 0 ? computeImpacts(rules, source.courses, source.students, {}) : null,
  };
}

ruleSetRoutes.get("/sources/:id/proposals/latest", async (c) => {
  const source = findSource(c.req.param("id"));
  if (!source) return c.json({ error: "データがありません" }, 404);
  const { results } = await c.env.DB.prepare(
    "SELECT id, source_id, handbook, proposal FROM rule_sets WHERE source_id = ?1 ORDER BY id DESC LIMIT 1",
  )
    .bind(source.id)
    .all<RuleSetRow>();

  const row = results[0];
  const body: LatestProposalResponse = {
    proposal: row ? toProposalResponse(JSON.parse(row.proposal) as StoredProposal, source, row.id) : null,
  };
  return c.json(body);
});

// Claude を呼ばず、同梱の記録を新しい案として保存する。確定の検査は通常の案と同じ。
ruleSetRoutes.post("/sources/:id/proposals/recorded", async (c) => {
  const source = findSource(c.req.param("id"));
  const recorded = source && findRecordedProposal(source.id);
  if (!source || !recorded) return c.json({ error: "記録がありません" }, 404);
  const proposalId = await saveProposal(c.env.DB, source.id, source.handbook, recorded);
  const body: ProposalResponse = toProposalResponse(recorded, source, proposalId);
  return c.json(body);
});

ruleSetRoutes.post("/proposals/:id/confirm", async (c) => {
  const row = await loadRuleSet(c.env.DB, Number(c.req.param("id")));
  const source = row && findSource(row.source_id);
  if (!row || !source) return c.json({ error: "ルール案がありません" }, 404);
  const parsed = confirmRequestSchema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return c.json({ error: "確定の形式が正しくありません" }, 400);

  const { respondent, acceptedRuleIds } = parsed.data;
  const { rules, problems } = JSON.parse(row.proposal) as StoredProposal;
  const reviewable = new Set(needsReviewIds(rules));
  if (!acceptedRuleIds.every((id) => reviewable.has(id))) {
    return c.json({ error: "認められないルールが含まれています" }, 400);
  }

  // 保存された結果を信じず、確定する内容をここで検査し直す。
  const accepted = acceptRules(rules, acceptedRuleIds);
  const remaining = [
    ...problems,
    ...validateRuleSet(accepted, source.courses),
    ...verifyQuotes(collectQuotes(accepted), row.handbook).map(
      ({ ruleId, sourceQuote }) => `${ruleId}: 根拠の文が要項にありません: ${sourceQuote}`,
    ),
    ...runCheckCases(accepted, source.courses, source.cases)
      .filter(({ outcome }) => outcome === "failed")
      .map(({ id, title, expected, actual }) => `${id} ${title}: 期待 ${expected}、結果 ${actual}`),
  ];
  if (remaining.length > 0) {
    return c.json({ error: "検査の問題が残っているので確定できません", problems: remaining }, 422);
  }

  await c.env.DB.prepare(
    `INSERT INTO rule_set_confirmations (rule_set_id, action, accepted_rule_ids, respondent, confirmed_at)
     VALUES (?1, 'confirm', ?2, ?3, ?4)`,
  )
    .bind(row.id, JSON.stringify(acceptedRuleIds), respondent, new Date().toISOString())
    .run();
  const body: ConfirmResponse = { datasetId: `${DATASET_PREFIX}${row.id}` };
  return c.json(body);
});

ruleSetRoutes.post("/proposals/:id/withdraw", async (c) => {
  const row = await loadRuleSet(c.env.DB, Number(c.req.param("id")));
  if (!row) return c.json({ error: "ルール案がありません" }, 404);
  const parsed = withdrawRequestSchema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return c.json({ error: "取り消しの形式が正しくありません" }, 400);
  if (!(await loadConfirmation(c.env.DB, row.id))) {
    return c.json({ error: "確定していないルール案です" }, 409);
  }

  await c.env.DB.prepare(
    `INSERT INTO rule_set_confirmations (rule_set_id, action, accepted_rule_ids, respondent, confirmed_at)
     VALUES (?1, 'withdraw', '[]', ?2, ?3)`,
  )
    .bind(row.id, parsed.data.respondent, new Date().toISOString())
    .run();
  return c.json({ ok: true });
});
