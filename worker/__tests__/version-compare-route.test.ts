import { beforeEach, describe, expect, it } from "vitest";
import { goldRules } from "../../data/fictional/sakuradai/gold-rules";
import handbook from "../../data/fictional/sakuradai/handbook.md?raw";
import type { RuleSet } from "../../engine";
import { versionCompareResponseSchema, type StoredProposal } from "../../shared/api";
import app from "../index";
import { saveProposal } from "../ruleSets";
import { createTestDb } from "./testDb";

// 正解ルールを案に見立てて使う。製品の Claude には渡さない。
function proposal(change?: (rules: RuleSet) => void): StoredProposal {
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
  };
}

let env: { DB: D1Database };

beforeEach(() => {
  env = { DB: createTestDb().db };
});

function post(path: string, body: unknown) {
  return app.request(
    path,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
  );
}

const save = async (change?: (rules: RuleSet) => void) =>
  (await saveProposal(env.DB, "sakuradai", handbook, proposal(change)))!;
const confirm = (id: number) => post(`/api/proposals/${id}/confirm`, { respondent: "教務職員A", acceptedRuleIds: [] });

async function compare(id: number) {
  const res = await app.request(`/api/proposals/${id}/compare`, undefined, env);
  expect(res.status).toBe(200);
  return versionCompareResponseSchema.parse(await res.json());
}

const total = goldRules.graduation.totalCredits;

describe("GET /api/proposals/:id/compare（要項の版の比較。H25 の G。B39）", () => {
  it("同じ大学の一つ前の確定版と比べた、ルールの差分を返す", async () => {
    const first = await save();
    expect((await confirm(first)).status).toBe(200);
    const second = await save((rules) => {
      rules.graduation.totalCredits = total + 2;
    });

    const body = await compare(second);
    expect(body.base).toMatchObject({ version: first, respondent: "教務職員A" });
    expect(body.diff?.changed).toEqual([
      { item: "卒業要件", field: "totalCredits", before: String(total), after: String(total + 2) },
    ]);
  });

  it("確定版がなければ比べない", async () => {
    const first = await save();
    const second = await save();
    expect(await compare(second)).toEqual({ base: null, diff: null });
    expect(await compare(first)).toEqual({ base: null, diff: null });
  });

  it("確定を取り消した版とあとの版は比べる相手にしない", async () => {
    const first = await save();
    await confirm(first);
    const second = await save();
    await confirm(second);
    await post(`/api/proposals/${second}/withdraw`, { respondent: "教務職員A" });
    const third = await save();
    await confirm(third);

    expect((await compare(third)).base?.version).toBe(first);
    expect((await compare(first)).base).toBeNull();
  });

  it("ない案は 404", async () => {
    const res = await app.request("/api/proposals/999/compare", undefined, env);
    expect(res.status).toBe(404);
  });
});
