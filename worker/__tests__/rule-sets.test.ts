import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sakuradaiCourses } from "../../data/fictional/sakuradai/courses";
import { goldRules } from "../../data/fictional/sakuradai/gold-rules";
import handbook from "../../data/fictional/sakuradai/handbook.md?raw";
import { sakuradaiStudents } from "../../data/fictional/sakuradai/students";
import { evaluateStudent, type RuleSet } from "../../engine";
import {
  confirmResponseSchema,
  datasetsResponseSchema,
  latestProposalResponseSchema,
  overviewResponseSchema,
  proposalResponseSchema,
  type StoredProposal,
} from "../../shared/api";
import app from "../index";
import { resolveDataset, saveProposal } from "../ruleSets";
import { createTestDb } from "./testDb";

// 正解ルールを案に見立てて使う。製品の Claude には渡さない。
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

const ROLE = "教務職員A";

let env: { DB: D1Database };
let sqlite: ReturnType<typeof createTestDb>["sqlite"];

function post(path: string, body: unknown) {
  return app.request(
    path,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
  );
}

const confirm = (id: number, body: object = {}) =>
  post(`/api/proposals/${id}/confirm`, { respondent: ROLE, acceptedRuleIds: [], ...body });

const withdraw = (id: number) => post(`/api/proposals/${id}/withdraw`, { respondent: ROLE });

async function datasetList() {
  const res = await app.request("/api/datasets", undefined, env);
  return datasetsResponseSchema.parse(await res.json()).datasets;
}

function count(table: string) {
  return (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

beforeEach(() => {
  const created = createTestDb();
  env = { DB: created.db };
  sqlite = created.sqlite;
});

describe("ルール案の保存", () => {
  it("案を保存して番号を返し、あとから読める", async () => {
    const id = await saveProposal(env.DB, "sakuradai", handbook, proposal());
    const res = await app.request("/api/sources/sakuradai/proposals/latest", undefined, env);
    const body = latestProposalResponseSchema.parse(await res.json());
    expect(body.proposal?.proposalId).toBe(id);
    expect(body.proposal?.impacts?.length).toBe(goldRules.ambiguities.length);
  });

  it("大学ごとに最新の案を返す", async () => {
    await saveProposal(env.DB, "sakuradai", handbook, proposal());
    const latest = await saveProposal(env.DB, "sakuradai", handbook, proposal());
    await saveProposal(env.DB, "kamome", handbook, proposal());
    const res = await app.request("/api/sources/sakuradai/proposals/latest", undefined, env);
    expect(latestProposalResponseSchema.parse(await res.json()).proposal?.proposalId).toBe(latest);
  });

  it("案がなければ null を返す", async () => {
    const res = await app.request("/api/sources/sakuradai/proposals/latest", undefined, env);
    expect(latestProposalResponseSchema.parse(await res.json()).proposal).toBeNull();
  });

  it("DB がない環境では保存しない", async () => {
    expect(await saveProposal(undefined, "sakuradai", handbook, proposal())).toBeNull();
  });
});

describe("POST /api/sources/:id/proposals/recorded", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(["sakuradai", "kamome"])("API キーなしで %s の記録を読み込み、確定まで進める", async (id) => {
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);

    const res = await post(`/api/sources/${id}/proposals/recorded`, {});
    expect(res.status).toBe(200);
    const body = proposalResponseSchema.parse(await res.json());
    expect(body.recording?.model).toBeTruthy();
    expect(body.problems).toEqual([]);
    expect(body.impacts).not.toBeNull();

    // 読み込んだだけでは判定の対象にならない
    const before = await datasetList();
    expect(before.some(({ confirmation }) => confirmation)).toBe(false);

    const confirmed = await confirm(body.proposalId!);
    expect(confirmed.status).toBe(200);
    const { datasetId } = confirmResponseSchema.parse(await confirmed.json());
    expect((await datasetList()).map((dataset) => dataset.id)).toContain(datasetId);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("開き直しても記録の案だと分かる", async () => {
    await post("/api/sources/sakuradai/proposals/recorded", {});
    const res = await app.request("/api/sources/sakuradai/proposals/latest", undefined, env);
    expect(latestProposalResponseSchema.parse(await res.json()).proposal?.recording).toBeDefined();
  });

  it("対象がなければ 404 を返す", async () => {
    const res = await post("/api/sources/unknown/proposals/recorded", {});
    expect(res.status).toBe(404);
  });
});

describe("POST /api/proposals/:id/confirm", () => {
  it("確定すると判定の対象に加わり、全学生の判定に使える", async () => {
    const id = await saveProposal(env.DB, "sakuradai", handbook, proposal());
    const res = await confirm(id!);
    expect(res.status).toBe(200);
    const { datasetId } = confirmResponseSchema.parse(await res.json());

    const listed = (await datasetList()).find((dataset) => dataset.id === datasetId);
    expect(listed).toMatchObject({ problems: [], confirmation: { proposalId: id, respondent: ROLE } });
    expect(listed?.name).toContain("さくら台大学");

    const overview = await post(`/api/datasets/${datasetId}/overview`, { answers: {} });
    expect(overview.status).toBe(200);
    expect(overviewResponseSchema.parse(await overview.json()).summary.total).toBe(sakuradaiStudents.length);
  });

  it("確定前の案は判定の対象に入らない", async () => {
    const id = await saveProposal(env.DB, "sakuradai", handbook, proposal());
    expect((await datasetList()).some((dataset) => dataset.id === `ruleset-${id}`)).toBe(false);
    const res = await post(`/api/datasets/ruleset-${id}/overview`, { answers: {} });
    expect(res.status).toBe(404);
  });

  it("検査の問題が残る案は確定できない", async () => {
    const id = await saveProposal(env.DB, "sakuradai", handbook, proposal({ problems: ["問題"] }));
    expect((await confirm(id!)).status).toBe(422);
    expect(count("rule_set_confirmations")).toBe(0);
  });

  it("根拠の文が要項にない案は、保存された結果によらず確定できない", async () => {
    const id = await saveProposal(
      env.DB,
      "sakuradai",
      handbook,
      proposal({}, (rules) => {
        rules.graduation.sourceQuote = "要項にない文";
      }),
    );
    const res = await confirm(id!);
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain("要項にない文");
  });

  it("参照の切れた案は確定できない", async () => {
    const id = await saveProposal(
      env.DB,
      "sakuradai",
      handbook,
      proposal({}, (rules) => {
        rules.categories[0]!.groups = ["ない科目群"];
      }),
    );
    expect((await confirm(id!)).status).toBe(422);
  });

  it("検査用ケースに合わない値は、職員が認めても確定できない", async () => {
    const id = await saveProposal(
      env.DB,
      "sakuradai",
      handbook,
      proposal({}, (rules) => {
        rules.graduation.minYears = 3;
        rules.graduation.status = "needs_review";
      }),
    );
    const res = await confirm(id!, { acceptedRuleIds: ["graduation"] });
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain("T33");
  });

  it("要確認でないルールは認められない", async () => {
    const id = await saveProposal(env.DB, "sakuradai", handbook, proposal());
    expect((await confirm(id!, { acceptedRuleIds: ["graduation"] })).status).toBe(400);
  });

  it("実名に見える回答者を拒む", async () => {
    const id = await saveProposal(env.DB, "sakuradai", handbook, proposal());
    expect((await confirm(id!, { respondent: "山田太郎" })).status).toBe(400);
    expect(count("rule_set_confirmations")).toBe(0);
  });

  it("存在しない案は 404 を返す", async () => {
    expect((await confirm(999)).status).toBe(404);
  });

  it("確定の記録に回答者と日時と認めたルールを残す", async () => {
    const id = await saveProposal(
      env.DB,
      "sakuradai",
      handbook,
      proposal({}, (rules) => {
        rules.loadLimits[0]!.status = "needs_review";
      }),
    );
    await confirm(id!, { acceptedRuleIds: [goldRules.loadLimits[0]!.id] });
    expect(sqlite.prepare("SELECT * FROM rule_set_confirmations").all()).toEqual([
      expect.objectContaining({
        action: "confirm",
        respondent: ROLE,
        accepted_rule_ids: JSON.stringify([goldRules.loadLimits[0]!.id]),
      }),
    ]);
  });
});

describe("要確認のルール", () => {
  const needsReview = (rules: RuleSet) => {
    rules.graduation.status = "needs_review";
  };

  async function graduationStatus(acceptedRuleIds: string[]) {
    const id = await saveProposal(env.DB, "sakuradai", handbook, proposal({}, needsReview));
    await confirm(id!, { acceptedRuleIds });
    const dataset = await resolveDataset(env.DB, `ruleset-${id}`);
    const student = sakuradaiStudents.find(({ specialStatuses }) => specialStatuses.length === 0)!;
    const { judgments } = evaluateStudent(dataset!.rules, sakuradaiCourses, student, {});
    return judgments.find(({ kind }) => kind === "graduation")?.status;
  }

  it("認めなければ、確定後も職員確認のまま", async () => {
    expect(await graduationStatus([])).toBe("needs_staff");
  });

  it("職員が認めたものだけ判定に使う", async () => {
    expect(await graduationStatus(["graduation"])).not.toBe("needs_staff");
  });
});

describe("確定の取り消し", () => {
  it("取り消すと判定の対象から外れ、案は残る", async () => {
    const id = await saveProposal(env.DB, "sakuradai", handbook, proposal());
    await confirm(id!);
    expect((await withdraw(id!)).status).toBe(200);
    expect((await datasetList()).some((dataset) => dataset.id === `ruleset-${id}`)).toBe(false);
    expect(await resolveDataset(env.DB, `ruleset-${id}`)).toBeUndefined();
    expect(count("rule_sets")).toBe(1);
    expect(count("rule_set_confirmations")).toBe(2);
  });

  it("取り消したあと、もう一度確定できる", async () => {
    const id = await saveProposal(env.DB, "sakuradai", handbook, proposal());
    await confirm(id!);
    await withdraw(id!);
    expect((await confirm(id!)).status).toBe(200);
    expect((await datasetList()).some((dataset) => dataset.id === `ruleset-${id}`)).toBe(true);
  });

  it("確定していない案は取り消せない", async () => {
    const id = await saveProposal(env.DB, "sakuradai", handbook, proposal());
    expect((await withdraw(id!)).status).toBe(409);
  });
});

describe("確定ルールの扱い", () => {
  it("正解ルールの対象をそのまま残す", async () => {
    const id = await saveProposal(env.DB, "sakuradai", handbook, proposal());
    await confirm(id!);
    expect((await datasetList()).map(({ id: datasetId }) => datasetId)).toContain("sakuradai");
  });

  it("同じ大学の確定ルールは最新の1件だけを対象にする", async () => {
    const first = await saveProposal(env.DB, "sakuradai", handbook, proposal());
    const second = await saveProposal(env.DB, "sakuradai", handbook, proposal());
    await confirm(first!);
    await confirm(second!);
    const ids = (await datasetList()).map(({ id }) => id);
    expect(ids).toContain(`ruleset-${second}`);
    expect(ids).not.toContain(`ruleset-${first}`);
  });

  it("回答は確定ルールごとに記録し、正解ルールの回答と混ぜない", async () => {
    const id = await saveProposal(env.DB, "sakuradai", handbook, proposal());
    await confirm(id!);
    const ambiguity = goldRules.ambiguities[0]!;
    const answer = { ambiguityId: ambiguity.id, optionId: ambiguity.options[0]!.id, respondent: ROLE };
    expect((await post(`/api/datasets/ruleset-${id}/answers`, answer)).status).toBe(200);

    const read = async (datasetId: string) => {
      const res = await app.request(`/api/datasets/${datasetId}/answers`, undefined, env);
      return ((await res.json()) as { records: unknown[] }).records;
    };
    expect(await read(`ruleset-${id}`)).toHaveLength(1);
    expect(await read("sakuradai")).toHaveLength(0);
  });

  it("DB がない環境でも、正解ルールの対象は動く", async () => {
    const res = await app.request("/api/datasets");
    expect(res.status).toBe(200);
    expect(await resolveDataset(undefined, "ruleset-1")).toBeUndefined();
    expect((await resolveDataset(undefined, "sakuradai"))?.id).toBe("sakuradai");
  });

  it("不正な id は対象にならない", async () => {
    for (const id of ["ruleset-", "ruleset-abc", "ruleset-1;DROP", "constructor"]) {
      expect(await resolveDataset(env.DB, id)).toBeUndefined();
    }
  });
});
