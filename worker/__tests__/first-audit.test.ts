// 監査の第1回（docs/AUDIT_LOG.md の A1）で見つけた誤りが、実際のデータと経路で戻らないことを確かめる。
import { describe, expect, it } from "vitest";
import adviceRules from "../../data/fictional/advice-rules.md?raw";
import { exampleCourses } from "../../data/fictional/example/courses";
import { exampleRules } from "../../data/fictional/example/rules";
import { sakuradaiCourses } from "../../data/fictional/sakuradai/courses";
import { goldRules } from "../../data/fictional/sakuradai/gold-rules";
import { sakuradaiStudents } from "../../data/fictional/sakuradai/students";
import { evaluateStudent } from "../../engine";
import { makeStudent, passed } from "../../engine/__tests__/helpers";
import { overviewResponseSchema, planCheckResponseSchema } from "../../shared/api";
import { adviseStudent, type AdvisorLoop } from "../advisor/advise";
import { createAdvisorTools, draftProblem, type AdvisorInput } from "../advisor/tools";
import app from "../index";

const SIX = ["S0030", "S0034", "S0182", "S0206", "S0214", "S0290"];
const USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

function post(path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function overview(answers: Record<string, string>) {
  const res = await post("/api/datasets/sakuradai/overview", { answers });
  return overviewResponseSchema.parse(await res.json());
}

describe("さくら台の全学生の集計（A1-1、A1-3）", () => {
  const ambiguity = goldRules.ambiguities[0]!;

  it("2年次の後期に演習Ⅰの条件を満たせない6人は、どの読み方でも延期見込みになる", () => {
    for (const id of SIX) {
      const student = sakuradaiStudents.find((candidate) => candidate.id === id)!;
      for (const answers of [{}, ...ambiguity.options.map((o) => ({ [ambiguity.id]: o.id }))]) {
        const { judgments } = evaluateStudent(goldRules, sakuradaiCourses, student, answers);
        expect(judgments.find((j) => j.kind === "graduation")?.status).toBe("delay_risk");
      }
    }
  });

  it("どの読み方でも声かけになる学生は、未回答でも一覧から落とさない", async () => {
    const before = await overview({});
    const listed = new Set(before.outreach.map((entry) => entry.studentId));
    for (const option of ambiguity.options) {
      const after = await overview({ [ambiguity.id]: option.id });
      const contact = after.outreach.filter((entry) => entry.kind === "contact");
      const dropped = contact.filter(({ studentId }) => {
        const always = before.unanswered[0]?.affectedStudentIds.includes(studentId);
        return !always && !listed.has(studentId);
      });
      expect(dropped).toEqual([]);
    }
  });

  it("回答の前後で状態が変わる学生は、影響人数に含まれる", async () => {
    const before = await overview({});
    const states = new Map(before.students.map(({ id, state }) => [id, state]));
    for (const option of ambiguity.options) {
      const after = await overview({ [ambiguity.id]: option.id });
      const moved = after.students.filter(({ id, state }) => states.get(id) !== state).map(({ id }) => id);
      expect(moved.length).toBeGreaterThan(0);
      expect(before.unanswered[0]?.affectedStudentIds).toEqual(expect.arrayContaining(moved));
    }
  });

  it("「対応なし」の学生は、どの読み方でも職員確認と声かけが残らない", async () => {
    const before = await overview({});
    const clear = before.students.filter((student) => student.state === "clear");
    expect(clear.length).toBeGreaterThan(0);
    for (const { id } of clear) {
      const student = sakuradaiStudents.find((candidate) => candidate.id === id)!;
      for (const option of ambiguity.options) {
        const { judgments } = evaluateStudent(goldRules, sakuradaiCourses, student, {
          [ambiguity.id]: option.id,
        });
        expect(judgments.every((j) => j.status !== "needs_staff" && !j.needsContact)).toBe(true);
      }
    }
  });
});

describe("画面の検査の前提（A1-11）", () => {
  it("案の作成と同じく翌年度の案として検査する", async () => {
    const student = sakuradaiStudents.find(({ id }) => id === "S0003")!;
    const res = await post("/api/datasets/sakuradai/plan-check", {
      studentId: student.id,
      plan: [{ course: "演習Ⅱ", term: "通年" }],
      answers: { [goldRules.ambiguities[0]!.id]: goldRules.ambiguities[0]!.options[0]!.id },
    });
    const check = planCheckResponseSchema.parse(await res.json());
    expect(check.issues.map((issue) => issue.code)).not.toContain("WRONG_YEAR");
  });
});

describe("Claude の文章の検査（A1-6、A1-9）", () => {
  it.each([
    "あと十二単位が必要です。",
    "残りの単位は12です。",
    "必修があと3科目残っています。",
    "GPAは2.5と計算しました。",
    "卒業は不可能です。",
    "このままでは卒業は無理です。",
    "今年度の卒業は難しいです。",
    "進級できません。",
    "留年の見込みです。",
    "不足は36単位です。",
    "卒業できません。",
  ])("「%s」を止める", (text) => {
    expect(draftProblem(text)).not.toBeNull();
  });

  it.each([
    "履修について一緒に確認したいことがあります。",
    "1科目でも落とすと卒業の時期に影響する可能性があります。",
    "専門教育の必修に不足があります。",
    "卒業までの履修計画を窓口で確認させてください。",
  ])("「%s」は止めない", (text) => {
    expect(draftProblem(text)).toBeNull();
  });

  const input: AdvisorInput = {
    rules: exampleRules,
    courses: exampleCourses,
    student: makeStudent({ studentYear: 2, records: passed(["入門A"]) }),
    answers: { "ambiguity-seminar-credits": "include" },
    adviceRules,
  };

  it("職員に回す理由に単位数や断定があれば受け付けず、直せば受け付ける", () => {
    const { tools, state } = createAdvisorTools(input);
    const escalate = tools.find(({ name }) => name === "escalate_to_staff")!;
    const rejected = JSON.parse(escalate.run({ reason: "不足は36単位で卒業できません。" }));
    expect(rejected.accepted).toBe(false);
    expect(state.escalated).toBeNull();
    escalate.run({ reason: "要項の外の事情があるため、職員に確認をお願いします。" });
    expect(state.escalated).toContain("要項の外");
  });

  it("理由を直さずに終わると、Claude の文章を画面へ返さない", async () => {
    const loop: AdvisorLoop = async ({ tools }) => {
      const escalate = tools.find(({ name }) => name === "escalate_to_staff")!;
      escalate.run({ reason: "不足は36単位で卒業できません。" });
      return { stopReason: "end_turn", iterations: 1, usage: USAGE };
    };
    const result = await adviseStudent(loop, input);
    expect(result.status).toBe("needs_staff");
    expect(JSON.stringify(result)).not.toContain("36単位");
  });
});
