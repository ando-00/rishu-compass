import { describe, expect, it } from "vitest";
import { sakuradaiCourses } from "../../data/fictional/sakuradai/courses";
import { goldRules } from "../../data/fictional/sakuradai/gold-rules";
import { sakuradaiStudents } from "../../data/fictional/sakuradai/students";
import { evaluateStudent, type Student } from "../../engine";
import { reviewPlan } from "../advisor/advise";
import { findRecordedAdvice } from "../advisor/records";

// H28: 今年度の卒業が難しい見込みの学生の案には、職員面談に回す印をコードで必ず付ける
const answers = { "seminar-credit-basis": "countable" };
const graduationStatus = (student: Student) =>
  evaluateStudent(goldRules, sakuradaiCourses, student, answers).judgments.find(({ kind }) => kind === "graduation")
    ?.status;

describe("職員面談に回す印（H28）", () => {
  it("同梱の記録の S0095 は延期見込みなので、読み込んだ案に印が付く", () => {
    const s0095 = sakuradaiStudents.find(({ id }) => id === "S0095")!;
    expect(graduationStatus(s0095)).toBe("delay_risk");
    const advice = findRecordedAdvice("sakuradai", { rules: goldRules, courses: sakuradaiCourses, student: s0095, answers });
    expect(advice?.status).toBe("passed");
    if (advice?.status !== "passed") return;
    expect(advice.staffReview).toMatch(/職員面談に回して/);
  });

  it("延期見込みでない学生の案には付けない", () => {
    const student = sakuradaiStudents.find(
      (each) => each.specialStatuses.length === 0 && each.studentYear === 1 && graduationStatus(each) !== "delay_risk",
    )!;
    const input = { rules: goldRules, courses: sakuradaiCourses, student, answers };
    const plan = [{ course: "大学基礎論", term: "前期" as const }];
    const passed = student.records.some(({ course }) => course === "大学基礎論");
    const reviewed = reviewPlan(input, passed ? [] : plan, "下書き", 1, []);
    if (reviewed) expect(reviewed.staffReview).toBeUndefined();
  });

  it("延期見込みの学生には、案の検査を通っても必ず印が付く（Claude の判断に任せない）", () => {
    const delayed = sakuradaiStudents.filter((each) => each.specialStatuses.length === 0 && graduationStatus(each) === "delay_risk");
    expect(delayed.length).toBeGreaterThan(0);
    let checked = 0;
    for (const student of delayed) {
      const reviewed = reviewPlan({ rules: goldRules, courses: sakuradaiCourses, student, answers }, [], "下書き", 1, []);
      if (!reviewed) continue;
      checked += 1;
      expect(reviewed.staffReview, student.id).toMatch(/職員面談に回して/);
    }
    expect(checked).toBeGreaterThan(0);
  });
});
