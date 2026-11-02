import type { Course } from "../../model";
import type { RuleSet } from "../../rules";

// 仕様のテスト表（T19〜T24、T35、T36）を動かすための最小のルール。
// data/fictional/*/gold* の正解ルールとは別物で、評価には使わない。

function numbered(prefix: string, count: number, group: string): Course[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `${prefix}${i + 1}`,
    credits: 2,
    assignedYear: 1,
    groups: [group],
  }));
}

export const kamomeSpecCourses: Course[] = [
  ...numbered("コア", 24, "コア"),
  ...numbered("心理", 40, "心理/専攻"),
  ...numbered("社会", 40, "社会/専攻"),
  ...numbered("他学部", 4, "他学部"),
  { name: "社会統計Ⅰ", credits: 2, assignedYear: 1, groups: ["社会/専攻"] },
  { name: "心理統計Ⅰ", credits: 2, assignedYear: 1, groups: ["心理/専攻"] },
  { name: "心理統計Ⅱ", credits: 2, assignedYear: 1, groups: ["心理/専攻"] },
  { name: "心理学実験", credits: 2, assignedYear: 1, groups: ["心理/専攻"] },
  {
    name: "第1クォーター科目",
    credits: 2,
    assignedYear: 1,
    groups: ["心理/専攻"],
    slots: [{ day: "火", period: 2, quarter: 1 }],
  },
  {
    name: "第2クォーター科目",
    credits: 2,
    assignedYear: 1,
    groups: ["心理/専攻"],
    slots: [{ day: "火", period: 2, quarter: 2 }],
  },
];

const shared = { clause: "第1節", sourceQuote: "区分ごとの必要単位" };

export const kamomeSpecRules: RuleSet = {
  id: "spec-kamome",
  name: "テスト表のルール",
  admissionYears: [2023, 2024, 2025, 2026],
  graduation: { id: "graduation", ...shared, minYears: 4, totalCredits: 128 },
  categories: [
    {
      id: "core",
      ...shared,
      name: "コア",
      groups: ["コア"],
      minCredits: 40,
      requireAll: false,
      maxCredits: 40,
      overflowTo: null,
    },
    {
      id: "psy-major",
      ...shared,
      when: { major: "心理", hasMinor: false },
      name: "専攻",
      groups: ["心理/専攻"],
      minCredits: 64,
      requireAll: false,
      overflowTo: "free-psy",
    },
    {
      id: "psy-major-minor",
      ...shared,
      when: { major: "心理", hasMinor: true },
      name: "専攻",
      groups: ["心理/専攻"],
      minCredits: 52,
      requireAll: false,
      overflowTo: "free-psy-minor",
    },
    {
      id: "psy-minor",
      ...shared,
      when: { major: "心理", hasMinor: true },
      name: "副専攻",
      groups: ["社会/専攻"],
      minCredits: 16,
      requireAll: false,
      overflowTo: "free-psy-minor",
    },
    {
      id: "soc-major",
      ...shared,
      when: { major: "社会", hasMinor: false },
      name: "専攻",
      groups: ["社会/専攻"],
      minCredits: 64,
      requireAll: false,
      overflowTo: "free-soc",
    },
    {
      id: "free-psy",
      ...shared,
      when: { major: "心理", hasMinor: false },
      name: "自由",
      groups: ["他学部", "社会/専攻"],
      minCredits: 24,
      requireAll: false,
      overflowTo: null,
    },
    {
      id: "free-psy-minor",
      ...shared,
      when: { major: "心理", hasMinor: true },
      name: "自由",
      groups: ["他学部"],
      minCredits: 20,
      requireAll: false,
      overflowTo: null,
    },
    {
      id: "free-soc",
      ...shared,
      when: { major: "社会", hasMinor: false },
      name: "自由",
      groups: ["他学部", "心理/専攻"],
      minCredits: 24,
      requireAll: false,
      overflowTo: null,
    },
  ],
  gates: [],
  loadLimits: [
    {
      id: "load",
      clause: "第5節",
      sourceQuote: "各学期に履修できるのは22単位まで",
      maxPerTerm: 22,
      retakeExclusion: "failed",
    },
  ],
  courseCountLimits: [],
  prerequisites: [
    {
      id: "prereq-stat",
      clause: "第6節",
      sourceQuote: "心理統計Ⅰまたは社会統計Ⅰを修得していること",
      course: "心理統計Ⅱ",
      conditions: [["心理統計Ⅰ"], ["社会統計Ⅰ"]],
      allowSameTerm: false,
    },
    {
      id: "prereq-lab",
      clause: "第6節",
      sourceQuote: "同じ学期に履修してもよい",
      course: "心理学実験",
      conditions: [["心理統計Ⅰ"]],
      allowSameTerm: true,
      ambiguityIds: [],
    },
  ],
  ambiguities: [
    {
      id: "retake-scope",
      clause: "第5節",
      sourceQuote: "再履修科目は上限に含めません",
      question: "出席不足で失格した科目も、再履修として上限から除きますか。",
      options: [
        {
          id: "failed",
          label: "不合格の科目だけを除く",
          patches: [{ ruleId: "load", field: "retakeExclusion", value: "failed" }],
        },
        {
          id: "both",
          label: "失格の科目も除く",
          patches: [{ ruleId: "load", field: "retakeExclusion", value: "failed_or_disqualified" }],
        },
      ],
    },
    {
      id: "minor-withdrawal",
      clause: "第3節",
      sourceQuote: "所定の手続きによって取りやめることができます",
      question: "副専攻を取りやめた学生の専攻の必要単位は、どちらの基準ですか。",
      options: [
        { id: "without", label: "副専攻なしの基準", patches: null },
        { id: "with", label: "副専攻ありの基準", patches: null },
      ],
    },
  ],
};
