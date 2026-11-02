import { beforeEach, describe, expect, it, vi } from "vitest";
import { exampleCourses } from "../../data/fictional/example/courses";
import { exampleRules } from "../../data/fictional/example/rules";
import { exampleStudents } from "../../data/fictional/example/students";
import { checkPlan, isDisplayablePlan, planningStudent } from "../../engine";
import { savedAdviceSchema } from "../../shared/advise";
import type { AdvisorLoop } from "../advisor/advise";
import { answersKey, recordAdvice } from "../advisor/records";
import app from "../index";
import { createTestDb } from "./testDb";

const ANSWERS = { "ambiguity-seminar-credits": "include" };
const OTHER_ANSWERS = { "ambiguity-seminar-credits": "exclude" };
const USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
const DRAFT = "履修について一緒に確認したいことがあります。";
const PLAN = [{ course: "専門01", term: "前期" as const }];

const excluded = exampleStudents.find((student) => student.specialStatuses.length > 0)!;
const planned = exampleStudents.find(
  (student) =>
    student.specialStatuses.length === 0 &&
    isDisplayablePlan(checkPlan(exampleRules, exampleCourses, planningStudent(student), PLAN, ANSWERS)),
)!;

const scripted = vi.hoisted(() => ({ loop: null as AdvisorLoop | null }));

vi.mock("../advisor/claude", () => ({ createAdvisorLoop: () => scripted.loop }));

function submitLoop(): AdvisorLoop {
  return async ({ tools }) => {
    tools.find(({ name }) => name === "submit_plan")!.run({ plan: PLAN, draft: DRAFT });
    return { stopReason: "end_turn", iterations: 1, usage: USAGE };
  };
}

function post(path: string, env: object, answers: object = ANSWERS) {
  return app.request(
    `/api/datasets/example/students/${path}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers }) },
    env,
  );
}

function insertRow(db: ReturnType<typeof createTestDb>, studentId: string, advice: object) {
  db.sqlite
    .prepare("INSERT INTO plans (dataset_id, student_id, answers, advice, created_at) VALUES (?, ?, ?, ?, ?)")
    .run("example", studentId, answersKey(ANSWERS), JSON.stringify(advice), "2026-11-02T00:00:00.000Z");
}

async function latest(studentId: string, env: object, answers?: object) {
  const res = await post(`${studentId}/advice/latest`, env, answers);
  expect(res.status).toBe(200);
  return savedAdviceSchema.parse(await res.json());
}

describe("履修案の記録", () => {
  let store: ReturnType<typeof createTestDb>;
  let allowed: object;

  beforeEach(() => {
    store = createTestDb();
    allowed = { ALLOW_CLAUDE: "true", ANTHROPIC_API_KEY: "test-key", DB: store.db };
    scripted.loop = submitLoop();
  });

  it("作った案と下書きを記録し、見せ直せる", async () => {
    const res = await post(`${planned.id}/advise`, allowed);
    const created = savedAdviceSchema.parse(await res.json());
    expect(created.advice).toMatchObject({ status: "passed", plan: [{ course: "専門01" }] });
    expect(created.recordedAt).not.toBeNull();

    const found = await latest(planned.id, allowed);
    expect(found).toEqual(created);
    expect(JSON.stringify(found.advice)).toContain(DRAFT);
  });

  it("職員に回した学生は理由を記録する", async () => {
    await post(`${excluded.id}/advise`, allowed);
    expect((await latest(excluded.id, allowed)).advice).toMatchObject({ status: "needs_staff" });
  });

  it("作り直すと行を増やし、最新の案を返す", async () => {
    await post(`${planned.id}/advise`, allowed);
    await post(`${planned.id}/advise`, allowed);
    const rows = store.sqlite.prepare("SELECT id FROM plans").all();
    expect(rows).toHaveLength(2);
  });

  it("回答が違えば、別の前提の案を返さない", async () => {
    await post(`${planned.id}/advise`, allowed);
    expect(await latest(planned.id, allowed, OTHER_ANSWERS)).toEqual({ advice: null, recordedAt: null });
  });

  it("今のルールの検査に通らない案は見せない", async () => {
    insertRow(store, planned.id, {
      status: "passed",
      plan: [{ course: "存在しない科目", term: "前期", credits: 2 }],
      totalCredits: 2,
      planningYear: 3,
      warnings: [],
      draft: DRAFT,
      iterations: 1,
    });
    expect(await latest(planned.id, allowed)).toEqual({ advice: null, recordedAt: null });
  });

  it("保存した単位の値を使わず、今の科目データから数え直す", async () => {
    insertRow(store, planned.id, {
      status: "passed",
      plan: [{ course: "専門01", term: "前期", credits: 99 }],
      totalCredits: 99,
      planningYear: 3,
      warnings: [],
      draft: DRAFT,
      iterations: 1,
    });
    expect((await latest(planned.id, allowed)).advice).toMatchObject({
      plan: [{ credits: 2 }],
      totalCredits: 2,
    });
  });

  it("検査に落ちて直した経過を記録から見せ直す", async () => {
    scripted.loop = async ({ tools }) => {
      tools.find(({ name }) => name === "validate_plan")!.run({ plan: [{ course: "存在しない科目", term: "前期" }] });
      tools.find(({ name }) => name === "submit_plan")!.run({ plan: PLAN, draft: DRAFT });
      return { stopReason: "end_turn", iterations: 2, usage: USAGE };
    };
    await post(`${planned.id}/advise`, allowed);
    expect((await latest(planned.id, allowed)).advice).toMatchObject({
      corrections: [{ stage: "plan", messages: [expect.stringContaining("存在しない科目")] }],
    });
  });

  it("経過を持たない前の記録も見せられる", async () => {
    insertRow(store, planned.id, {
      status: "passed",
      plan: [{ course: "専門01", term: "前期", credits: 2 }],
      totalCredits: 2,
      planningYear: 3,
      warnings: [],
      draft: DRAFT,
      iterations: 1,
    });
    expect((await latest(planned.id, allowed)).advice).toMatchObject({ corrections: [] });
  });

  it("記録を読むだけなら ALLOW_CLAUDE がなくても使える", async () => {
    await post(`${planned.id}/advise`, allowed);
    expect((await latest(planned.id, { DB: store.db })).advice).not.toBeNull();
  });

  it("D1 がなければ記録なしを返す", async () => {
    expect(await latest(planned.id, {})).toEqual({ advice: null, recordedAt: null });
  });

  it("記録に失敗しても案を返し、記録できなかったことが分かる", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    store.sqlite.exec("DROP TABLE plans");
    const res = await post(`${planned.id}/advise`, allowed);
    const created = savedAdviceSchema.parse(await res.json());
    expect(created.advice?.status).toBe("passed");
    expect(created.recordedAt).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("D1 がないと記録の失敗を返す", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const input = { rules: exampleRules, courses: exampleCourses, student: excluded, answers: ANSWERS };
    const advice = { status: "needs_staff" as const, reason: "確認", iterations: 0 };
    expect(await recordAdvice(undefined, "example", input, advice)).toBeNull();
    error.mockRestore();
  });

  it("回答の並びが違っても同じ回答として照合する", () => {
    expect(answersKey({ a: "1", b: "2" })).toBe(answersKey({ b: "2", a: "1" }));
    expect(answersKey({ a: "1" })).not.toBe(answersKey({ a: "2" }));
  });
});
