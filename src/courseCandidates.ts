import type { CoursesResponse } from "../shared/api";

export const TERMS = ["前期", "後期", "通年"] as const;

export type CourseOption = CoursesResponse["courses"][number];

// 学期の欄に入れられる科目。開講学期の指定がない科目は、どの学期にも入れられる（engine の NOT_OFFERED と同じ扱い）
export function candidatesFor(courses: CourseOption[], term: (typeof TERMS)[number]) {
  return courses
    .filter(({ offeredIn }) => offeredIn === undefined || offeredIn === term)
    .sort((a, b) => a.assignedYear - b.assignedYear || a.name.localeCompare(b.name, "ja"));
}
