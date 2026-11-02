import { describe, expect, it } from "vitest";
import { exampleCourses } from "../../data/fictional/example/courses";
import { exampleRules } from "../../data/fictional/example/rules";
import { evaluateStudent } from "../evaluate";
import { computeImpact, computeImpacts } from "../impact";
import type { Student } from "../model";
import { listOutreach } from "../outreach";
import { checkPlan, isDisplayablePlan } from "../plan";
import { makeStudent, numberedNames, passed } from "./helpers";

const ID = "ambiguity-seminar-credits";
const records = passed(["入門A", "入門B", "基礎C", "基礎D", "基礎E", ...numberedNames("専門", 13)], 2);
const base = makeStudent({ studentYear: 3, records });

const conditions: [string, Student][] = [
  ...(["編入", "休学", "留学", "読替", "既修得認定"] as const).map(
    (status): [string, Student] => [status, { ...base, specialStatuses: [status] }],
  ),
  ["適用外の入学年度", { ...base, admissionYear: 2020 }],
  ["科目データにない科目", { ...base, records: [...records, ...passed(["不明な科目"], 2)] }],
];

describe.each(conditions)("%s", (_, student) => {
  const answers = { [ID]: "include" };

  it("evaluateStudent は全判定を職員確認にする", () => {
    const result = evaluateStudent(exampleRules, exampleCourses, student, answers);
    expect(result.excludedReason).not.toBeNull();
    expect(result.judgments.length).toBeGreaterThan(0);
    expect(result.judgments.every((judgment) => judgment.status === "needs_staff")).toBe(true);
  });

  it("checkPlan は職員確認を返し、履修案を出さない", () => {
    const plan = [{ course: "専門14", term: "前期" as const }];
    const result = checkPlan(exampleRules, exampleCourses, student, plan, answers);
    expect(result.status).toBe("needs_staff");
    expect(isDisplayablePlan(result)).toBe(false);
  });

  it("listOutreach は職員確認として返す", () => {
    const evaluation = evaluateStudent(exampleRules, exampleCourses, student, answers);
    expect(listOutreach([evaluation], [student])[0]?.kind).toBe("staff_review");
  });

  it("computeImpact は影響人数に入れず、職員確認の人数に分ける", () => {
    const impact = computeImpact(exampleRules, exampleCourses, [student], {}, ID);
    expect(impact.affectedStudentIds).toEqual([]);
    expect(impact.staffReviewStudentIds).toEqual([student.id]);
  });

  it("computeImpacts でも同じになる", () => {
    const [impact] = computeImpacts(exampleRules, exampleCourses, [student], {});
    expect(impact?.affectedStudentIds).toEqual([]);
    expect(impact?.staffReviewStudentIds).toEqual([student.id]);
  });
});

describe("1人の学生のデータに問題があっても全体を止めない", () => {
  it("他の学生は通常どおり判定する", () => {
    const broken = { ...base, id: "S0009", records: passed(["不明な科目"], 2) };
    const impact = computeImpact(exampleRules, exampleCourses, [broken, base], {}, ID);
    expect(impact.staffReviewStudentIds).toEqual(["S0009"]);
    const evaluation = evaluateStudent(exampleRules, exampleCourses, base, { [ID]: "include" });
    expect(evaluation.excludedReason).toBeNull();
  });
});
