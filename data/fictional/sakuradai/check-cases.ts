import type { CheckCase } from "../../../engine/checkCases";
import type { CourseRecord, Student } from "../../../engine/model";
import { sakuradaiCourses } from "./courses";

// 判定エンジン仕様 v2 のテスト表（T 番号）の型を、この大学の科目で組んだ。
// 読み方が分かれる箇所に関わるものは入れない。曖昧箇所の検出の評価を甘くしないため。
// 評価用の10名とは別物で、ルール変換の修正に使ってよい。

function namesOf(group: string, count = Number.POSITIVE_INFINITY) {
  return sakuradaiCourses
    .filter((course) => course.groups.includes(group))
    .slice(0, count)
    .map((course) => course.name);
}

const ELECTIVE = namesOf("専門教育/選択");

const REQUIRED_MINIMUM = [
  ...namesOf("基礎教育/必修"),
  ...namesOf("基礎教育/選択必修", 3),
  ...namesOf("基礎教育/選択", 5),
  ...namesOf("専門教育/必修"),
  ...namesOf("専門教育/選択必修", 8),
  ...ELECTIVE.slice(0, 18),
];

function passed(names: string[]): CourseRecord[] {
  return names.map((course) => ({ course, studentYear: 1, term: "前期", result: "passed" }));
}

function senior(names: string[], overrides: Partial<Student> = {}): Student {
  return {
    id: "CASE",
    admissionYear: 2023,
    studentYear: 4,
    currentTerm: "後期",
    yearsEnrolled: 4,
    specialStatuses: [],
    records: passed(names),
    ...overrides,
  };
}

function freshman(overrides: Partial<Student> = {}): Student {
  return {
    id: "CASE",
    admissionYear: 2026,
    studentYear: 2,
    currentTerm: "前期",
    yearsEnrolled: 1,
    specialStatuses: [],
    records: [],
    ...overrides,
  };
}

const surplus = (count: number) => ELECTIVE.slice(18, 18 + count);
const otherDepartment = (count: number) => namesOf("他学科", count);

function firstTerm(count: number) {
  const names = sakuradaiCourses
    .filter((course) => course.assignedYear <= 2 && course.credits === 2 && course.offeredIn === "前期")
    .slice(0, count);
  return names.map(({ name }) => ({ course: name, term: "前期" as const }));
}

export const sakuradaiCheckCases: CheckCase[] = [
  {
    id: "T01",
    title: "全区分と合計124単位をちょうど満たす",
    student: senior([...REQUIRED_MINIMUM, ...surplus(5), ...otherDepartment(5)]),
    kind: "graduation",
    expected: "satisfied",
  },
  {
    id: "T02",
    title: "合計は足りるが、基礎教育の選択必修が2単位足りない",
    student: senior([
      ...REQUIRED_MINIMUM.filter((name) => name !== namesOf("基礎教育/選択必修", 3)[2]),
      ...surplus(8),
      ...otherDepartment(5),
    ]),
    kind: "graduation",
    expected: "short",
  },
  {
    id: "T03",
    title: "区分は満たすが、合計が122単位で足りない",
    student: senior([...REQUIRED_MINIMUM, ...surplus(4), ...otherDepartment(5)]),
    kind: "graduation",
    expected: "short",
  },
  {
    id: "T04",
    title: "超過分だけで自由の区分の上限20単位ちょうどになる",
    student: senior([...REQUIRED_MINIMUM, ...surplus(10)]),
    kind: "graduation",
    expected: "satisfied",
  },
  {
    id: "T07",
    title: "他学科を12単位修得しても10単位までしか数えず、合計が足りない",
    student: senior([...REQUIRED_MINIMUM, ...surplus(4), ...otherDepartment(6)]),
    kind: "graduation",
    expected: "short",
  },
  {
    id: "T33",
    title: "単位を満たしても、在学3年では卒業に足りない",
    student: senior([...REQUIRED_MINIMUM, ...surplus(5), ...otherDepartment(5)], {
      studentYear: 3,
      yearsEnrolled: 3,
    }),
    kind: "graduation",
    expected: "short",
  },
  {
    id: "T12",
    title: "前期24単位は上限の内に収まる",
    student: freshman(),
    kind: "plan",
    plan: firstTerm(12),
    code: "OVER_LIMIT",
    expected: false,
  },
  {
    id: "T13",
    title: "前期26単位は上限を超える",
    student: freshman(),
    kind: "plan",
    plan: firstTerm(13),
    code: "OVER_LIMIT",
    expected: true,
  },
  {
    id: "T14",
    title: "前年度 GPA 3.0 なら前期28単位まで履修できる",
    student: freshman({ studentYear: 3, yearsEnrolled: 2, previousGpa: 3 }),
    kind: "plan",
    plan: firstTerm(14),
    code: "OVER_LIMIT",
    expected: false,
  },
  {
    id: "T15",
    title: "前年度 GPA 2.99 なら前期26単位は上限を超える",
    student: freshman({ studentYear: 3, yearsEnrolled: 2, previousGpa: 2.99 }),
    kind: "plan",
    plan: firstTerm(13),
    code: "OVER_LIMIT",
    expected: true,
  },
  {
    id: "T17",
    title: "ミクロ経済学Ⅰを修得せずにⅡを履修する",
    student: freshman({
      records: [{ course: "ミクロ経済学Ⅰ", studentYear: 1, term: "前期", result: "failed" }],
    }),
    kind: "plan",
    plan: [{ course: "ミクロ経済学Ⅱ", term: "後期" }],
    code: "PREREQUISITE_NOT_MET",
    expected: true,
  },
];
