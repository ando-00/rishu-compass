import { generateStudents } from "../students";
import { exampleCourses } from "./courses";

export const exampleStudents = generateStudents({
  prefix: "E",
  seed: 20261104,
  count: 80,
  firstYearAdmission: 2026,
  courses: exampleCourses,
  loadByYear: [8, 12, 8, 4],
  majors: ["甲専攻"],
  requiredGroups: () => ["基礎/必修"],
  electiveGroups: () => ["甲専攻/選択", "他学部"],
  canTake: (course, { passed, earned }) =>
    course.name !== "ゼミ" || (earned >= 30 && passed.has("入門A") && passed.has("入門B")),
});
