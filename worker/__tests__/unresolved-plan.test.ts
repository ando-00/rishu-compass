import { describe, expect, it } from "vitest";
import adviceRules from "../../data/fictional/advice-rules.md?raw";
import { kamomeCourses } from "../../data/fictional/kamome/courses";
import { goldRules as kamomeRules } from "../../data/fictional/kamome/gold-rules";
import { kamomeStudents } from "../../data/fictional/kamome/students";
import { sakuradaiCourses } from "../../data/fictional/sakuradai/courses";
import { goldRules } from "../../data/fictional/sakuradai/gold-rules";
import { sakuradaiStudents } from "../../data/fictional/sakuradai/students";
import { checkPlan, evaluateStudent, type Student } from "../../engine";
import { planCheckResponseSchema } from "../../shared/api";
import { createAdvisorTools, planningTarget } from "../advisor/tools";
import app from "../index";

const GATE = "gate-seminar";
const QUESTION = "seminar-credit-basis";

function gateStatus(student: Student, answers: Record<string, string>) {
  const { judgments } = evaluateStudent(goldRules, sakuradaiCourses, student, answers);
  return judgments.find(({ ruleId }) => ruleId === GATE)?.status;
}

// 履修中の演習Ⅰについて、第6条の読み方で結論が分かれる学生。
const split = sakuradaiStudents.filter(
  (student) =>
    student.specialStatuses.length === 0 &&
    student.studentYear === 3 &&
    student.records.some(({ course, result }) => course === "演習Ⅰ" && result === "enrolled") &&
    gateStatus(student, { [QUESTION]: "earned" }) === "satisfied" &&
    gateStatus(student, { [QUESTION]: "countable" }) !== "satisfied",
);
const student = split[0]!;

async function planCheck(plan: object[], answers: object) {
  const res = await app.request(`/api/datasets/sakuradai/plan-check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentId: student.id, plan, answers }),
  });
  return planCheckResponseSchema.parse(await res.json());
}

describe("未回答の履修条件を確定として扱わない（A2-1）", () => {
  it("対象の学生がいて、未回答の判定は職員確認である", () => {
    expect(split.length).toBeGreaterThan(0);
    expect(gateStatus(student, {})).toBe("needs_staff");
  });

  it("検査の注意は「満たしていない」と言い切らず、未確定と書く", async () => {
    const { warnings } = await planCheck([{ course: "日本語表現", term: "前期" }], {});
    expect(warnings.join("\n")).not.toContain("満たしていない");
    expect(warnings.join("\n")).toContain("未確定");
  });

  it("回答で満たさないと決まったときは「満たしていない」と書く", async () => {
    const { warnings } = await planCheck([{ course: "日本語表現", term: "前期" }], {
      [QUESTION]: "countable",
    });
    expect(warnings.join("\n")).toContain("満たしていない");
  });

  it("Claude へ渡す内容も未確定と書く", () => {
    const { tools } = createAdvisorTools({
      rules: goldRules,
      courses: sakuradaiCourses,
      student,
      answers: {},
      adviceRules,
    });
    const output = tools.find(({ name }) => name === "check_requirements")!.run({});
    expect(output).not.toContain("満たしていない");
    expect(output).toContain("未確定");
  });

  it("演習Ⅱの案は、未回答なら職員確認で、読み方が決まれば結果が分かれる", async () => {
    const plan = [{ course: "演習Ⅱ", term: "通年" }];
    expect((await planCheck(plan, {})).status).toBe("needs_staff");
    expect((await planCheck(plan, { [QUESTION]: "countable" })).status).toBe("failed");
    expect((await planCheck(plan, { [QUESTION]: "earned" })).status).not.toBe("needs_staff");
  });
});

describe("進級が決まっていない学生の翌年次の案（A2-10）", () => {
  it("かもめ大学の1年次後期は、進級が未回答なら案を検査通過にしない", () => {
    const first = kamomeStudents.find(
      (candidate) =>
        candidate.studentYear === 1 && candidate.currentTerm === "後期" && candidate.specialStatuses.length === 0,
    )!;
    const input = { rules: kamomeRules, courses: kamomeCourses, student: first, answers: {} };
    const { target, assumptions } = planningTarget(input);
    expect(assumptions.promotions?.map(({ id }) => id)).toContain("gate-promotion");

    const taken = new Set(target.records.map(({ course }) => course));
    const course = kamomeCourses.find(({ name, offeredIn }) => !taken.has(name) && offeredIn === "前期")!;
    const check = checkPlan(kamomeRules, kamomeCourses, target, [{ course: course.name, term: "前期" }], {}, assumptions);
    expect(check.status).not.toBe("passed");
  });
});
