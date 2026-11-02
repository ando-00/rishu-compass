import { describe, expect, it } from "vitest";
import type { Course, RuleSet, Student } from "../../engine";
import { compareRules } from "../../engine/compareRules";
import { compareJudgments } from "../compare";

const base = { clause: "第1条", sourceQuote: "根拠" };

// どの要項の内容でもない値で作る。
const GOLD: RuleSet = {
  id: "gold",
  name: "正解",
  admissionYears: [2030],
  graduation: { ...base, id: "graduation", minYears: 3, totalCredits: 10 },
  categories: [
    {
      ...base,
      id: "category-a",
      name: "共通",
      groups: ["共通"],
      minCredits: 6,
      requireAll: false,
      overflowTo: "category-b",
    },
    {
      ...base,
      id: "category-b",
      name: "自由",
      groups: ["自由"],
      minCredits: 4,
      requireAll: false,
      maxCredits: 4,
      overflowTo: null,
    },
  ],
  gates: [
    {
      ...base,
      id: "gate",
      name: "条件",
      target: { kind: "course", courses: ["応用B"] },
      checkAtEndOfYear: 1,
      minCredits: 6,
      creditBasis: "earned",
      requiredCourses: ["共通A", "共通B"],
      retryAfterMet: false,
      ambiguityIds: ["basis"],
    },
  ],
  loadLimits: [{ ...base, id: "load", maxPerTerm: 12, retakeExclusion: "none" }],
  courseCountLimits: [],
  prerequisites: [
    { ...base, id: "pre", course: "応用B", conditions: [["共通A"], ["共通B"]], allowSameTerm: false },
  ],
  ambiguities: [
    {
      id: "basis",
      clause: "第3条",
      sourceQuote: "6単位",
      question: "どれを数えますか。",
      options: [
        { id: "a", label: "全部", patches: [{ ruleId: "gate", field: "creditBasis", value: "earned" }] },
        { id: "b", label: "一部", patches: [{ ruleId: "gate", field: "creditBasis", value: "countable" }] },
      ],
    },
  ],
};

function clone(): RuleSet {
  return structuredClone(GOLD);
}

describe("compareRules", () => {
  it("同じルールなら 100% になる", () => {
    const result = compareRules(GOLD, clone());
    expect(result.rate).toBe(1);
    expect(result.mismatches).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.extra).toEqual([]);
  });

  it("ルールの id が違っても意味で突き合わせる", () => {
    const proposal = clone();
    proposal.categories[0]!.id = "c1";
    proposal.categories[0]!.overflowTo = "c2";
    proposal.categories[1]!.id = "c2";
    proposal.prerequisites[0]!.id = "p1";
    expect(compareRules(GOLD, proposal).rate).toBe(1);
  });

  it("並び順の違いは一致とみなす", () => {
    const proposal = clone();
    proposal.gates[0]!.requiredCourses = ["共通B", "共通A"];
    proposal.prerequisites[0]!.conditions = [["共通B"], ["共通A"]];
    expect(compareRules(GOLD, proposal).rate).toBe(1);
  });

  it("書いていない項目と null は同じとみなす", () => {
    const proposal = clone();
    proposal.categories[0]!.maxCredits = null;
    expect(compareRules(GOLD, proposal).rate).toBe(1);
  });

  it("値の違いを項目ごとに示す", () => {
    const proposal = clone();
    proposal.graduation.totalCredits = 12;
    const result = compareRules(GOLD, proposal);
    expect(result.rate).toBeLessThan(1);
    expect(result.mismatches).toEqual([
      { item: "卒業要件", field: "totalCredits", base: 10, other: 12 },
    ]);
  });

  it("算入先の違いを見分ける", () => {
    const proposal = clone();
    proposal.categories[0]!.overflowTo = null;
    expect(compareRules(GOLD, proposal).mismatches[0]?.field).toBe("overflowTo");
  });

  it("正解にある項目が案になければ、全項目を不一致に数える", () => {
    const proposal = clone();
    proposal.prerequisites = [];
    const result = compareRules(GOLD, proposal);
    expect(result.missing).toEqual(["先修条件: 応用B"]);
    expect(result.matched).toBeLessThan(compareRules(GOLD, clone()).matched);
    expect(result.total).toBe(compareRules(GOLD, clone()).total);
  });

  it("案にだけある項目を別に示す", () => {
    const proposal = clone();
    proposal.prerequisites.push({ ...proposal.prerequisites[0]!, id: "p2", course: "応用C" });
    expect(compareRules(GOLD, proposal).extra).toEqual(["先修条件: 応用C"]);
  });

  it("適用条件が違えば別の項目として扱う", () => {
    const proposal = clone();
    proposal.loadLimits[0]!.when = { minStudentYear: 2 };
    const result = compareRules(GOLD, proposal);
    expect(result.missing).toHaveLength(1);
    expect(result.extra).toHaveLength(1);
  });

  it("適用条件を職員が読める形で示す", () => {
    const proposal = clone();
    proposal.loadLimits[0]!.when = { major: "甲専攻", hasMinor: true, minStudentYear: 2, minPreviousGpa: 3 };
    expect(compareRules(GOLD, proposal).extra).toEqual([
      "履修上限: 上限（甲専攻、副専攻あり、2年次以上、前年度 GPA 3 以上）",
    ]);
  });

  it("副専攻なしの条件を示す", () => {
    const proposal = clone();
    proposal.loadLimits[0]!.when = { hasMinor: false };
    expect(compareRules(GOLD, proposal).extra).toEqual(["履修上限: 上限（副専攻なし）"]);
  });

  it("曖昧箇所の差分が変える項目は、一致率に数えない", () => {
    const proposal = clone();
    proposal.gates[0]!.creditBasis = "countable";
    expect(compareRules(GOLD, proposal).rate).toBe(1);
  });

  it("同じ項目を変える曖昧箇所を、検出として数える", () => {
    const proposal = clone();
    proposal.gates[0]!.id = "g1";
    proposal.ambiguities[0]!.id = "other";
    proposal.ambiguities[0]!.clause = "別の条";
    for (const option of proposal.ambiguities[0]!.options) {
      for (const patch of option.patches ?? []) patch.ruleId = "g1";
    }
    expect(compareRules(GOLD, proposal).ambiguities).toEqual([
      { id: "basis", clause: "第3条", detected: "same_field", matchedId: "other" },
    ]);
  });

  it("差分が違っても同じ条文なら、条文の一致として示す", () => {
    const proposal = clone();
    proposal.ambiguities[0]!.clause = "第3条第1項";
    proposal.ambiguities[0]!.options = [
      { id: "a", label: "全部", patches: null },
      { id: "b", label: "一部", patches: null },
    ];
    expect(compareRules(GOLD, proposal).ambiguities[0]?.detected).toBe("same_clause");
  });

  it("検出できなければ、そのように示す", () => {
    const proposal = clone();
    proposal.ambiguities = [];
    expect(compareRules(GOLD, proposal).ambiguities).toEqual([
      { id: "basis", clause: "第3条", detected: null, matchedId: null },
    ]);
  });

  it("案にだけある曖昧箇所を別に示す", () => {
    const proposal = clone();
    proposal.ambiguities.push({ ...proposal.ambiguities[0]!, id: "more", clause: "第9条", options: [] });
    expect(compareRules(GOLD, proposal).extraAmbiguities).toEqual(["more（第9条）"]);
  });
});

describe("compareJudgments", () => {
  const COURSES: Course[] = [
    { name: "共通A", credits: 6, assignedYear: 1, groups: ["共通"] },
    { name: "共通B", credits: 3, assignedYear: 1, groups: ["共通"] },
    { name: "自由A", credits: 4, assignedYear: 1, groups: ["自由"] },
    { name: "応用B", credits: 2, assignedYear: 2, groups: ["共通"] },
  ];
  const STUDENTS: Student[] = [
    {
      id: "S1",
      admissionYear: 2030,
      studentYear: 2,
      currentTerm: "前期",
      yearsEnrolled: 1,
      specialStatuses: [],
      records: [
        { course: "共通A", studentYear: 1, term: "前期", result: "passed" },
        { course: "共通B", studentYear: 1, term: "前期", result: "passed" },
      ],
    },
  ];

  function resultsOf(proposal: RuleSet) {
    return compareJudgments(GOLD, proposal, COURSES, STUDENTS);
  }

  it("同じルールなら、未回答と回答ごとに全判定が一致する", () => {
    const results = resultsOf(clone());
    expect(results.map(({ scenario }) => scenario)).toEqual(["未回答", "basis=a", "basis=b"]);
    for (const result of results) {
      expect(result.total).toBeGreaterThan(0);
      expect(result.matched).toBe(result.total);
      expect(result.differences).toEqual({});
    }
  });

  it("ルールの id と選択肢の id が違っても、差分の値で選択肢を対応させる", () => {
    const proposal = clone();
    proposal.gates[0]!.id = "g1";
    proposal.gates[0]!.ambiguityIds = ["other"];
    proposal.ambiguities[0]!.id = "other";
    proposal.ambiguities[0]!.options = [
      { id: "x", label: "一部", patches: [{ ruleId: "g1", field: "creditBasis", value: "countable" }] },
      { id: "y", label: "全部", patches: [{ ruleId: "g1", field: "creditBasis", value: "earned" }] },
    ];
    const results = resultsOf(proposal);
    expect(results.map(({ scenario }) => scenario)).toEqual(["未回答", "basis=a", "basis=b"]);
    expect(results.every(({ matched, total }) => matched === total)).toBe(true);
  });

  it("回答しても動かない案を、不一致として見つける", () => {
    const proposal = clone();
    proposal.gates[0]!.status = "needs_review";
    const answered = resultsOf(proposal).find(({ scenario }) => scenario === "basis=a")!;
    expect(answered.matched).toBeLessThan(answered.total);
    expect(Object.keys(answered.differences).some((key) => key.endsWith("→needs_staff"))).toBe(true);
  });

  it("値の違う案は、変わった判定を種類ごとに数える", () => {
    const proposal = clone();
    proposal.gates[0]!.minCredits = 100;
    const answered = resultsOf(proposal).find(({ scenario }) => scenario === "basis=a")!;
    expect(answered.differences).toEqual({ "satisfied→short": 1 });
  });

  it("対応する曖昧箇所がなければ、回答の場面を作らない", () => {
    const proposal = clone();
    proposal.ambiguities = [];
    proposal.gates[0]!.ambiguityIds = [];
    expect(resultsOf(proposal).map(({ scenario }) => scenario)).toEqual(["未回答"]);
  });
});
