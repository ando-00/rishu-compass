import { describe, expect, it } from "vitest";
import type { Gate, RuleSet } from "../../engine/rules";
import { fieldLabel, summarizeRules } from "../ruleSummary";

const base = { clause: "第1条", sourceQuote: "根拠" };

const gate: Gate = {
  ...base,
  id: "gate",
  name: "条件",
  target: { kind: "course", courses: ["応用B"] },
  checkAtEndOfYear: 2,
  minCredits: 6,
  creditBasis: "earned",
  requiredCourses: ["共通A"],
  retryAfterMet: true,
};

const RULES: RuleSet = {
  id: "mihon",
  name: "見本",
  admissionYears: [2030],
  graduation: { ...base, id: "graduation", minYears: 3, totalCredits: 10 },
  categories: [
    {
      ...base,
      id: "common",
      name: "共通",
      groups: ["共通"],
      minCredits: 6,
      requireAll: false,
      overflowTo: "free",
    },
    {
      ...base,
      id: "free",
      name: "自由",
      groups: ["他"],
      minCredits: 4,
      requireAll: false,
      maxCredits: 4,
      overflowTo: null,
      subLimits: [{ groups: ["他"], maxCredits: 2 }],
    },
  ],
  gates: [gate],
  loadLimits: [{ ...base, id: "load", maxPerTerm: 12, retakeExclusion: "failed" }],
  courseCountLimits: [],
  prerequisites: [],
  ambiguities: [],
};

function summaryOf(rules: RuleSet, id: string) {
  return summarizeRules(rules).find((row) => row.id === id)?.summary;
}

function withPatch(ruleId: string, field: string): RuleSet {
  return {
    ...RULES,
    ambiguities: [
      {
        ...base,
        id: "amb",
        question: "どれですか。",
        options: [
          { id: "a", label: "甲", patches: [{ ruleId, field, value: null }] },
          { id: "b", label: "乙", patches: [{ ruleId, field, value: null }] },
        ],
      },
    ],
  };
}

describe("fieldLabel", () => {
  it("項目名を日本語にする", () => {
    expect(fieldLabel("creditBasis")).toBe("単位の数え方");
  });

  it("知らない項目はそのまま返す", () => {
    expect(fieldLabel("存在")).toBe("存在");
  });
});

describe("summarizeRules", () => {
  it("超過分の算入先を区分の名前で示す", () => {
    expect(summaryOf(RULES, "common")).toContain("超過分は自由へ");
  });

  it("科目群の上限を示す", () => {
    expect(summaryOf(RULES, "free")).toContain("他は2単位まで");
  });

  it("後から満たせば認める条件を示す", () => {
    expect(summaryOf(RULES, "gate")).toContain("後から満たせば認める");
  });

  it("再履修の除外を示す", () => {
    expect(summaryOf(RULES, "load")).toContain("不合格の再履修を除く");
  });

  it("読み方を確認中の項目に仮の値を出さない", () => {
    const summary = summaryOf(withPatch("gate", "creditBasis"), "gate");
    expect(summary).toContain("単位の数え方は確認中");
    expect(summary).not.toContain("修得した全単位");
  });

  it("確認中の単位数に仮の値を出さない", () => {
    const summary = summaryOf(withPatch("common", "minCredits"), "common");
    expect(summary).toContain("確認中");
    expect(summary).not.toContain("6単位");
  });

  // 第3回の監査 A3-9。値が偽や空でも、確認中であることを黙って省かない
  it.each([
    ["gate", "retryAfterMet", "後からの再判定は確認中", "後から満たせば認める"],
    ["gate", "requiredMayBeEnrolled", "履修中でも可は確認中", "（履修中でも可、"],
    ["gate", "checkAtEndOfYear", "判定の年次は確認中", "2年次の終わりに"],
    ["common", "requireAll", "すべて修得は確認中", "指定の科目をすべて修得"],
    ["common", "maxCredits", "算入の上限は確認中", "算入は"],
    ["common", "overflowTo", "超過分の算入先は確認中", "超過分は"],
    ["load", "maxPerYear", "年間の上限は確認中", "年間"  + "0"],
  ])("%s の %s を確認中と示す", (ruleId, field, shown, hidden) => {
    const summary = summaryOf(withPatch(ruleId, field), ruleId);
    expect(summary).toContain(shown);
    expect(summary).not.toContain(hidden);
  });

  it("履修の基本の確認中は、どの項目かを示す", () => {
    const enrollment = { ...base, id: "enroll", forbidBeforeAssignedYear: true, forbidRetakeOfPassed: true };
    const rules = {
      ...RULES,
      enrollment,
      ambiguities: [
        {
          ...base,
          id: "amb",
          question: "どれですか。",
          options: [
            {
              id: "a",
              label: "甲",
              patches: [
                { ruleId: "enroll", field: "forbidBeforeAssignedYear", value: true },
                { ruleId: "enroll", field: "forbidRetakeOfPassed", value: true },
              ],
            },
          ],
        },
      ],
    };
    expect(summaryOf(rules, "enroll")).toBe("配当年次より前の履修は確認中、修得済みの再履修は確認中");
  });

  it("差分が書き換えるルールを曖昧箇所ありにする", () => {
    const row = summarizeRules(withPatch("gate", "creditBasis")).find(({ id }) => id === "gate");
    expect(row?.review).toBe("ambiguous");
  });

  it("要確認のルールを優先して示す", () => {
    const rules = { ...RULES, gates: [{ ...gate, status: "needs_review" as const }] };
    expect(summarizeRules(rules).find(({ id }) => id === "gate")?.review).toBe("needs_review");
  });

  it("確定と読める表示をしない", () => {
    const text = JSON.stringify(summarizeRules(RULES));
    expect(text).not.toContain("確定");
  });
});
