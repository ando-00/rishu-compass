import { generateStudents } from "../students";
import { sakuradaiCourses } from "./courses";

const SEMINAR_COURSES = ["基礎演習", "ミクロ経済学Ⅰ", "マクロ経済学Ⅰ", "統計学Ⅰ"];

export const sakuradaiStudents = generateStudents({
  prefix: "S",
  seed: 20261102,
  count: 200,
  firstYearAdmission: 2026,
  courses: sakuradaiCourses,
  loadByYear: [22, 22, 20, 10],
  requiredGroups: () => ["基礎教育/必修", "専門教育/必修"],
  electiveGroups: () => [
    "基礎教育/選択必修",
    "専門教育/選択必修",
    "専門教育/選択",
    "基礎教育/選択",
    "他学科",
  ],
  canTake: (course, { passed, earned }) =>
    course.name !== "演習Ⅰ" ||
    (earned >= 60 && SEMINAR_COURSES.every((name) => passed.has(name))),
});
