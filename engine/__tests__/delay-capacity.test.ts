import { describe, expect, it } from "vitest";
import { evaluateStudent } from "../evaluate";
import type { Course, CourseRecord, Student } from "../model";
import type { RuleSet } from "../rules";

// 監査の第2.5回の A25-1。前期の学生の延期見込みで、今年度後期に登録済みの単位を学期上限の残りから引く。
// 年間の上限がなく学期の上限だけのルールで起きる（年間の上限があれば年間の登録済みで引かれる）。
const base = { clause: "第1条", sourceQuote: "本文" };
const rules: RuleSet = {
  id: "t",
  name: "t",
  admissionYears: [2024],
  graduation: { id: "grad", ...base, minYears: 4, totalCredits: 40 },
  categories: [{ id: "all", ...base, name: "全体", groups: ["G"], minCredits: 40, requireAll: false, overflowTo: null }],
  gates: [],
  loadLimits: [{ id: "load", ...base, maxPerTerm: 4, retakeExclusion: "none" }],
  courseCountLimits: [],
  prerequisites: [],
  ambiguities: [],
};
const courses: Course[] = Array.from({ length: 30 }, (_, i) => ({
  name: `科目${i}`,
  credits: 2,
  assignedYear: 1,
  groups: ["G"],
  offeredIn: i % 2 === 0 ? "前期" : "後期",
}));
const record = (course: string, studentYear: number, term: CourseRecord["term"], result: CourseRecord["result"]) => ({
  course,
  studentYear,
  term,
  result,
});
// 修得22単位。卒業予定は4年次の後期。残る学期は3年次後期、4年次前期、4年次後期（各4単位まで）。
const earned = Array.from({ length: 11 }, (_, i) => record(`科目${i + 10}`, 1 + (i % 2), "前期", "passed"));

function graduation(records: CourseRecord[]) {
  const student: Student = {
    id: "X1",
    admissionYear: 2024,
    studentYear: 3,
    currentTerm: "前期",
    yearsEnrolled: 2,
    expectedGraduation: { studentYear: 4, term: "後期" },
    specialStatuses: [],
    records: [...earned, ...records],
  };
  return evaluateStudent(rules, courses, student, {}).judgments.find((j) => j.kind === "graduation")!;
}

describe("前期の学生の残りの学期の上限（A25-1）", () => {
  it("後期に上限まで登録済みなら、後期の余地は0。不足10単位に余地8単位で延期見込み", () => {
    const result = graduation([
      record("科目0", 3, "前期", "enrolled"),
      record("科目2", 3, "前期", "enrolled"),
      record("科目1", 3, "後期", "enrolled"),
      record("科目3", 3, "後期", "enrolled"),
    ]);
    expect(result).toMatchObject({ status: "delay_risk", needsContact: true });
  });

  it("後期の登録がなければ、不足14単位に余地12単位で延期見込み", () => {
    const result = graduation([record("科目0", 3, "前期", "enrolled"), record("科目2", 3, "前期", "enrolled")]);
    expect(result.status).toBe("delay_risk");
  });

  it("後期に一部だけ登録していれば、残りの余地で足りるかを見る（不足10単位に余地10単位で延期見込みにしない）", () => {
    const result = graduation([
      record("科目0", 3, "前期", "enrolled"),
      record("科目2", 3, "前期", "enrolled"),
      record("科目1", 3, "後期", "enrolled"),
      record("科目4", 1, "前期", "passed"),
    ]);
    expect(result.status).not.toBe("delay_risk");
  });
});
