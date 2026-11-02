import type { Course } from "../../model";
import type { RuleSet } from "../../rules";

// 仕様のテスト表（T01〜T18、T25〜T34）を動かすための最小のルール。
// data/fictional/*/gold* の正解ルールとは別物で、評価には使わない。

function numbered(prefix: string, count: number, group: string, assignedYear = 1): Course[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `${prefix}${i + 1}`,
    credits: 2,
    assignedYear,
    groups: [group],
  }));
}

export const SEMINAR_REQUIRED = ["指定A", "指定B", "指定C", "指定D"];

export const specCourses: Course[] = [
  ...numbered("基礎必修", 4, "基礎/必修"),
  ...numbered("基礎選必", 5, "基礎/選択必修"),
  ...numbered("基礎選択", 9, "基礎/選択"),
  ...SEMINAR_REQUIRED.map((name) => ({
    name,
    credits: 2,
    assignedYear: 1,
    groups: ["専門/必修"],
  })),
  ...numbered("専門必修", 6, "専門/必修"),
  { name: "演習Ⅰ", credits: 4, assignedYear: 3, groups: ["専門/必修"], offeredIn: "通年" },
  { name: "演習Ⅱ", credits: 4, assignedYear: 4, groups: ["専門/必修"], offeredIn: "通年" },
  ...numbered("専選必", 10, "専門/選択必修"),
  ...numbered("専選", 30, "専門/選択"),
  { name: "一単位科目", credits: 1, assignedYear: 1, groups: ["専門/選択"] },
  ...numbered("他学科", 8, "他学科"),
  { name: "統計Ⅰ", credits: 2, assignedYear: 1, groups: ["専門/選択"] },
  { name: "統計Ⅱ", credits: 2, assignedYear: 1, groups: ["専門/選択"] },
  {
    name: "月一A",
    credits: 2,
    assignedYear: 1,
    groups: ["専門/選択"],
    slots: [{ day: "月", period: 1 }],
  },
  {
    name: "月一B",
    credits: 2,
    assignedYear: 1,
    groups: ["専門/選択"],
    slots: [{ day: "月", period: 1 }],
  },
  {
    name: "集中月一",
    credits: 2,
    assignedYear: 1,
    groups: ["専門/選択"],
    intensive: true,
    slots: [{ day: "月", period: 1 }],
  },
];

const category = (
  id: string,
  group: string,
  minCredits: number,
  requireAll: boolean,
  overflowTo: string | null,
) => ({
  id,
  clause: "第1条",
  sourceQuote: "区分ごとの最低単位",
  name: group,
  groups: [group],
  minCredits,
  requireAll,
  overflowTo,
});

export const specRules: RuleSet = {
  id: "spec-sakuradai",
  name: "テスト表のルール",
  admissionYears: [2023, 2024, 2025, 2026],
  graduation: {
    id: "graduation",
    clause: "第1条",
    sourceQuote: "合計124単位以上を修得",
    minYears: 4,
    totalCredits: 124,
  },
  categories: [
    category("basic-required", "基礎/必修", 8, true, null),
    category("basic-selective", "基礎/選択必修", 6, false, "free"),
    category("basic-elective", "基礎/選択", 10, false, "free"),
    category("major-required", "専門/必修", 28, true, null),
    category("major-selective", "専門/選択必修", 16, false, "free"),
    category("major-elective", "専門/選択", 36, false, "free"),
    {
      id: "free",
      clause: "第4条",
      sourceQuote: "合計20単位まで",
      name: "自由",
      groups: ["他学科"],
      minCredits: 20,
      requireAll: false,
      maxCredits: 20,
      overflowTo: null,
      subLimits: [{ groups: ["他学科"], maxCredits: 10 }],
    },
  ],
  gates: [
    {
      id: "gate-seminar",
      clause: "第6条",
      sourceQuote: "修得単位が合計60単位以上",
      name: "演習Ⅰの履修条件",
      target: { kind: "course", courses: ["演習Ⅰ"] },
      checkAtEndOfYear: 2,
      minCredits: 60,
      creditBasis: "earned",
      requiredCourses: SEMINAR_REQUIRED,
      retryAfterMet: true,
      ambiguityIds: ["credit-basis"],
    },
  ],
  loadLimits: [
    {
      id: "load-normal",
      clause: "第8条",
      sourceQuote: "年間48単位以内",
      maxPerYear: 48,
      maxPerTerm: 24,
      retakeExclusion: "none",
    },
    {
      id: "load-relaxed",
      clause: "第9条",
      sourceQuote: "年間56単位以内",
      when: { minStudentYear: 2, minPreviousGpa: 3 },
      maxPerYear: 56,
      maxPerTerm: 28,
      retakeExclusion: "none",
    },
  ],
  courseCountLimits: [],
  prerequisites: [
    {
      id: "prereq-stat",
      clause: "第11条",
      sourceQuote: "先修科目を修得していなければならない",
      course: "統計Ⅱ",
      conditions: [["統計Ⅰ"]],
      allowSameTerm: false,
    },
    {
      id: "prereq-seminar",
      clause: "第11条",
      sourceQuote: "先修科目を修得していなければならない",
      course: "演習Ⅱ",
      conditions: [["演習Ⅰ"]],
      allowSameTerm: false,
    },
  ],
  enrollment: {
    id: "enrollment",
    clause: "第12条",
    sourceQuote: "配当年次より前の年次には履修できない",
    forbidBeforeAssignedYear: true,
    forbidRetakeOfPassed: true,
  },
  ambiguities: [
    {
      id: "credit-basis",
      clause: "第6条",
      sourceQuote: "修得単位が合計60単位以上",
      question: "第6条の60単位に、卒業に数えない単位を含めますか。",
      options: [
        {
          id: "earned",
          label: "修得した全単位を数える",
          patches: [{ ruleId: "gate-seminar", field: "creditBasis", value: "earned" }],
        },
        {
          id: "countable",
          label: "卒業に数える単位だけを数える",
          patches: [{ ruleId: "gate-seminar", field: "creditBasis", value: "countable" }],
        },
      ],
    },
  ],
};
