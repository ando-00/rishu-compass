import { exampleCourses } from "../data/fictional/example/courses";
import { exampleRules } from "../data/fictional/example/rules";
import { exampleStudents } from "../data/fictional/example/students";
import { kamomeCheckCases } from "../data/fictional/kamome/check-cases";
import { kamomeCourses } from "../data/fictional/kamome/courses";
import kamomeHandbook from "../data/fictional/kamome/handbook.md?raw";
import { kamomeStudents } from "../data/fictional/kamome/students";
import { sakuradaiCheckCases } from "../data/fictional/sakuradai/check-cases";
import { sakuradaiCourses } from "../data/fictional/sakuradai/courses";
import sakuradaiHandbook from "../data/fictional/sakuradai/handbook.md?raw";
import { sakuradaiStudents } from "../data/fictional/sakuradai/students";
import { ADMISSION_YEARS } from "../data/fictional/students";
import type { Respondent, StoredProposal } from "../shared/api";
import type { CheckCase } from "../engine/checkCases";
import { validateRuleSet, type Answers, type Course, type RuleSet, type Student } from "../engine";

export type Dataset = {
  id: string;
  name: string;
  rules: RuleSet;
  courses: Course[];
  students: Student[];
  problems: string[];
  // 職員が確定したルールの対象にだけある
  confirmation?: { proposalId: number; respondent: Respondent; confirmedAt: string };
};

type Source = {
  name: string;
  admissionYears: number[];
  handbook: string;
  courses: Course[];
  students: Student[];
  cases: CheckCase[];
};

const SOURCES: Record<string, Source> = {
  sakuradai: {
    name: "さくら台大学（架空）",
    admissionYears: ADMISSION_YEARS,
    handbook: sakuradaiHandbook,
    courses: sakuradaiCourses,
    students: sakuradaiStudents,
    cases: sakuradaiCheckCases,
  },
  kamome: {
    name: "かもめ大学（架空）",
    admissionYears: ADMISSION_YEARS,
    handbook: kamomeHandbook,
    courses: kamomeCourses,
    students: kamomeStudents,
    cases: kamomeCheckCases,
  },
};

export function findSource(id: string) {
  const source = Object.hasOwn(SOURCES, id) ? SOURCES[id] : undefined;
  return source ? { ...source, id } : undefined;
}

// API キーなしで試せるよう、実際の変換の記録を同梱する。作り方は evals/record-proposal.ts にある。
const recordedModules = import.meta.glob<StoredProposal>("../data/fictional/*/recorded-proposal.json", {
  eager: true,
  import: "default",
});

export function findRecordedProposal(id: string) {
  return recordedModules[`../data/fictional/${id}/recorded-proposal.json`];
}

export function listSources() {
  return Object.entries(SOURCES).map(([id, { name, handbook }]) => ({
    id,
    name,
    handbook,
    recorded: findRecordedProposal(id) !== undefined,
  }));
}

// 人が決めた正解ルールは、ファイルを置くだけで読み込む。
const goldModules = import.meta.glob<{ goldRules: RuleSet }>("../data/fictional/*/gold-rules.ts", {
  eager: true,
});

export function createDataset(id: string, name: string, rules: RuleSet, courses: Course[], students: Student[]) {
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

export function isValidAnswers(dataset: Dataset, answers: Answers) {
  return Object.entries(answers).every(([ambiguityId, optionId]) =>
    dataset.rules.ambiguities
      .find((ambiguity) => ambiguity.id === ambiguityId)
      ?.options.some((option) => option.id === optionId),
  );
}
