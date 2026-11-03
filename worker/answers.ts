import { Hono, type Context } from "hono";
import {
  saveAnswerRequestSchema,
  type AnswerRecord,
  type AnswerRecordsResponse,
  type PreviousAnswer,
  type StoredProposal,
} from "../shared/api";
import type { Dataset } from "./datasets";
import { DATASET_PREFIX, resolveDataset } from "./ruleSets";

type Row = {
  ambiguity_id: string;
  option_id: string | null;
  respondent: AnswerRecord["respondent"];
  answered_at: string;
};

export const answerRoutes = new Hono<{ Bindings: Env }>();

// 回答が記録できないときに、回答したことにしない。
answerRoutes.onError((cause, c) => {
  console.error("回答の記録に失敗しました", cause.message);
  return c.json({ error: "回答を記録できませんでした。回答は反映していません。" }, 503);
});

function findDataset(c: Context) {
  return resolveDataset(c.env?.DB, c.req.param("id") ?? "");
}

function findOption(dataset: Dataset, ambiguityId: string, optionId: string) {
  return dataset.rules.ambiguities
    .find((ambiguity) => ambiguity.id === ambiguityId)
    ?.options.find((option) => option.id === optionId);
}

// 曖昧箇所ごとに最新の行を見る。取り消しと、今のルールにない古い回答は除く。
async function currentRecords(db: D1Database, dataset: Dataset): Promise<AnswerRecordsResponse> {
  const { results } = await db
    .prepare(
      `SELECT ambiguity_id, option_id, respondent, answered_at
       FROM ambiguity_answers
       WHERE id IN (SELECT MAX(id) FROM ambiguity_answers WHERE dataset_id = ?1 GROUP BY ambiguity_id)`,
    )
    .bind(dataset.id)
    .all<Row>();

  const records = results.flatMap(({ ambiguity_id, option_id, respondent, answered_at }) =>
    option_id !== null && findOption(dataset, ambiguity_id, option_id)
      ? [{ ambiguityId: ambiguity_id, optionId: option_id, respondent, answeredAt: answered_at }]
      : [],
  );
  return { records, history: await answerHistory(db, dataset), previous: await previousAnswers(db, dataset) };
}

// 同じ大学の前の版（番号の小さいルール案）で、今の版と同じ ID の曖昧箇所にした今の回答。取り消しは除く。
// 曖昧箇所の ID は変換のたびに付くので、ID が同じものだけを対応させる（H25）。反映はしない
async function previousAnswers(db: D1Database, dataset: Dataset): Promise<PreviousAnswer[]> {
  if (!dataset.confirmation || !dataset.sourceId) return [];
  const known = new Set(dataset.rules.ambiguities.map((ambiguity) => ambiguity.id));
  const { results: versions } = await db
    .prepare("SELECT id, proposal FROM rule_sets WHERE source_id = ?1 AND id < ?2 ORDER BY id DESC")
    .bind(dataset.sourceId, dataset.confirmation.proposalId)
    .all<{ id: number; proposal: string }>();

  const previous: PreviousAnswer[] = [];
  for (const version of versions) {
    const { rules } = JSON.parse(version.proposal) as StoredProposal;
    const { results } = await db
      .prepare(
        `SELECT ambiguity_id, option_id, respondent, answered_at
         FROM ambiguity_answers
         WHERE id IN (SELECT MAX(id) FROM ambiguity_answers WHERE dataset_id = ?1 GROUP BY ambiguity_id)`,
      )
      .bind(`${DATASET_PREFIX}${version.id}`)
      .all<Row>();
    for (const { ambiguity_id, option_id, respondent, answered_at } of results) {
      if (option_id === null || !known.has(ambiguity_id)) continue;
      const label = rules.ambiguities
        .find((ambiguity) => ambiguity.id === ambiguity_id)
        ?.options.find((option) => option.id === option_id)?.label;
      if (!label) continue;
      previous.push({ ambiguityId: ambiguity_id, version: version.id, optionLabel: label, respondent, answeredAt: answered_at });
    }
  }
  return previous;
}

// 回答の経過を新しい順に返す。今のルールにある曖昧箇所の行だけ。取り消しは optionId が null
async function answerHistory(db: D1Database, dataset: Dataset) {
  const known = new Set(dataset.rules.ambiguities.map((ambiguity) => ambiguity.id));
  const { results } = await db
    .prepare(
      `SELECT ambiguity_id, option_id, respondent, answered_at
       FROM ambiguity_answers WHERE dataset_id = ?1 ORDER BY id DESC`,
    )
    .bind(dataset.id)
    .all<Row>();
  return results
    .filter(({ ambiguity_id }) => known.has(ambiguity_id))
    .map(({ ambiguity_id, option_id, respondent, answered_at }) => ({
      ambiguityId: ambiguity_id,
      optionId: option_id,
      respondent,
      answeredAt: answered_at,
    }));
}

answerRoutes.get("/:id/answers", async (c) => {
  const dataset = await findDataset(c);
  if (!dataset) return c.json({ error: "データがありません" }, 404);
  return c.json(await currentRecords(c.env.DB, dataset));
});

answerRoutes.post("/:id/answers", async (c) => {
  const dataset = await findDataset(c);
  if (!dataset) return c.json({ error: "データがありません" }, 404);
  const parsed = saveAnswerRequestSchema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return c.json({ error: "回答の形式が正しくありません" }, 400);

  const { ambiguityId, optionId, respondent } = parsed.data;
  const known =
    optionId === null
      ? dataset.rules.ambiguities.some((ambiguity) => ambiguity.id === ambiguityId)
      : findOption(dataset, ambiguityId, optionId) !== undefined;
  if (!known) return c.json({ error: "回答の形式が正しくありません" }, 400);

  await c.env.DB.prepare(
    `INSERT INTO ambiguity_answers (dataset_id, ambiguity_id, option_id, respondent, answered_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(dataset.id, ambiguityId, optionId, respondent, new Date().toISOString())
    .run();
  return c.json(await currentRecords(c.env.DB, dataset));
});
