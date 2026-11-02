import { describe, expect, it } from "vitest";
import { runCheckCases, type CheckCase } from "../checkCases";
import type { Course } from "../model";
import type { RuleSet } from "../rules";
import { makeStudent, passed } from "./helpers";

const base = { clause: "第1条", sourceQuote: "根拠" };

// どの要項の内容でもない値で作る。
const COURSES: Course[] = [
  { name: "A", credits: 4, assignedYear: 1, groups: ["共通"] },
  { name: "B", credits: 4, assignedYear: 1, groups: ["共通"] },
];

const RULES: RuleSet = {
  id: "mihon",
  name: "見本",
  admissionYears: [2024],
  graduation: { ...base, id: "graduation", minYears: 3, totalCredits: 8 },
  categories: [
    { ...base, id: "common", name: "共通", groups: ["共通"], minCredits: 8, requireAll: false, overflowTo: null },
  ],
  gates: [],
  loadLimits: [{ ...base, id: "load", maxPerTerm: 4, retakeExclusion: "none" }],
  courseCountLimits: [],
  prerequisites: [],
  ambiguities: [],
};

const done = makeStudent({ studentYear: 3, yearsEnrolled: 3, records: passed(["A", "B"]) });
const fresh = makeStudent({ studentYear: 1, yearsEnrolled: 1 });

const GRADUATED: CheckCase = {
  id: "C1",
  title: "全部を修得",
  student: done,
  kind: "graduation",
  expected: "satisfied",
};

const OVER: CheckCase = {
  id: "C2",
  title: "上限を超える",
  student: fresh,
  kind: "plan",
  plan: [
    { course: "A", term: "前期" },
    { course: "B", term: "前期" },
  ],
  code: "OVER_LIMIT",
  expected: true,
};

function ambiguous(rules: RuleSet): RuleSet {
  return {
    ...rules,
    ambiguities: [
      {
        ...base,
        id: "amb",
        question: "どちらですか。",
        options: [
          { id: "a", label: "甲", patches: [{ ruleId: "graduation", field: "totalCredits", value: 8 }] },
          { id: "b", label: "乙", patches: [{ ruleId: "graduation", field: "totalCredits", value: 10 }] },
        ],
      },
    ],
  };
}

describe("runCheckCases", () => {
  it("期待どおりの判定なら通過にする", () => {
    expect(runCheckCases(RULES, COURSES, [GRADUATED])).toEqual([
      { id: "C1", title: "全部を修得", outcome: "passed", expected: "充足", actual: "充足" },
    ]);
  });

  it("判定が違えば不一致にする", () => {
    const [result] = runCheckCases({ ...RULES, graduation: { ...RULES.graduation, totalCredits: 20 } }, COURSES, [
      GRADUATED,
    ]);
    expect(result).toMatchObject({ outcome: "failed", expected: "充足", actual: "不足" });
  });

  it("曖昧箇所で止まっている判定は、不一致ではなく保留にする", () => {
    const [result] = runCheckCases(ambiguous(RULES), COURSES, [GRADUATED]);
    expect(result).toMatchObject({ outcome: "pending", actual: "職員確認" });
  });

  it("履修案に期待の違反があれば通過にする", () => {
    expect(runCheckCases(RULES, COURSES, [OVER])[0]).toMatchObject({
      outcome: "passed",
      expected: "OVER_LIMIT あり",
      actual: "OVER_LIMIT あり",
    });
  });

  it("履修案に期待の違反がなければ不一致にする", () => {
    const relaxed = { ...RULES, loadLimits: [{ ...RULES.loadLimits[0]!, maxPerTerm: 10 }] };
    expect(runCheckCases(relaxed, COURSES, [OVER])[0]).toMatchObject({
      outcome: "failed",
      actual: "OVER_LIMIT なし",
    });
  });

  it("違反がないことを期待するケースを見る", () => {
    const relaxed = { ...RULES, loadLimits: [{ ...RULES.loadLimits[0]!, maxPerTerm: 10 }] };
    const allowed: CheckCase = { ...OVER, expected: false };
    expect(runCheckCases(relaxed, COURSES, [allowed])[0]?.outcome).toBe("passed");
    expect(runCheckCases(RULES, COURSES, [allowed])[0]?.outcome).toBe("failed");
  });

  it("履修案が未確定のルールで止まっていて違反も出ないなら、保留にする", () => {
    const pending: RuleSet = {
      ...RULES,
      loadLimits: [{ ...RULES.loadLimits[0]!, status: "needs_review" }],
    };
    expect(runCheckCases(pending, COURSES, [OVER])[0]?.outcome).toBe("pending");
  });

  it("判定できないルールでも例外で止めず、不一致にする", () => {
    const broken = { ...RULES, categories: [{ ...RULES.categories[0]!, overflowTo: "ない区分" }] };
    const [result] = runCheckCases(broken, COURSES, [GRADUATED]);
    expect(result?.outcome).not.toBe("passed");
  });
});
