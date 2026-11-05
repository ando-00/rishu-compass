import { describe, expect, it } from "vitest";
import { exampleCourses } from "../../data/fictional/example/courses";
import { exampleRules } from "../../data/fictional/example/rules";
import { evaluateStudent } from "../evaluate";
import { summarizeFinalYear } from "../finalYear";
import { computeImpact, computeImpacts, settledStudentIds } from "../impact";
import type { Student } from "../model";
import { listOutreach } from "../outreach";
import {
  checkCurrentRegistrations,
  checkPlan,
  isDisplayablePlan,
  lockedEnrollments,
  pendingPromotions,
  unavailableCourses,
  unresolvedEnrollments,
} from "../plan";
import { enrolled, makeStudent, numberedNames, passed } from "./helpers";

const ID = "ambiguity-seminar-credits";
const records = passed(["入門A", "入門B", "基礎C", "基礎D", "基礎E", ...numberedNames("専門", 13)], 2);
const base = makeStudent({ studentYear: 3, records });

const conditions: [string, Student][] = [
  ...(["編入", "休学", "留学", "読替", "既修得認定"] as const).map(
    (status): [string, Student] => [status, { ...base, specialStatuses: [status] }],
  ),
  ["適用外の入学年度", { ...base, admissionYear: 2020 }],
  ["科目データにない科目", { ...base, records: [...records, ...passed(["不明な科目"], 2)] }],
  ["対象外の専攻", { ...base, major: "丙専攻" }],
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

  // 画面は一覧での今の対応を回答の前の状態として渡す（B17、A25-2）。その経路でも同じになる
  it("一覧の状態を渡した computeImpact と computeImpacts でも同じになる", () => {
    const evaluation = evaluateStudent(exampleRules, exampleCourses, student, {});
    const states = new Map(listOutreach([evaluation], [student]).map((entry) => [entry.studentId, entry.kind]));
    expect(states.get(student.id)).toBe("staff_review");
    const single = computeImpact(exampleRules, exampleCourses, [student], {}, ID, states);
    expect(single.affectedStudentIds).toEqual([]);
    expect(single.staffReviewStudentIds).toEqual([student.id]);
    const [impact] = computeImpacts(exampleRules, exampleCourses, [student], {}, states);
    expect(impact?.affectedStudentIds).toEqual([]);
    expect(impact?.staffReviewStudentIds).toEqual([student.id]);
  });

  // あとから足した公開の関数も、同じ条件で掛け合わせる（追加の監査 R-8）
  it("settledStudentIds は、対応が要らないと確かめた学生に入れない", () => {
    expect(settledStudentIds(exampleRules, exampleCourses, [student], {}).size).toBe(0);
  });

  it("checkCurrentRegistrations は、今期の登録の検査を職員確認にする", () => {
    const registered = { ...student, records: [...student.records, ...enrolled(["専門14"], 3, "後期")] };
    const result = checkCurrentRegistrations(exampleRules, exampleCourses, registered, answers);
    expect(result?.courses).toEqual(["専門14"]);
    expect(result?.check.status).toBe("needs_staff");
  });

  it("unavailableCourses は、候補から外す科目を決めない", () => {
    expect(unavailableCourses(exampleRules, exampleCourses, student, answers)).toEqual([]);
  });

  it("履修案の前提（外す履修中の科目、未確定の科目、決まっていない進級）を計算しない", () => {
    const registered = { ...student, records: [...student.records, ...enrolled(["ゼミ"], 3, "通年")] };
    expect(lockedEnrollments(exampleRules, exampleCourses, registered, {})).toEqual([]);
    expect(unresolvedEnrollments(exampleRules, exampleCourses, registered, {})).toEqual([]);
    expect(pendingPromotions(exampleRules, exampleCourses, registered, {})).toEqual([]);
  });

  it("summarizeFinalYear は、最終年次の内訳で職員確認だけに数える", () => {
    const final = { ...student, studentYear: 4, yearsEnrolled: 4 };
    const evaluation = evaluateStudent(exampleRules, exampleCourses, final, answers);
    const { studentCount, rows } = summarizeFinalYear(exampleRules, [final], [evaluation]);
    expect(studentCount).toBe(1);
    for (const { name, counts, notApplicable } of rows) {
      const { needs_staff: staff, ...others } = counts;
      expect([name, Object.values(others).every((count) => count === 0)]).toEqual([name, true]);
      expect([name, staff + notApplicable]).toEqual([name, 1]);
    }
    expect(rows.find(({ kind }) => kind === "graduation")?.counts.needs_staff).toBe(1);
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
