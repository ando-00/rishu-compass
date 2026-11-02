import type { RuleSet } from "../../../engine/rules";

// 値、根拠の文、曖昧箇所は作り手がセッションの質問に答えて決め、Claude が清書した。経緯は docs/DATA.md にある。
const REQUIRED_CLAUSE = "第2条 必修の小区分は、指定された科目をすべて修得しなければならない。";
const OVERFLOW_CLAUSE =
  "第3条 必修以外の小区分で最低単位を超えて修得した単位は、自由の区分に算入する。";
const FREE_CLAUSE = [
  "第4条 自由の区分に算入できる単位は、合計20単位までとする。これを超えた単位は、卒業に必要な単位に算入しない。",
  "第5条 他学科および他学部の科目は、自由の区分に限り、合計10単位まで算入できる。この10単位は第4条の20単位に含む。",
].join("\n\n");
const PREREQUISITE_CLAUSE =
  "第11条 次の表の科目を履修するには、先修科目を修得していなければならない。先修科目と同じ学期に履修することはできない。";

function prerequisite(id: string, course: string, first: string) {
  return {
    id,
    clause: "第11条",
    sourceQuote: PREREQUISITE_CLAUSE,
    course,
    conditions: [[first]],
    allowSameTerm: false,
  };
}

export const goldRules: RuleSet = {
  id: "sakuradai",
  name: "さくら台大学 経済学部 経済学科",
  admissionYears: [2023, 2024, 2025, 2026],
  graduation: {
    id: "graduation",
    clause: "第1条",
    sourceQuote:
      "第1条 卒業するには、4年以上在学し、次の表に定める区分ごとの最低単位を満たしたうえで、合計124単位以上を修得しなければならない。",
    minYears: 4,
    totalCredits: 124,
  },
  categories: [
    {
      id: "basic-required",
      clause: "第2条",
      sourceQuote: REQUIRED_CLAUSE,
      name: "基礎教育 必修",
      groups: ["基礎教育/必修"],
      minCredits: 8,
      requireAll: true,
      overflowTo: null,
    },
    {
      id: "basic-selective",
      clause: "第3条",
      sourceQuote: OVERFLOW_CLAUSE,
      name: "基礎教育 選択必修",
      groups: ["基礎教育/選択必修"],
      minCredits: 6,
      requireAll: false,
      overflowTo: "free",
    },
    {
      id: "basic-elective",
      clause: "第3条",
      sourceQuote: OVERFLOW_CLAUSE,
      name: "基礎教育 選択",
      groups: ["基礎教育/選択"],
      minCredits: 10,
      requireAll: false,
      overflowTo: "free",
    },
    {
      id: "major-required",
      clause: "第2条",
      sourceQuote: REQUIRED_CLAUSE,
      name: "専門教育 必修",
      groups: ["専門教育/必修"],
      minCredits: 28,
      requireAll: true,
      overflowTo: null,
    },
    {
      id: "major-selective",
      clause: "第3条",
      sourceQuote: OVERFLOW_CLAUSE,
      name: "専門教育 選択必修",
      groups: ["専門教育/選択必修"],
      minCredits: 16,
      requireAll: false,
      overflowTo: "free",
    },
    {
      id: "major-elective",
      clause: "第3条",
      sourceQuote: OVERFLOW_CLAUSE,
      name: "専門教育 選択",
      groups: ["専門教育/選択"],
      minCredits: 36,
      requireAll: false,
      overflowTo: "free",
    },
    {
      id: "free",
      clause: "第4条、第5条",
      sourceQuote: FREE_CLAUSE,
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
      clause: "第6条、第7条",
      sourceQuote:
        "第6条 3年次配当の「演習Ⅰ」を履修するには、2年次終了時点で次の両方を満たさなければならない。",
      name: "演習Ⅰの履修条件",
      target: { kind: "course", courses: ["演習Ⅰ"] },
      checkAtEndOfYear: 2,
      minCredits: 60,
      requiredCourses: ["基礎演習", "ミクロ経済学Ⅰ", "マクロ経済学Ⅰ", "統計学Ⅰ"],
      retryAfterMet: true,
      ambiguityIds: ["seminar-credit-basis"],
    },
  ],
  loadLimits: [
    {
      id: "load-normal",
      clause: "第8条、第10条",
      sourceQuote:
        "第8条 履修できる単位は、年間48単位以内、かつ前期・後期それぞれ24単位以内とする。通年の科目は、単位の半分を前期と後期にそれぞれ数える。",
      maxPerYear: 48,
      maxPerTerm: 24,
      retakeExclusion: "none",
    },
    {
      id: "load-relaxed",
      clause: "第9条、第10条",
      sourceQuote:
        "第9条 前年度のGPAが3.0以上の学生は、年間56単位以内、かつ前期・後期それぞれ28単位以内まで履修できる。1年次の学生には適用しない。",
      when: { minStudentYear: 2, minPreviousGpa: 3 },
      maxPerYear: 56,
      maxPerTerm: 28,
      retakeExclusion: "none",
    },
  ],
  courseCountLimits: [],
  prerequisites: [
    prerequisite("prereq-english", "英語Ⅱ", "英語Ⅰ"),
    prerequisite("prereq-chinese", "中国語Ⅱ", "中国語Ⅰ"),
    prerequisite("prereq-micro", "ミクロ経済学Ⅱ", "ミクロ経済学Ⅰ"),
    prerequisite("prereq-macro", "マクロ経済学Ⅱ", "マクロ経済学Ⅰ"),
    prerequisite("prereq-statistics", "統計学Ⅱ", "統計学Ⅰ"),
    prerequisite("prereq-public-finance", "財政学Ⅱ", "財政学Ⅰ"),
    prerequisite("prereq-money", "金融論Ⅱ", "金融論Ⅰ"),
    prerequisite("prereq-international", "国際経済学Ⅱ", "国際経済学Ⅰ"),
    prerequisite("prereq-seminar", "演習Ⅱ", "演習Ⅰ"),
  ],
  enrollment: {
    id: "enrollment",
    clause: "第12条、第13条",
    sourceQuote: [
      "第12条 科目は、配当年次以降に履修する。配当年次より前の年次には履修できない。",
      "第13条 不合格となった科目は、再び履修できる。修得した科目を再び履修することはできない。",
    ].join("\n\n"),
    forbidBeforeAssignedYear: true,
    forbidRetakeOfPassed: true,
  },
  retake: {
    id: "retake-disqualified",
    clause: "第13条",
    sourceQuote: "不合格となった科目は、再び履修できる",
    forbidDisqualified: false,
  },
  ambiguities: [
    {
      id: "seminar-credit-basis",
      clause: "第6条",
      sourceQuote: "修得単位が合計60単位以上であること",
      question: "第5条で卒業に数えない他学科の単位を、第6条の60単位に数えますか。",
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
    {
      id: "retake-disqualified-scope",
      clause: "第13条",
      sourceQuote: "不合格となった科目は、再び履修できる",
      question: "第13条の「不合格となった科目」に、失格の科目は含まれますか。",
      options: [
        {
          id: "include",
          label: "含む（失格の科目も再び履修できる）",
          patches: [{ ruleId: "retake-disqualified", field: "forbidDisqualified", value: false }],
        },
        {
          id: "exclude",
          label: "含まない（失格の科目は再び履修できない）",
          patches: [{ ruleId: "retake-disqualified", field: "forbidDisqualified", value: true }],
        },
      ],
    },
  ],
};
