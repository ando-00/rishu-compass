import { generateStudents } from "../students";
import { kamomeCourses } from "./courses";

const MAJORS = ["心理学専攻", "社会学専攻"];

function otherMajor(major?: string) {
  return MAJORS.find((name) => name !== major) ?? "";
}

export const kamomeStudents = generateStudents({
  prefix: "K",
  seed: 20261103,
  count: 200,
  firstYearAdmission: 2026,
  courses: kamomeCourses,
  loadByYear: [22, 22, 20, 10],
  majors: MAJORS,
  minorRate: 0.2,
  requiredGroups: (major) => ["コア/必修", `${major}/必修`],
  electiveGroups: (major, minor) => [
    "コア/選択",
    `${major}/選択`,
    ...(minor ? [`${otherMajor(major)}/選択`] : []),
  ],
  canTake: (course, { earned }) => course.name !== "卒業研究" || earned >= 100,
});
