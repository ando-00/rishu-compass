import type { CourseRecord, OfferedTerm, Student } from "../model";

export function makeStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: "S0001",
    admissionYear: 2024,
    studentYear: 4,
    major: "甲専攻",
    hasMinor: false,
    specialStatuses: [],
    records: [],
    ...overrides,
  };
}

export function passed(names: string[], studentYear = 1, term: OfferedTerm = "前期"): CourseRecord[] {
  return names.map((course) => ({ course, studentYear, term, result: "passed" }));
}

export function failed(names: string[], studentYear = 1, term: OfferedTerm = "前期"): CourseRecord[] {
  return names.map((course) => ({ course, studentYear, term, result: "failed" }));
}

export function enrolled(names: string[], studentYear = 1, term: OfferedTerm = "前期"): CourseRecord[] {
  return names.map((course) => ({ course, studentYear, term, result: "enrolled" }));
}

export function numberedNames(prefix: string, count: number) {
  return Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(2, "0")}`);
}
