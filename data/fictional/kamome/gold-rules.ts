import type { Ambiguity, Category, Gate, Prerequisite } from "../../../engine/rules";
import type { RuleSet } from "../../../engine/rules";

// かもめ大学の正解ルール。内容は作り手が手引きを読んで決め、Claude が清書した。
// 経緯と Claude が補った箇所は docs/DATA.md の「かもめ大学の正解ルール」にある。

const CHAPTER_1 = "1 卒業に必要な単位";
const CHAPTER_2 = "2 超過した単位の扱い";
const CHAPTER_3 = "3 副専攻";
const CHAPTER_4 = "4 進級と卒業研究";
const CHAPTER_5 = "5 履修上限";
const CHAPTER_6 = "6 先修条件";
const CHAPTER_8 = "8 科目表";

const MAJORS = [
  { key: "psy", major: "心理学専攻", other: "社会学専攻" },
  { key: "soc", major: "社会学専攻", other: "心理学専攻" },
] as const;

const OTHER_MAJOR_QUOTE = "もう一方の専攻の科目を副専攻科目として修得します。";

const coreCategories: Category[] = [
  {
    id: "core-required",
    clause: CHAPTER_8,
    sourceQuote: "必修（16単位）",
    name: "コア 必修",
    groups: ["コア/必修"],
    minCredits: 16,
    requireAll: true,
    overflowTo: null,
  },
  {
    id: "core-elective",
    clause: `${CHAPTER_8}、${CHAPTER_2}`,
    sourceQuote: "コア科目で必要単位を超えた分は、卒業に必要な単位に算入しません。",
    name: "コア 選択",
    groups: ["コア/選択"],
    minCredits: 24,
    requireAll: false,
    maxCredits: 24,
    overflowTo: null,
  },
];

const majorCategories: Category[] = MAJORS.flatMap(({ key, major }) => [
  {
    id: `major-required-${key}`,
    clause: CHAPTER_8,
    sourceQuote: "必修（24単位）",
    when: { major },
    name: `${major} 必修`,
    groups: [`${major}/必修`],
    minCredits: 24,
    requireAll: true,
    overflowTo: null,
  },
  {
    id: `major-elective-${key}`,
    clause: `${CHAPTER_1}、${CHAPTER_2}`,
    sourceQuote: "| 専攻科目 | 64 | 52 |",
    when: { major, hasMinor: false },
    name: `${major} 選択（副専攻なし）`,
    groups: [`${major}/選択`],
    minCredits: 40,
    requireAll: false,
    overflowTo: `free-${key}`,
  },
  {
    id: `major-elective-minor-${key}`,
    clause: `${CHAPTER_1}、${CHAPTER_2}`,
    sourceQuote: "| 専攻科目 | 64 | 52 |",
    when: { major, hasMinor: true },
    ambiguityIds: ["minor-withdrawal"],
    name: `${major} 選択（副専攻あり）`,
    groups: [`${major}/選択`],
    minCredits: 28,
    requireAll: false,
    overflowTo: "free-minor",
  },
]);

const minorCategories: Category[] = MAJORS.map(({ key, major, other }) => ({
  id: `minor-${key}`,
  clause: CHAPTER_1,
  sourceQuote: "| 副専攻科目 | なし | 16 |",
  when: { major, hasMinor: true },
  ambiguityIds: ["minor-courses", "shared-courses"],
  name: `副専攻（${other}）`,
  groups: [`${other}/必修`, `${other}/選択`],
  minCredits: 16,
  requireAll: false,
  overflowTo: "free-minor",
}));

const freeCategories: Category[] = [
  ...MAJORS.map(({ key, major, other }) => ({
    id: `free-${key}`,
    clause: `${CHAPTER_1}、${CHAPTER_2}`,
    sourceQuote: "副専攻を登録していない学生が、もう一方の専攻の科目を修得した場合は、自由科目に算入します。",
    when: { major, hasMinor: false },
    ambiguityIds: ["shared-courses"],
    name: "自由（副専攻なし）",
    groups: [`${other}/必修`, `${other}/選択`],
    minCredits: 24,
    requireAll: false,
    overflowTo: null,
  })),
  {
    id: "free-minor",
    clause: `${CHAPTER_1}、${CHAPTER_2}`,
    sourceQuote: "専攻科目と副専攻科目で必要単位を超えた分は、自由科目に算入します。",
    when: { hasMinor: true },
    name: "自由（副専攻あり）",
    groups: [],
    minCredits: 20,
    requireAll: false,
    overflowTo: null,
  },
];

const PROMOTION_QUOTE = "2年次へ進級するには、1年次の終わりまでに30単位以上を修得している必要があります。";
const THESIS_QUOTE = "専攻必修科目（卒業研究を除く）の修得を要します。";

const COMMON_REQUIRED = ["専攻演習Ⅰ", "専攻演習Ⅱ"];

const REQUIRED_BY_MAJOR = {
  psy: ["心理学概論", "心理統計Ⅰ", "心理統計Ⅱ", "心理学実験", "認知心理学", "社会心理学", "発達心理学"],
  soc: ["社会学概論", "社会統計Ⅰ", "社会統計Ⅱ", "社会調査法", "社会調査実習", "家族社会学", "地域社会学"],
};

const CREDIT_GATE_AMBIGUITIES = ["credit-basis", "retry-after-met"];

const promotionGate: Gate = {
  id: "gate-promotion",
  clause: CHAPTER_4,
  sourceQuote: PROMOTION_QUOTE,
  ambiguityIds: CREDIT_GATE_AMBIGUITIES,
  name: "2年次への進級",
  target: { kind: "promotion", toYear: 2 },
  checkAtEndOfYear: 1,
  minCredits: 30,
  creditBasis: "earned",
  requiredCourses: [],
  retryAfterMet: false,
};

const thesisGates: Gate[] = MAJORS.map(({ key, major }) => ({
  id: `gate-thesis-${key}`,
  clause: CHAPTER_4,
  sourceQuote: THESIS_QUOTE,
  when: { major },
  ambiguityIds: [...CREDIT_GATE_AMBIGUITIES, "thesis-enrolled", "thesis-enrolled-timing"],
  name: `卒業研究の着手（${major}）`,
  target: { kind: "course", courses: ["卒業研究"] },
  checkAtEndOfYear: 3,
  minCredits: 100,
  creditBasis: "earned",
  requiredCourses: [...REQUIRED_BY_MAJOR[key], ...COMMON_REQUIRED],
  retryAfterMet: false,
}));

const GATE_IDS = [promotionGate.id, ...thesisGates.map(({ id }) => id)];

function prerequisite(
  id: string,
  course: string,
  conditions: string[][],
  sourceQuote: string,
  allowSameTerm: boolean,
): Prerequisite {
  return {
    id,
    clause: CHAPTER_6,
    sourceQuote,
    course,
    conditions,
    allowSameTerm,
    ...(allowSameTerm ? {} : { ambiguityIds: ["same-term"] }),
  };
}

const prerequisites: Prerequisite[] = [
  prerequisite(
    "pre-psy-stat-2",
    "心理統計Ⅱ",
    [["心理統計Ⅰ"], ["社会統計Ⅰ"]],
    "| 心理統計Ⅱ | 心理統計Ⅰまたは社会統計Ⅰを修得していること |",
    false,
  ),
  prerequisite(
    "pre-soc-stat-2",
    "社会統計Ⅱ",
    [["心理統計Ⅰ"], ["社会統計Ⅰ"]],
    "| 社会統計Ⅱ | 心理統計Ⅰまたは社会統計Ⅰを修得していること |",
    false,
  ),
  prerequisite(
    "pre-psy-experiment",
    "心理学実験",
    [["心理統計Ⅰ"]],
    "| 心理学実験 | 心理統計Ⅰを修得していること。同じ学期に履修してもよい |",
    true,
  ),
  prerequisite(
    "pre-soc-practice",
    "社会調査実習",
    [["社会調査法"]],
    "| 社会調査実習 | 社会調査法を修得していること。同じ学期に履修してもよい |",
    true,
  ),
  prerequisite("pre-seminar-2", "専攻演習Ⅱ", [["専攻演習Ⅰ"]], "| 専攻演習Ⅱ | 専攻演習Ⅰを修得していること |", false),
];

const SAME_TERM_IDS = ["pre-psy-stat-2", "pre-soc-stat-2", "pre-seminar-2"];

function patchAll(ruleIds: string[], field: string, value: string | boolean) {
  return ruleIds.map((ruleId) => ({ ruleId, field, value }));
}

const ambiguities: Ambiguity[] = [
  {
    id: "minor-courses",
    clause: CHAPTER_1,
    sourceQuote: OTHER_MAJOR_QUOTE,
    question: "副専攻科目16単位に数える「もう一方の専攻の科目」は、どの科目ですか。",
    options: [
      { id: "all", label: "必修の科目も選択の科目も数える", patches: null },
      { id: "elective", label: "選択の科目だけを数える", patches: null },
    ],
  },
  {
    id: "shared-courses",
    clause: CHAPTER_8,
    sourceQuote: "専攻演習Ⅰ、専攻演習Ⅱ、卒業研究（6単位）",
    question: "両専攻の必修に載っている専攻演習Ⅰ、専攻演習Ⅱ、卒業研究は、どのように数えますか。",
    options: [
      { id: "own-only", label: "自分の専攻の必修としてだけ数える", patches: null },
      { id: "both", label: "もう一方の専攻の科目としても数える", patches: null },
    ],
  },
  {
    id: "minor-withdrawal",
    clause: CHAPTER_3,
    sourceQuote: "登録した副専攻は、所定の手続きによって取りやめることができます。",
    question: "副専攻を途中で取りやめた学生の専攻の必要単位は、どちらの基準になりますか。",
    options: [
      { id: "no-minor", label: "副専攻なしの基準（64単位）", patches: null },
      { id: "minor", label: "副専攻ありの基準（52単位）", patches: null },
    ],
  },
  {
    id: "credit-basis",
    clause: CHAPTER_4,
    sourceQuote: PROMOTION_QUOTE,
    question: "進級の30単位と卒業研究の着手の100単位は、どの単位を数えますか。",
    options: [
      { id: "earned", label: "修得した全単位を数える", patches: patchAll(GATE_IDS, "creditBasis", "earned") },
      { id: "countable", label: "卒業に算入される単位だけを数える", patches: patchAll(GATE_IDS, "creditBasis", "countable") },
    ],
  },
  {
    id: "thesis-enrolled",
    clause: CHAPTER_4,
    sourceQuote: THESIS_QUOTE,
    question: "卒業研究の着手の時点で履修中の専攻必修科目は、修得したものとして扱いますか。",
    options: [
      {
        id: "earned-only",
        label: "修得済みが必要",
        patches: patchAll(thesisGates.map(({ id }) => id), "requiredMayBeEnrolled", false),
      },
      {
        id: "may-be-enrolled",
        label: "履修中でもよい",
        patches: patchAll(thesisGates.map(({ id }) => id), "requiredMayBeEnrolled", true),
      },
    ],
  },
  {
    // 監査の第1回の A1-16 で、作り手が曖昧箇所にすると決めた（2026-11-02）
    id: "thesis-enrolled-timing",
    clause: CHAPTER_4,
    sourceQuote: THESIS_QUOTE,
    question:
      "専攻必修科目を「履修中でもよい」と読む場合、判定の時点（3年次の終わり）より後に履修した科目も、条件を満たすものとして認めますか。",
    options: [
      {
        id: "allow-later",
        label: "認める",
        patches: patchAll(thesisGates.map(({ id }) => id), "enrolledThroughCheckOnly", false),
      },
      {
        id: "through-check",
        label: "認めない（判定の時点までに修得または履修中だった科目だけ）",
        patches: patchAll(thesisGates.map(({ id }) => id), "enrolledThroughCheckOnly", true),
      },
    ],
  },
  {
    id: "retry-after-met",
    clause: CHAPTER_4,
    sourceQuote: PROMOTION_QUOTE,
    question: "判定の時点で条件を満たせなかった学生が後から満たした場合、進級や卒業研究の着手を認めますか。",
    options: [
      { id: "allow", label: "後から満たせば認める", patches: patchAll(GATE_IDS, "retryAfterMet", true) },
      { id: "deny", label: "認めない", patches: patchAll(GATE_IDS, "retryAfterMet", false) },
    ],
  },
  {
    id: "retake",
    clause: CHAPTER_5,
    sourceQuote: "再履修科目は上限に含めません。",
    question: "履修上限から除く再履修科目は、どの科目ですか。",
    options: [
      {
        id: "failed",
        label: "不合格の科目だけ",
        patches: [{ ruleId: "load", field: "retakeExclusion", value: "failed" }],
      },
      {
        id: "failed-or-disqualified",
        label: "不合格と失格の科目",
        patches: [{ ruleId: "load", field: "retakeExclusion", value: "failed_or_disqualified" }],
      },
    ],
  },
  {
    id: "seminar-courses",
    clause: CHAPTER_5,
    sourceQuote: "演習科目は同一学期に2科目までとします。",
    question: "同一学期に2科目までとする演習科目は、どの科目ですか。",
    options: [
      { id: "named", label: "名前に「演習」を含む科目", patches: null },
      { id: "major-seminar", label: "専攻演習Ⅰと専攻演習Ⅱだけ", patches: null },
    ],
  },
  {
    id: "same-term",
    clause: CHAPTER_6,
    sourceQuote: "| 心理学実験 | 心理統計Ⅰを修得していること。同じ学期に履修してもよい |",
    question: "「同じ学期に履修してもよい」と書かれていない先修条件の科目は、先修科目と同じ学期に履修できますか。",
    options: [
      { id: "deny", label: "同じ学期は不可", patches: patchAll(SAME_TERM_IDS, "allowSameTerm", false) },
      { id: "allow", label: "同じ学期も可", patches: patchAll(SAME_TERM_IDS, "allowSameTerm", true) },
    ],
  },
  {
    id: "retake-passed",
    clause: CHAPTER_5,
    sourceQuote: "再履修科目は上限に含めません。",
    question: "修得済みの科目をもう一度履修することはできますか。",
    options: [
      {
        id: "forbid",
        label: "できない",
        patches: [{ ruleId: "enrollment", field: "forbidRetakeOfPassed", value: true }],
      },
      {
        id: "allow",
        label: "できる",
        patches: [{ ruleId: "enrollment", field: "forbidRetakeOfPassed", value: false }],
      },
    ],
  },
];

export const goldRules: RuleSet = {
  id: "kamome",
  name: "かもめ大学 人間科学部 人間科学科",
  admissionYears: [2023, 2024, 2025, 2026],
  graduation: {
    id: "graduation",
    clause: CHAPTER_1,
    sourceQuote: "卒業には、4年以上の在学と、合計128単位以上の修得が必要です。",
    minYears: 4,
    totalCredits: 128,
  },
  categories: [...coreCategories, ...majorCategories, ...minorCategories, ...freeCategories],
  gates: [promotionGate, ...thesisGates],
  loadLimits: [
    {
      id: "load",
      clause: CHAPTER_5,
      sourceQuote: "各学期に履修できるのは22単位までです。成績による緩和はありません。",
      ambiguityIds: ["retake"],
      maxPerTerm: 22,
      retakeExclusion: "failed",
    },
  ],
  courseCountLimits: [
    {
      id: "seminar-count",
      clause: CHAPTER_5,
      sourceQuote: "演習科目は同一学期に2科目までとします。",
      ambiguityIds: ["seminar-courses"],
      group: "演習",
      maxPerTerm: 2,
    },
  ],
  prerequisites,
  enrollment: {
    id: "enrollment",
    clause: CHAPTER_5,
    sourceQuote: "再履修科目は上限に含めません。",
    ambiguityIds: ["retake-passed"],
    forbidBeforeAssignedYear: false,
    forbidRetakeOfPassed: false,
  },
  ambiguities,
};
