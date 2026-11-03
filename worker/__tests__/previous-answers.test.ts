import { beforeEach, describe, expect, it } from "vitest";
import { goldRules } from "../../data/fictional/sakuradai/gold-rules";
import handbook from "../../data/fictional/sakuradai/handbook.md?raw";
import type { RuleSet } from "../../engine";
import { answerRecordsResponseSchema, type StoredProposal } from "../../shared/api";
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

const ID = "seminar-credit-basis";
const option = goldRules.ambiguities.find((ambiguity) => ambiguity.id === ID)!.options[0]!;

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

async function confirmed(change?: (rules: RuleSet) => void) {
  const id = (await saveProposal(env.DB, "sakuradai", handbook, proposal(change)))!;
  const res = await post(`/api/proposals/${id}/confirm`, { respondent: "教務職員A", acceptedRuleIds: [] });
  expect(res.status).toBe(200);
  return id;
}

const answer = (version: number, optionId: string | null, respondent = "教務職員B") =>
  post(`/api/datasets/ruleset-${version}/answers`, { ambiguityId: ID, optionId, respondent });

async function answers(datasetId: string) {
  const res = await app.request(`/api/datasets/${datasetId}/answers`, undefined, env);
  expect(res.status).toBe(200);
  return answerRecordsResponseSchema.parse(await res.json());
}

describe("前の版の回答を参考に出す（H25 の H。B38）", () => {
  it("同じ大学の前の版で、同じ ID の曖昧箇所に回答していれば、版、読み方、回答者、日時を出す", async () => {
    const first = await confirmed();
    expect((await answer(first, option.id)).status).toBe(200);
    const second = await confirmed();

    const { previous } = await answers(`ruleset-${second}`);
    expect(previous).toHaveLength(1);
    expect(previous[0]).toMatchObject({
      ambiguityId: ID,
      version: first,
      optionLabel: option.label,
      respondent: "教務職員B",
    });
    expect(Date.parse(previous[0]!.answeredAt)).not.toBeNaN();
  });

  it("新しい版には反映しない（回答は空のまま）", async () => {
    const first = await confirmed();
    await answer(first, option.id);
    const second = await confirmed();

    const { records } = await answers(`ruleset-${second}`);
    expect(records).toEqual([]);
    const overview = await post(`/api/datasets/ruleset-${second}/overview`, { answers: {} });
    expect(overview.status).toBe(200);
  });

  it("ID が新しい版にない曖昧箇所の回答は出さない", async () => {
    const first = await confirmed();
    await answer(first, option.id);
    // ID と、それを指す全ての参照を付け替える
    const second = await confirmed((rules) => {
      Object.assign(rules, JSON.parse(JSON.stringify(rules).replaceAll(`"${ID}"`, '"renamed"')));
    });

    expect((await answers(`ruleset-${second}`)).previous).toEqual([]);
  });

  it("前の版で取り消した回答は出さない", async () => {
    const first = await confirmed();
    await answer(first, option.id);
    await answer(first, null);
    const second = await confirmed();

    expect((await answers(`ruleset-${second}`)).previous).toEqual([]);
  });

  it("あとの版の回答は出さない", async () => {
    const first = await confirmed();
    const second = await confirmed();
    await answer(second, option.id);

    expect((await answers(`ruleset-${first}`)).previous).toEqual([]);
  });

  it("前の版が複数あれば、新しい版から順に、版ごとの今の回答を出す", async () => {
    const first = await confirmed();
    await answer(first, option.id, "教務職員A");
    const second = await confirmed();
    const other = goldRules.ambiguities.find((ambiguity) => ambiguity.id === ID)!.options[1]!;
    await answer(second, other.id, "教務職員C");
    const third = await confirmed();

    const { previous } = await answers(`ruleset-${third}`);
    expect(previous.map(({ version, optionLabel }) => [version, optionLabel])).toEqual([
      [second, other.label],
      [first, option.label],
    ]);
  });

  it("正解ルールと見本の対象には前の版がない", async () => {
    expect((await answers("sakuradai")).previous).toEqual([]);
    expect((await answers("example")).previous).toEqual([]);
  });
});
