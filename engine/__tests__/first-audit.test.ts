// 監査の第1回（docs/AUDIT_LOG.md の A1）で見つけた誤りが戻らないことを確かめる。期待値は要項の読み方から手で求める。
import { describe, expect, it } from "vitest";
import { exampleCourses } from "../../data/fictional/example/courses";
import { exampleRules } from "../../data/fictional/example/rules";
import { evaluateStudent } from "../evaluate";
import { computeImpact, settledStudentIds } from "../impact";
import type { Answers, Course, Student } from "../model";
import { checkPlan, lockedEnrollments, planningStudent } from "../plan";
import type { Ambiguity, RuleSet } from "../rules";
import { validateRuleSet } from "../validate";
import { kamomeSpecCourses, kamomeSpecRules } from "./fixtures/spec-kamome";
import { enrolled, makeStudent, numberedNames, passed } from "./helpers";

const ID = "ambiguity-seminar-credits";
const BASIC = ["入門A", "入門B", "基礎C", "基礎D", "基礎E"];

function judge(rules: RuleSet, courses: Course[], student: Student, answers: Answers, kind = "graduation") {
  return evaluateStudent(rules, courses, student, answers).judgments.find((j) => j.kind === kind)!;
}

function miniRules(overrides: Partial<RuleSet> = {}): RuleSet {
  const base = { clause: "第1条", sourceQuote: "本文" };
  return {
    id: "mini",
    name: "mini",
    admissionYears: [2024],
    graduation: { id: "graduation", ...base, minYears: 3, totalCredits: 4 },
    categories: [
      { id: "req", ...base, name: "必修", groups: ["必修"], minCredits: 4, requireAll: true, overflowTo: null },
    ],
    gates: [],
    loadLimits: [{ id: "load", ...base, maxPerTerm: 24, retakeExclusion: "none" }],
    courseCountLimits: [],
    prerequisites: [],
    ambiguities: [],
    ...overrides,
  };
}

const miniCourses: Course[] = [
  { name: "X", credits: 2, assignedYear: 1, groups: ["必修"], offeredIn: "前期", slots: [{ day: "月", period: 1 }] },
  { name: "Y", credits: 2, assignedYear: 1, groups: ["必修"], offeredIn: "前期", slots: [{ day: "火", period: 1 }] },
];

const third = makeStudent({
  major: undefined,
  studentYear: 3,
  yearsEnrolled: 3,
  expectedGraduation: { studentYear: 4, term: "後期" },
});

function ambiguity(id: string, options: Ambiguity["options"]): Ambiguity {
  return { id, clause: "第2条", sourceQuote: "本文", question: "読み方", options };
}

describe("どの読み方でも対応が要らないと確かめられる学生（A1-1）", () => {
  const steady = makeStudent({
    studentYear: 3,
    records: passed([...BASIC, ...numberedNames("専門", 13)], 2),
  });
  const ids = (rules: RuleSet, answers: Answers = {}) =>
    settledStudentIds(rules, exampleCourses, [steady], answers);

  it("全部の読み方で職員確認と声かけが残らない学生を返す", () => {
    expect(ids(exampleRules)).toEqual(new Set([steady.id]));
  });

  it("どれかの読み方で声かけになる学生は返さない", () => {
    const short = makeStudent({ id: "S9", studentYear: 2, records: passed(BASIC, 1) });
    expect(settledStudentIds(exampleRules, exampleCourses, [short], {}).size).toBe(0);
  });

  it("反映できない回答は未解決のままなので返さない", () => {
    const rules = structuredClone(exampleRules);
    rules.ambiguities[0]!.options = [{ id: "only", label: "保留", patches: null }];
    expect(ids(rules, { [ID]: "only" }).size).toBe(0);
    expect(ids(rules).size).toBe(0);
  });

  it("要確認のルールは回答で解けないので返さない", () => {
    const rules = structuredClone(exampleRules);
    rules.categories[0]!.status = "needs_review";
    expect(ids(rules).size).toBe(0);
  });

  it("1つの判定に曖昧箇所が2件あれば、片方を決めても職員確認が残るので返さない", () => {
    const rules = structuredClone(exampleRules);
    rules.ambiguities.push(
      ambiguity("second", [{ id: "on", label: "一方", patches: [{ ruleId: "gate-seminar", field: "minCredits", value: 1 }] }]),
    );
    expect(ids(rules).size).toBe(0);
  });
});

describe("未回答の項目を今の値のまま延期見込みに使わない（A1-2）", () => {
  it("先修の同時履修が読み方で分かれると職員確認にする", () => {
    const rules = miniRules({
      prerequisites: [
        { id: "pre", clause: "第2条", sourceQuote: "本文", course: "Y", conditions: [["X"]], allowSameTerm: false, ambiguityIds: ["same"] },
      ],
      ambiguities: [
        ambiguity("same", [
          { id: "allow", label: "可", patches: [{ ruleId: "pre", field: "allowSameTerm", value: true }] },
          { id: "forbid", label: "不可", patches: [{ ruleId: "pre", field: "allowSameTerm", value: false }] },
        ]),
      ],
    });
    // 3年次後期の学生は4年次前期が最後の機会なので、同時履修が不可なら Y は間に合わない。
    expect(judge(rules, miniCourses, third, { same: "forbid" }).status).toBe("delay_risk");
    expect(judge(rules, miniCourses, third, { same: "allow" }).status).toBe("short");
    const open = judge(rules, miniCourses, third, {});
    expect(open).toMatchObject({ status: "needs_staff", needsContact: false });
    expect(open.ambiguityIds).toContain("same");
  });

  it("どの読み方でも間に合わなければ、未回答でも延期見込みにする", () => {
    const rules = miniRules({
      prerequisites: [
        { id: "pre", clause: "第2条", sourceQuote: "本文", course: "Y", conditions: [["X"]], allowSameTerm: false, ambiguityIds: ["same"] },
      ],
      ambiguities: [ambiguity("same", [{ id: "allow", label: "可", patches: [{ ruleId: "pre", field: "allowSameTerm", value: true }] }])],
    });
    const late = { ...third, studentYear: 4, yearsEnrolled: 4, expectedGraduation: { studentYear: 4, term: "前期" as const } };
    expect(judge(rules, miniCourses, late, {}).status).toBe("delay_risk");
  });

  it("配当年次の読み方で分かれると職員確認にする", () => {
    const courses = miniCourses.map((course) => (course.name === "Y" ? { ...course, assignedYear: 5 } : course));
    const rules = miniRules({
      enrollment: {
        id: "enroll",
        clause: "第3条",
        sourceQuote: "本文",
        forbidBeforeAssignedYear: true,
        forbidRetakeOfPassed: true,
        ambiguityIds: ["early"],
      },
      ambiguities: [
        ambiguity("early", [
          { id: "forbid", label: "禁止", patches: [{ ruleId: "enroll", field: "forbidBeforeAssignedYear", value: true }] },
          { id: "allow", label: "許可", patches: [{ ruleId: "enroll", field: "forbidBeforeAssignedYear", value: false }] },
        ]),
      ],
    });
    expect(judge(rules, courses, third, { early: "forbid" }).status).toBe("delay_risk");
    expect(judge(rules, courses, third, { early: "allow" }).status).toBe("short");
    expect(judge(rules, courses, third, {}).status).toBe("needs_staff");
  });

  it("履修上限が未回答なら、足りる計算でも確定の値にしない", () => {
    const rules = miniRules({
      graduation: { ...miniRules().graduation, totalCredits: 40 },
      loadLimits: [
        { id: "load", clause: "第1条", sourceQuote: "本文", maxPerTerm: 24, retakeExclusion: "none", ambiguityIds: ["cap"] },
      ],
      ambiguities: [
        ambiguity("cap", [
          { id: "wide", label: "24", patches: [{ ruleId: "load", field: "maxPerTerm", value: 24 }] },
          { id: "tight", label: "16", patches: [{ ruleId: "load", field: "maxPerTerm", value: 16 }] },
        ]),
      ],
    });
    const planned = { ...third, records: passed(["X", "Y"]) };
    // 不足36単位に対して、残りは4年次の2学期。24単位なら48、16単位なら32で足りない。
    expect(judge(rules, miniCourses, planned, { cap: "wide" }).status).toBe("short");
    expect(judge(rules, miniCourses, planned, { cap: "tight" }).status).toBe("delay_risk");
    expect(judge(rules, miniCourses, planned, {}).status).toBe("needs_staff");
  });

  it("要確認の先修があると見込みを出さず、職員確認にする", () => {
    const rules = miniRules({
      prerequisites: [
        { id: "pre", clause: "第2条", sourceQuote: "本文", course: "Y", conditions: [["X"]], allowSameTerm: true, status: "needs_review" },
      ],
    });
    expect(judge(rules, miniCourses, third, {}).status).toBe("needs_staff");
  });

  it("要確認の先修は、間に合わない計算になっても延期見込みにせず職員確認にする", () => {
    const rules = miniRules({
      prerequisites: [
        { id: "pre", clause: "第2条", sourceQuote: "本文", course: "Y", conditions: [["X"]], allowSameTerm: true, status: "needs_review" },
      ],
    });
    // X は4年次後期で終わり、前期の Y は5年次になる。ただし要確認の先修が正しいとは限らない。
    const courses = miniCourses.map((course) => (course.name === "X" ? { ...course, offeredIn: "後期" as const } : course));
    expect(judge(rules, courses, third, {}).status).toBe("needs_staff");
  });

  it("循環した先修は計算できないので、延期見込みにしない", () => {
    const rules = miniRules({
      prerequisites: [
        { id: "a", clause: "第2条", sourceQuote: "本文", course: "X", conditions: [["Y"]], allowSameTerm: false },
        { id: "b", clause: "第2条", sourceQuote: "本文", course: "Y", conditions: [["X"]], allowSameTerm: false },
      ],
    });
    expect(validateRuleSet(rules, miniCourses)).toContain("先修の条件が循環しています: X");
    expect(judge(rules, miniCourses, third, {}).status).toBe("needs_staff");
  });
});

describe("履修条件の判定年次（A1-3、A1-4）", () => {
  const gate = {
    id: "gate",
    clause: "第7条",
    sourceQuote: "本文",
    name: "G の条件",
    target: { kind: "course" as const, courses: ["Y"] },
    checkAtEndOfYear: 2,
    minCredits: 2,
    creditBasis: "earned" as const,
    requiredCourses: [],
    retryAfterMet: true,
  };
  const second = {
    ...third,
    studentYear: 2,
    yearsEnrolled: 2,
    expectedGraduation: { studentYear: 3, term: "後期" as const },
  };

  it("判定年次の後期に満たせない学生は、翌年次に満たしてその次から履修する", () => {
    // 2年次に満たせないと、3年次に条件を満たして4年次から履修になり、3年次後期の卒業に間に合わない。
    expect(judge(miniRules({ gates: [gate] }), miniCourses, second, {}).status).toBe("delay_risk");
  });

  it("判定年次の前期なら、後期の登録で満たせるので翌年次から履修できる", () => {
    const rules = miniRules({ gates: [gate] });
    const spring = { ...second, currentTerm: "前期" as const };
    expect(judge(rules, miniCourses, spring, {}).status).not.toBe("delay_risk");
  });

  it("やり直せない条件は、判定年次に満たせないと履修できない", () => {
    const rules = miniRules({ gates: [{ ...gate, retryAfterMet: false }] });
    const longer = { ...second, expectedGraduation: { studentYear: 6, term: "後期" as const } };
    expect(judge(rules, miniCourses, longer, {}).status).toBe("delay_risk");
  });

  it("判定年次のうちは、単位を満たしていても条件のある科目を案に入れられない", () => {
    const rules = miniRules({ gates: [gate] });
    const student = { ...second, records: passed(["X"]) };
    const check = checkPlan(rules, miniCourses, student, [{ course: "Y", term: "前期" }], {});
    expect(check.issues.map((issue) => issue.code)).toContain("SEMINAR_LOCKED");
    expect(check.status).toBe("failed");
  });

  it("判定年次を過ぎて条件を満たしていれば案に入れられる", () => {
    const rules = miniRules({ gates: [gate] });
    const student = { ...third, records: passed(["X"]) };
    const check = checkPlan(rules, miniCourses, student, [{ course: "Y", term: "前期" }], {});
    expect(check.status).toBe("passed");
  });
});

describe("回答で超過分の行き先になる区分（A1-5）", () => {
  it("未回答の間は確定の判定にしない", () => {
    const rules = structuredClone(exampleRules);
    rules.gates[0]!.ambiguityIds = [];
    rules.categories[0]!.minCredits = 6;
    rules.ambiguities = [
      ambiguity("overflow", [
        { id: "drop", label: "送らない", patches: [{ ruleId: "basic-required", field: "overflowTo", value: null }] },
        { id: "send", label: "送る", patches: [{ ruleId: "basic-required", field: "overflowTo", value: "free" }] },
      ]),
    ];
    const student = makeStudent({
      records: [...passed(BASIC), ...passed(numberedNames("専門", 16), 2), ...passed(numberedNames("他", 2), 3)],
    });
    const free = (answers: Answers) =>
      evaluateStudent(rules, exampleCourses, student, answers).judgments.find((j) => j.ruleId === "free")!;
    expect(free({ overflow: "drop" }).status).not.toBe(free({ overflow: "send" }).status);
    expect(free({}).status).toBe("needs_staff");
  });
});

describe("残りの学期の上限（A1-7、A1-17）", () => {
  const courses: Course[] = [
    { name: "X", credits: 20, assignedYear: 1, groups: ["必修"], offeredIn: "後期", slots: [{ day: "月", period: 1 }] },
    { name: "通年四", credits: 4, assignedYear: 1, groups: ["他"], offeredIn: "通年", slots: [{ day: "火", period: 1 }] },
  ];
  const rules = miniRules({
    graduation: { ...miniRules().graduation, totalCredits: 20 },
    categories: [
      { id: "req", clause: "第1条", sourceQuote: "本文", name: "必修", groups: ["必修", "他"], minCredits: 20, requireAll: false, overflowTo: null },
    ],
    loadLimits: [{ id: "load", clause: "第1条", sourceQuote: "本文", maxPerTerm: 20, retakeExclusion: "none" }],
  });
  const final = makeStudent({
    major: undefined,
    studentYear: 4,
    yearsEnrolled: 4,
    currentTerm: "前期",
    expectedGraduation: { studentYear: 4, term: "後期" },
  });

  it("通年の履修中は、残りの学期からも半分を引く", () => {
    // 通年四を修得しても不足16単位なので、今年度の後期の残り18単位で足りる。
    const student = { ...final, records: enrolled(["通年四"], 4, "通年") };
    expect(judge(rules, courses, student, {}).status).not.toBe("delay_risk");
    // 通年の4単位が区分に入らないと不足20単位で、残り18単位では足りない。
    const outside = miniRules({
      ...rules,
      categories: [{ ...rules.categories[0]!, groups: ["必修"] }],
    });
    expect(judge(outside, courses, student, {}).status).toBe("delay_risk");
  });

  it("翌年度の GPA で緩和の上限に届くかが分かれるときは職員確認にする", () => {
    const relaxed = miniRules({
      graduation: { ...miniRules().graduation, totalCredits: 42 },
      categories: [{ ...rules.categories[0]!, minCredits: 42, groups: ["必修"] }],
      loadLimits: [
        { id: "load", clause: "第1条", sourceQuote: "本文", maxPerTerm: 20, maxPerYear: 40, retakeExclusion: "none" },
        {
          id: "relax",
          clause: "第1条",
          sourceQuote: "本文",
          when: { minPreviousGpa: 3 },
          maxPerTerm: 22,
          maxPerYear: 44,
          retakeExclusion: "none",
        },
      ],
    });
    const senior = { ...final, studentYear: 3, yearsEnrolled: 3, currentTerm: "後期" as const };
    const status = (previousGpa: number) =>
      judge(relaxed, courses, { ...senior, previousGpa }, {}).status;
    // 不足42単位。緩和なしの翌年度は40、緩和ありは44。翌年度の前年度 GPA はまだない。
    expect(status(2.0)).toBe("needs_staff");
    expect(status(3.6)).toBe("needs_staff");
  });
});

describe("履修案の前提（A1-10）", () => {
  it("前期の学生は、条件を満たさない履修中の科目を前提から外す", () => {
    const gate = {
      id: "gate",
      clause: "第7条",
      sourceQuote: "本文",
      name: "X の条件",
      target: { kind: "course" as const, courses: ["X"] },
      checkAtEndOfYear: 1,
      minCredits: 10,
      creditBasis: "earned" as const,
      requiredCourses: [],
      retryAfterMet: false,
    };
    const rules = miniRules({
      gates: [gate],
      prerequisites: [
        { id: "pre", clause: "第2条", sourceQuote: "本文", course: "Y", conditions: [["X"]], allowSameTerm: false },
      ],
    });
    const student = makeStudent({
      major: undefined,
      studentYear: 2,
      yearsEnrolled: 2,
      currentTerm: "前期",
      records: enrolled(["X"], 2),
    });
    const locked = lockedEnrollments(rules, miniCourses, student, {});
    expect(locked).toEqual(["X"]);
    const plan = [{ course: "Y", term: "後期" as const }];
    const check = checkPlan(rules, miniCourses, planningStudent(student, locked), plan, {});
    expect(check.issues.map((issue) => issue.code)).toContain("PREREQUISITE_NOT_MET");
    expect(planningStudent(student)).toBe(student);
  });
});

describe("専攻と副専攻の組み合わせ（A1-12）", () => {
  it("組み合わせに合う区分がない学生は職員確認にする", () => {
    const student = makeStudent({ major: "社会", hasMinor: true });
    const answers = { "retake-scope": "failed", "minor-withdrawal": "without" };
    const result = evaluateStudent(kamomeSpecRules, kamomeSpecCourses, student, answers);
    expect(result.excludedReason).not.toBeNull();
  });
});

describe("影響の表示（A1-13）", () => {
  const rules = structuredClone(exampleRules);
  const load = rules.loadLimits[0]!;
  rules.ambiguities.push(
    ambiguity("load-only", [{ id: "tight", label: "狭い", patches: [{ ruleId: load.id, field: "maxPerTerm", value: 10 }] }]),
  );

  it("履修上限だけに関わる曖昧箇所は判定を持たないと示し、全判定の中で数える", () => {
    const student = makeStudent({ records: passed(BASIC) });
    const impact = computeImpact(rules, exampleCourses, [student], { [ID]: "include" }, "load-only");
    expect(impact.judged).toBe(false);
    expect(Object.values(impact.options[0]!.counts ?? {})).toEqual([1]);
  });

  it("判定に関わる曖昧箇所は judged を立て、反映できる候補を示す", () => {
    const impact = computeImpact(exampleRules, exampleCourses, [], {}, ID);
    expect(impact.judged).toBe(true);
    expect(impact.options.every((option) => option.reflected)).toBe(true);
  });

  it("差分で表せない候補は反映できないと示す", () => {
    const held = structuredClone(exampleRules);
    held.ambiguities[0]!.options[0]!.patches = null;
    const impact = computeImpact(held, exampleCourses, [], {}, ID);
    expect(impact.options.map((option) => option.reflected)).toEqual([false, true]);
  });
});

describe("延期見込みの計算（A1-27、A1-28）", () => {
  const base = { clause: "第1条", sourceQuote: "本文" };
  const course = (name: string, credits: number, offeredIn: Course["offeredIn"], group = "必修"): Course => ({
    name,
    credits,
    assignedYear: 1,
    groups: [group],
    offeredIn,
    slots: [{ day: "月", period: 1 }],
  });
  const rulesFor = (minCredits: number, requireAll: boolean, overrides: Partial<RuleSet> = {}) =>
    miniRules({
      graduation: { ...miniRules().graduation, totalCredits: minCredits },
      categories: [{ ...miniRules().categories[0]!, minCredits, requireAll }],
      ...overrides,
    });
  const spring = {
    ...third,
    studentYear: 4,
    yearsEnrolled: 4,
    currentTerm: "前期" as const,
    expectedGraduation: { studentYear: 4, term: "後期" as const },
  };
  const beforeFinalSpring = { ...third, expectedGraduation: { studentYear: 4, term: "前期" as const } };

  it("条件に合う上限のうち最後のものを使う", () => {
    const rules = rulesFor(20, false, {
      loadLimits: [
        { id: "wide", ...base, maxPerTerm: 24, retakeExclusion: "none" },
        { id: "narrow", ...base, when: { minStudentYear: 3 }, maxPerTerm: 8, retakeExclusion: "none" },
      ],
    });
    // 残りは4年次の2学期なので、最後の上限なら16単位で不足20単位に足りない。
    expect(judge(rules, [course("Y", 20, "前期")], third, {}).status).toBe("delay_risk");
  });

  it("後期だけの必修は、卒業予定が4年次前期なら間に合わない", () => {
    const rules = rulesFor(2, true);
    expect(judge(rules, [course("Y", 2, "後期")], beforeFinalSpring, {}).status).toBe("delay_risk");
    expect(judge(rules, [course("Y", 2, "前期")], beforeFinalSpring, {}).status).toBe("short");
  });

  it("通年の必修は2学期かかる", () => {
    const rules = rulesFor(2, true);
    expect(judge(rules, [course("Y", 2, "通年")], beforeFinalSpring, {}).status).toBe("delay_risk");
  });

  it("履修中の通年の先修は年度の終わりまで終わらない", () => {
    const rules = rulesFor(4, true, {
      prerequisites: [{ id: "pre", ...base, course: "Y", conditions: [["Z"]], allowSameTerm: false }],
    });
    const courses = [course("Z", 2, "通年"), course("Y", 2, "後期")];
    const student = { ...spring, records: enrolled(["Z"], 4, "通年") };
    expect(judge(rules, courses, student, {}).status).toBe("delay_risk");
  });

  const gate = {
    id: "gate",
    ...base,
    name: "Y の条件",
    target: { kind: "course" as const, courses: ["Y"] },
    checkAtEndOfYear: 2,
    minCredits: 0,
    creditBasis: "earned" as const,
    requiredCourses: [],
    retryAfterMet: true,
  };

  it("差分で表せない候補がある条件は見込みを出さず、職員確認にする", () => {
    const rules = rulesFor(2, true, {
      gates: [{ ...gate, ambiguityIds: ["held"] }],
      ambiguities: [
        ambiguity("held", [
          { id: "plain", label: "表せる", patches: [{ ruleId: "gate", field: "minCredits", value: 0 }] },
          { id: "held", label: "表せない", patches: null },
        ]),
      ],
    });
    expect(judge(rules, [course("Y", 2, "前期")], third, {}).status).toBe("needs_staff");
  });

  it("要確認の条件は見込みを出さず、職員確認にする", () => {
    const rules = rulesFor(2, true, { gates: [{ ...gate, status: "needs_review" }] });
    expect(judge(rules, [course("Y", 2, "前期")], third, {}).status).toBe("needs_staff");
  });

  it("今年度の登録済みを年間の上限から引く", () => {
    const rules = rulesFor(10, false, {
      loadLimits: [{ id: "load", ...base, maxPerTerm: 20, maxPerYear: 24, retakeExclusion: "none" }],
    });
    const courses = [course("Y", 10, "後期"), course("他", 20, "前期", "他")];
    const student = { ...spring, records: enrolled(["他"], 4, "前期") };
    // 年間24単位のうち20単位を登録済みなので、後期は4単位しか取れず不足10単位に足りない。
    expect(judge(rules, courses, student, {}).status).toBe("delay_risk");
  });

  it("合計が足りていても、区分の不足で最大単位を比べる", () => {
    const rules = miniRules({
      graduation: { ...miniRules().graduation, totalCredits: 10 },
      categories: [
        { id: "other", ...base, name: "他", groups: ["他"], minCredits: 2, requireAll: false, overflowTo: null },
        { id: "req", ...base, name: "必修", groups: ["必修"], minCredits: 30, requireAll: false, overflowTo: null },
      ],
      loadLimits: [{ id: "load", ...base, maxPerTerm: 20, retakeExclusion: "none" }],
    });
    const courses = [course("他", 10, "前期", "他"), course("Y", 30, "後期")];
    const student = { ...spring, records: passed(["他"]) };
    expect(judge(rules, courses, student, {}).status).toBe("delay_risk");
  });
});

describe("計算できない候補の人数（A1-28）", () => {
  it("別の曖昧箇所で職員確認の学生を数えない", () => {
    const rules = structuredClone(exampleRules);
    rules.categories.find((category) => category.id === "minor-a")!.ambiguityIds = ["held"];
    rules.ambiguities.push(ambiguity("held", [{ id: "held", label: "表せない", patches: null }]));
    const student = makeStudent({ studentYear: 3, records: passed(BASIC) });
    const impact = computeImpact(rules, exampleCourses, [student], {}, "held");
    expect(impact.computable).toBe(false);
    expect(impact.staffReviewStudentIds).toEqual([]);
  });
});

describe("検査の例外（A1-14）", () => {
  it("学生に適用されない算入先があっても、例外で止めず職員確認を返す", () => {
    const rules = structuredClone(exampleRules);
    rules.categories.find((c) => c.id === "major-a-no-minor")!.overflowTo = "minor-a";
    const student = makeStudent({ studentYear: 2, records: passed(["入門A"]) });
    const check = checkPlan(rules, exampleCourses, student, [{ course: "専門01", term: "前期" }], { [ID]: "include" });
    expect(check.status).toBe("needs_staff");
  });
});
