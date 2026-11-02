import type { CourseRecord, OfferedTerm, Student } from "../model";

export function makeStudent(overrides: Partial<Student> = {}): Student {
  const studentYear = overrides.studentYear ?? 4;
  return {
    id: "S0001",
    admissionYear: 2024,
    studentYear,
    currentTerm: "後期",
    yearsEnrolled: studentYear,
    major: "甲専攻",
    hasMinor: false,
    specialStatuses: [],
    records: [],
    ...overrides,
  };
}

function recordsOf(result: CourseRecord["result"]) {
  return (names: string[], studentYear = 1, term: OfferedTerm = "前期"): CourseRecord[] =>
    names.map((course) => ({ course, studentYear, term, result }));
}

export const passed = recordsOf("passed");
export const failed = recordsOf("failed");
export const disqualified = recordsOf("disqualified");
export const enrolled = recordsOf("enrolled");

export function numberedNames(prefix: string, count: number) {
  return Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(2, "0")}`);
}
