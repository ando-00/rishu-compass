import { exampleCourses } from "../data/fictional/example/courses";
import { exampleRules } from "../data/fictional/example/rules";
import { exampleStudents } from "../data/fictional/example/students";
import { kamomeCourses } from "../data/fictional/kamome/courses";
import kamomeHandbook from "../data/fictional/kamome/handbook.md?raw";
import { kamomeStudents } from "../data/fictional/kamome/students";
import { sakuradaiCourses } from "../data/fictional/sakuradai/courses";
import sakuradaiHandbook from "../data/fictional/sakuradai/handbook.md?raw";
import { sakuradaiStudents } from "../data/fictional/sakuradai/students";
import { ADMISSION_YEARS } from "../data/fictional/students";
import { validateRuleSet, type Course, type RuleSet, type Student } from "../engine";

export type Dataset = {
  id: string;
  name: string;
  rules: RuleSet;
  courses: Course[];
  students: Student[];
  problems: string[];
};

type Source = {
  name: string;
  admissionYears: number[];
  handbook: string;
  courses: Course[];
  students: Student[];
};

const SOURCES: Record<string, Source> = {
  sakuradai: {
    name: "さくら台大学（架空）",
    admissionYears: ADMISSION_YEARS,
    handbook: sakuradaiHandbook,
    courses: sakuradaiCourses,
    students: sakuradaiStudents,
  },
  kamome: {
    name: "かもめ大学（架空）",
    admissionYears: ADMISSION_YEARS,
    handbook: kamomeHandbook,
    courses: kamomeCourses,
    students: kamomeStudents,
  },
};

export function findSource(id: string) {
  const source = Object.hasOwn(SOURCES, id) ? SOURCES[id] : undefined;
  return source ? { ...source, id } : undefined;
}

export function listSources() {
  return Object.entries(SOURCES).map(([id, { name, handbook }]) => ({ id, name, handbook }));
}

// 人が決めた正解ルールは、ファイルを置くだけで読み込む。
const goldModules = import.meta.glob<{ goldRules: RuleSet }>("../data/fictional/*/gold-rules.ts", {
  eager: true,
});

function createDataset(id: string, name: string, rules: RuleSet, courses: Course[], students: Student[]) {
  return { id, name, rules, courses, students, problems: validateRuleSet(rules, courses) };
}

function goldDatasets() {
  return Object.entries(goldModules).flatMap(([path, module]) => {
    const id = path.split("/").at(-2) ?? "";
    const source = SOURCES[id];
    if (!source) return [];
    return [createDataset(id, source.name, module.goldRules, source.courses, source.students)];
  });
}

export const datasets: Dataset[] = [
  ...goldDatasets(),
  createDataset("example", "見本（動作確認用）", exampleRules, exampleCourses, exampleStudents),
];
