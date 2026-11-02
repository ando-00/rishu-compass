import { beforeEach, describe, expect, it } from "vitest";
import { goldRules } from "../../data/fictional/sakuradai/gold-rules";
import handbook from "../../data/fictional/sakuradai/handbook.md?raw";
import type { RuleSet } from "../../engine";
import type { StoredProposal } from "../../shared/api";
import app from "../index";
import { saveProposal } from "../ruleSets";
import { createTestDb } from "./testDb";

// 監査の第2.5回の A25-10。壊す検査ですり抜けた2つの守りの線を固定する。
// (1) 判定に結びつけられない質問が残る案は確定できない。(2) ルールに問題がある対象の判定は 422 で止まる。

function proposal(overrides: Partial<StoredProposal> = {}, change?: (rules: RuleSet) => void): StoredProposal {
  const rules = structuredClone(goldRules);
  change?.(rules);
  return {
    rules,
    notes: [],
    problems: [],
    runs: { requested: 3, succeeded: 3 },
    disagreements: [],
    extraQuestions: [],
    caseResults: [],
    attempts: [],
    ...overrides,
  };
}

let env: { DB: D1Database };
let sqlite: ReturnType<typeof createTestDb>["sqlite"];

function post(path: string, body: unknown) {
  return app.request(
    path,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
  );
}

beforeEach(() => {
  const created = createTestDb();
  env = { DB: created.db };
  sqlite = created.sqlite;
});

describe("確定の守りの線", () => {
  it("判定に結びつけられない質問が残る案は、他に問題がなくても確定できない", async () => {
    const extra = { clause: "第6条", sourceQuote: "本文", question: "どちらの読み方ですか。", options: ["A", "B"] };
    const id = await saveProposal(env.DB, "sakuradai", handbook, proposal({ extraQuestions: [extra] }));
    const res = await post(`/api/proposals/${id}/confirm`, { respondent: "教務職員A", acceptedRuleIds: [] });
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain("結びつけられない質問");
    const n = (sqlite.prepare("SELECT COUNT(*) AS n FROM rule_set_confirmations").get() as { n: number }).n;
    expect(n).toBe(0);
  });

  it("同じ案で質問がなければ確定できる（上の検査が質問だけを見ていること）", async () => {
    const id = await saveProposal(env.DB, "sakuradai", handbook, proposal());
    const res = await post(`/api/proposals/${id}/confirm`, { respondent: "教務職員A", acceptedRuleIds: [] });
    expect(res.status).toBe(200);
  });
});

describe("ルールに問題がある対象の判定", () => {
  it("確定の検査をすり抜けて問題が残った対象は、判定を 422 で止めて問題を示す", async () => {
    // 確定の経路は通らないので、記録を直接書いて「確定済みだが今の科目データでは参照が切れている」状態を作る
    const id = await saveProposal(
      env.DB,
      "sakuradai",
      handbook,
      proposal({}, (rules) => {
        rules.categories[0]!.groups = ["ない科目群"];
      }),
    );
    sqlite
      .prepare(
        `INSERT INTO rule_set_confirmations (rule_set_id, action, accepted_rule_ids, respondent, confirmed_at)
         VALUES (?, 'confirm', '[]', '教務職員A', ?)`,
      )
      .run(id, new Date().toISOString());
    const res = await post(`/api/datasets/ruleset-${id}/overview`, { answers: {} });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { problems?: string[] };
    expect(body.problems?.join("\n")).toContain("ない科目群");
  });
});
