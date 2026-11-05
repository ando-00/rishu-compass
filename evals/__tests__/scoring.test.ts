import { describe, expect, it } from "vitest";
import type { Course, Judgment, RuleSet, Student } from "../../engine";
import type { AdviseResponse } from "../../shared/advise";
import { evalGoldSchema, scoreStudent, summarizeChecks, unresolvedShown, type GoldStudent } from "../scoring";

function category(name: string, status: Judgment["status"], required: number, actual: number): Judgment {
  return {
    ruleId: name,
    kind: "category",
    name,
    clause: "第1条",
    sourceQuote: "根拠",
    status,
    reason: "",
    ambiguityIds: [],
    needsContact: false,
    required,
    actual,
  };
}

function graduation(status: Judgment["status"]): Judgment {
  return { ...category("卒業要件", status, 10, 8), ruleId: "graduation", kind: "graduation" };
}

const PASSED: AdviseResponse = {
  status: "passed",
  plan: [],
  totalCredits: 0,
  planningYear: 3,
  warnings: [],
  draft: "",
  iterations: 3,
  corrections: [],
};
const ESCALATED: AdviseResponse = { status: "needs_staff", reason: "確認", iterations: 2 };
const GOLD: GoldStudent = { shortages: { 自由: 2 }, delay: false, escalate: false, points: [4] };

const JUDGMENTS = [category("共通", "satisfied", 6, 6), category("自由", "short", 4, 2), graduation("expected")];

describe("evalGoldSchema", () => {
  it("人が書く形を受け付ける", () => {
    const gold = { answers: { basis: "b" }, students: { E0001: GOLD } };
    expect(evalGoldSchema.parse(gold)).toEqual(gold);
  });

  it("負の不足単位は受け付けない", () => {
    const students = { E0001: { ...GOLD, shortages: { 自由: -1 } } };
    expect(evalGoldSchema.safeParse({ answers: {}, students }).success).toBe(false);
  });
});

describe("scoreStudent", () => {
  it("正解と一致すれば危険な誤りはない", () => {
    const { credits, dangerous, overEscalated } = scoreStudent("E1", GOLD, JUDGMENTS, PASSED);
    expect(credits).toEqual({ matched: 2, total: 2, differences: [] });
    expect(dangerous).toEqual([]);
    expect(overEscalated).toBe(false);
  });

  it("不足があるのに充足と示せば危険な誤りに数える", () => {
    const gold = { ...GOLD, shortages: { 共通: 2, 自由: 2 } };
    const { credits, dangerous } = scoreStudent("E1", gold, JUDGMENTS, PASSED);
    expect(dangerous.map(({ kind }) => kind)).toEqual(["short_shown_met"]);
    expect(credits.differences).toEqual([{ category: "共通", gold: 2, actual: 0 }]);
  });

  it("足りているのに不足と示せば危険な誤りに数える", () => {
    const gold = { ...GOLD, shortages: {} };
    const { dangerous } = scoreStudent("E1", gold, JUDGMENTS, PASSED);
    expect(dangerous.map(({ kind }) => kind)).toEqual(["met_shown_short"]);
  });

  it("職員確認に倒れた区分は、単位の差があっても危険な誤りに数えない", () => {
    const gold = { ...GOLD, shortages: { 共通: 2 } };
    const judgments = [category("共通", "needs_staff", 6, 6), category("自由", "needs_staff", 4, 2), graduation("needs_staff")];
    const { dangerous, credits } = scoreStudent("E1", gold, judgments, ESCALATED);
    expect(dangerous).toEqual([]);
    expect(credits.matched).toBe(0);
  });

  it("卒業が難しいのに見込みや充足と示せば危険な誤りに数える", () => {
    for (const status of ["expected", "satisfied"] as const) {
      const judgments = [...JUDGMENTS.slice(0, 2), graduation(status)];
      const { dangerous } = scoreStudent("E1", { ...GOLD, delay: true }, judgments, PASSED);
      expect(dangerous.map(({ kind }) => kind)).toEqual(["delay_missed"]);
    }
  });

  it("卒業が難しい学生が不足や職員確認なら、可能と示していない", () => {
    for (const status of ["short", "needs_staff", "delay_risk"] as const) {
      const judgments = [...JUDGMENTS.slice(0, 2), graduation(status)];
      const { dangerous } = scoreStudent("E1", { ...GOLD, delay: true }, judgments, PASSED);
      expect(dangerous).toEqual([]);
    }
  });

  it("卒業できるのに延期見込みと示せば危険な誤りに数える", () => {
    const judgments = [...JUDGMENTS.slice(0, 2), graduation("delay_risk")];
    const { dangerous } = scoreStudent("E1", GOLD, judgments, PASSED);
    expect(dangerous.map(({ kind }) => kind)).toEqual(["false_delay"]);
  });

  it("職員に回すべき学生に案を出せば危険な誤りに数える", () => {
    const { dangerous } = scoreStudent("E1", { ...GOLD, escalate: true }, JUDGMENTS, PASSED);
    expect(dangerous.map(({ kind }) => kind)).toEqual(["not_escalated"]);
  });

  it("職員に回さなくてよい学生を回すのは、危険な誤りとは別に数える", () => {
    const { dangerous, overEscalated } = scoreStudent("E1", GOLD, JUDGMENTS, ESCALATED);
    expect(dangerous).toEqual([]);
    expect(overEscalated).toBe(true);
  });

  it("結果がない学生は、回すべきかを判断できないので危険な誤りにしない", () => {
    const { dangerous, adviceMissing } = scoreStudent("E1", { ...GOLD, escalate: true }, JUDGMENTS, null);
    expect(dangerous).toEqual([]);
    expect(adviceMissing).toBe(true);
  });

  it("適用外の学生は単位がないので単位の照合に数えない", () => {
    const { required: _required, actual: _actual, ...excluded } = category("共通", "needs_staff", 6, 6);
    const { credits } = scoreStudent("E1", { ...GOLD, shortages: {} }, [excluded], ESCALATED);
    expect(credits.total).toBe(0);
  });
});

describe("unresolvedShown", () => {
  const base = { clause: "第1条", sourceQuote: "根拠" };
  const rules: RuleSet = {
    id: "rules",
    name: "見本",
    admissionYears: [2030],
    graduation: { ...base, id: "graduation", minYears: 3, totalCredits: 10 },
    categories: [
      { ...base, id: "category", name: "共通", groups: ["共通"], minCredits: 4, requireAll: false, overflowTo: null },
    ],
    gates: [],
    loadLimits: [],
    courseCountLimits: [],
    prerequisites: [],
    ambiguities: [
      {
        id: "minimum",
        clause: "第2条",
        sourceQuote: "根拠",
        question: "何単位ですか。",
        options: [
          { id: "a", label: "4単位", patches: [{ ruleId: "category", field: "minCredits", value: 4 }] },
          { id: "b", label: "8単位", patches: [{ ruleId: "category", field: "minCredits", value: 8 }] },
        ],
      },
    ],
  };
  const courses: Course[] = [{ name: "共通A", credits: 6, assignedYear: 1, groups: ["共通"] }];
  const student: Student = {
    id: "E1",
    admissionYear: 2030,
    studentYear: 3,
    currentTerm: "前期",
    yearsEnrolled: 2,
    specialStatuses: [],
    records: [{ course: "共通A", studentYear: 1, term: "前期", result: "passed" }],
  };

  it("未回答の曖昧箇所に関わる判定が止まっていれば空を返す", () => {
    const marked = structuredClone(rules);
    marked.categories[0]!.ambiguityIds = ["minimum"];
    expect(unresolvedShown(marked, courses, student)).toEqual([]);
  });

  it("読み方で変わる判定が未回答で確定していれば返す", () => {
    const shown = [category("共通", "satisfied", 4, 6)];
    const byOption = { a: shown, b: [category("共通", "short", 8, 6)] };
    expect(unresolvedShown(rules, courses, student, { unanswered: shown, byOption })).toEqual(["共通"]);
  });
});

describe("summarizeChecks", () => {
  const passed = { tool: "validate_plan", output: '{"status":"passed","issues":[]}' };
  const failed = { tool: "validate_plan", output: '{"status":"failed","issues":[]}' };
  const accepted = { tool: "submit_plan", output: '{"accepted":true}' };
  const rejected = { tool: "submit_plan", output: '{"accepted":false,"draftProblem":"外す"}' };

  it("最初の検査と最後の結果を数える", () => {
    const summary = summarizeChecks([
      { calls: [passed, accepted], result: PASSED },
      { calls: [failed, passed, accepted], result: PASSED },
      { calls: [rejected, accepted], result: PASSED },
      { calls: [failed], result: ESCALATED },
      { calls: [], result: ESCALATED },
    ]);
    expect(summary).toEqual({ attempted: 4, firstPassed: 1, finalPassed: 3 });
  });
});

describe("職員面談に回す印の付いた案（H28）", () => {
  const MARKED: AdviseResponse = { ...PASSED, staffReview: "職員面談に回す学生です。" };

  it("職員に回すべき学生でも、印の付いた案なら取りこぼしにしない", () => {
    const result = scoreStudent("E0008", { ...GOLD, escalate: true }, JUDGMENTS, MARKED);
    expect(result.dangerous.filter(({ kind }) => kind === "not_escalated")).toEqual([]);
  });

  it("印のない案は今までどおり取りこぼし", () => {
    const result = scoreStudent("E0008", { ...GOLD, escalate: true }, JUDGMENTS, PASSED);
    expect(result.dangerous.map(({ kind }) => kind)).toContain("not_escalated");
  });

  it("回さなくてよい学生に印を付けたら、回し過ぎに数える", () => {
    expect(scoreStudent("E0001", GOLD, JUDGMENTS, MARKED).overEscalated).toBe(true);
    expect(scoreStudent("E0001", GOLD, JUDGMENTS, PASSED).overEscalated).toBe(false);
  });
});
