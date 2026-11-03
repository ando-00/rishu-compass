import type { StudentCondition } from "./rules";

export type Term = "前期" | "後期";
export type OfferedTerm = Term | "通年";

export type CourseSlot = {
  day: string;
  period: number;
  quarter?: 1 | 2;
};

export type Course = {
  name: string;
  credits: number;
  assignedYear: number;
  groups: string[];
  summary?: string;
  offeredIn?: OfferedTerm;
  intensive?: boolean;
  slots?: CourseSlot[];
};

export type CourseRecord = {
  course: string;
  studentYear: number;
  term: OfferedTerm;
  result: "passed" | "failed" | "disqualified" | "enrolled";
};

export type SpecialStatus = "編入" | "休学" | "留学" | "読替" | "既修得認定";

export type TermPoint = {
  studentYear: number;
  term: Term;
};

export type Student = {
  id: string;
  admissionYear: number;
  studentYear: number;
  currentTerm: Term;
  // 在学した年数。卒業要件を「満たした」にするのは、これが graduation.minYears 以上のときだけ。
  // 生成データでは年次と同じ値（今の年度を含む）。翌年度の履修案の検査では1足す
  yearsEnrolled: number;
  // 卒業予定の年次と学期。ないときは延期見込みを計算しないので、単位が足りなければ「不足」のまま。
  // 生成データでは全員が4年次後期
  expectedGraduation?: TermPoint;
  major?: string;
  hasMinor?: boolean;
  previousGpa?: number;
  specialStatuses: SpecialStatus[];
  records: CourseRecord[];
};

export type Answers = Record<string, string>;

export type CourseIndex = Map<string, Course>;

export function indexCourses(courses: Course[]): CourseIndex {
  return new Map(courses.map((course) => [course.name, course]));
}

export function findCourse(index: CourseIndex, name: string): Course {
  const course = index.get(name);
  if (!course) throw new Error(`科目データにありません: ${name}`);
  return course;
}

// GPA は小数の比較で誤差が出ないよう、小数第2位までの整数にして比べる。
function gpaHundredths(gpa: number) {
  return Math.round(gpa * 100);
}

export function matchesCondition(condition: StudentCondition | undefined, student: Student) {
  if (!condition) return true;
  const { major, hasMinor, minStudentYear, minPreviousGpa } = condition;
  if (major !== undefined && student.major !== major) return false;
  if (hasMinor !== undefined && (student.hasMinor ?? false) !== hasMinor) return false;
  if (minStudentYear !== undefined && student.studentYear < minStudentYear) return false;
  if (minPreviousGpa !== undefined) {
    if (student.previousGpa === undefined) return false;
    if (gpaHundredths(student.previousGpa) < gpaHundredths(minPreviousGpa)) return false;
  }
  return true;
}

export function disqualifiedCourses(student: Student) {
  const records = student.records.filter((record) => record.result === "disqualified");
  return new Set(records.map((record) => record.course));
}

export function passedCourses(
  student: Student,
  options: { includeEnrolled?: boolean; throughYear?: number } = {},
) {
  const { includeEnrolled = false, throughYear = Number.POSITIVE_INFINITY } = options;
  const names = new Set<string>();
  for (const record of student.records) {
    if (record.studentYear > throughYear) continue;
    if (record.result === "passed" || (includeEnrolled && record.result === "enrolled")) {
      names.add(record.course);
    }
  }
  return names;
}

export function termIndex({ studentYear, term }: TermPoint) {
  return (studentYear - 1) * 2 + (term === "後期" ? 1 : 0);
}
