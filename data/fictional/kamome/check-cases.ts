import type { CheckCase } from "../../../engine/checkCases";
import type { Student } from "../../../engine/model";
import { kamomeCourses } from "./courses";

// 判定エンジン仕様 v2 のテスト表（T 番号）の型を、この大学の科目で組んだ。
// 読み方が分かれる箇所に関わるものは入れない方針で組んだ。曖昧箇所の検出の評価を甘くしないため。
// ただし正解ルールでは、T22b（同じ学期の履修）と T35（再履修と履修上限）が曖昧箇所に関わって保留（pending）になる。誤りには数えない。

function student(overrides: Partial<Student> = {}): Student {
  return {
    id: "CASE",
    admissionYear: 2025,
    studentYear: 2,
    currentTerm: "前期",
    yearsEnrolled: 1,
    major: "心理学専攻",
    hasMinor: false,
    specialStatuses: [],
    records: [],
    ...overrides,
  };
}

function firstTerm(count: number) {
  const names = kamomeCourses
    .filter((course) => course.groups.includes("コア/選択") || course.groups.includes("心理学専攻/選択"))
    .filter((course) => course.credits === 2 && course.offeredIn === "前期")
    .slice(0, count);
  return names.map(({ name }) => ({ course: name, term: "前期" as const }));
}

export const kamomeCheckCases: CheckCase[] = [
  {
    id: "T22",
    title: "心理統計Ⅱの先修は、社会統計Ⅰだけの修得でも満たす",
    student: student({
      records: [{ course: "社会統計Ⅰ", studentYear: 1, term: "前期", result: "passed" }],
    }),
    kind: "plan",
    plan: [{ course: "心理統計Ⅱ", term: "後期" }],
    code: "PREREQUISITE_NOT_MET",
    expected: false,
  },
  {
    id: "T22b",
    title: "心理統計Ⅱは、どちらの統計も修得していなければ履修できない",
    student: student(),
    kind: "plan",
    plan: [{ course: "心理統計Ⅱ", term: "後期" }],
    code: "PREREQUISITE_NOT_MET",
    expected: true,
  },
  {
    id: "T23",
    title: "心理学実験は、心理統計Ⅰと同じ学期に履修できる",
    student: student(),
    kind: "plan",
    plan: [
      { course: "心理統計Ⅰ", term: "前期" },
      { course: "心理学実験", term: "前期" },
    ],
    code: "PREREQUISITE_NOT_MET",
    expected: false,
  },
  {
    id: "T35",
    title: "再履修なしで学期24単位は上限を超える",
    student: student(),
    kind: "plan",
    plan: firstTerm(12),
    code: "OVER_LIMIT",
    expected: true,
  },
];
