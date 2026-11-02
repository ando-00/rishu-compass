import { evaluateStudent, type JudgmentStatus } from "./evaluate";
import type { Course, Student } from "./model";
import { checkPlan, type PlanEntry, type PlanIssueCode } from "./plan";
import type { RuleSet } from "./rules";

// ルール案が要項どおりに動くかを、期待の判定が分かっている学生で確かめる。
type CaseBase = { id: string; title: string; student: Student };

export type CheckCase =
  | (CaseBase & { kind: "graduation"; expected: JudgmentStatus })
  | (CaseBase & { kind: "plan"; plan: PlanEntry[]; code: PlanIssueCode; expected: boolean });

export type CaseResult = {
  id: string;
  title: string;
  // pending は未確定のルールで止まっている状態で、誤りではない
  outcome: "passed" | "failed" | "pending";
  expected: string;
  actual: string;
};

const STATUS_LABELS: Record<JudgmentStatus, string> = {
  satisfied: "充足",
  expected: "見込み",
  short: "不足",
  delay_risk: "延期見込み",
  needs_staff: "職員確認",
};

function graduationCase(
  rules: RuleSet,
  courses: Course[],
  testCase: Extract<CheckCase, { kind: "graduation" }>,
) {
  const { judgments } = evaluateStudent(rules, courses, testCase.student, {});
  const status = judgments.find(({ kind }) => kind === "graduation")?.status ?? "needs_staff";
  return {
    outcome: status === testCase.expected ? "passed" : status === "needs_staff" ? "pending" : "failed",
    expected: STATUS_LABELS[testCase.expected],
    actual: STATUS_LABELS[status],
  } as const;
}

function planCase(rules: RuleSet, courses: Course[], testCase: Extract<CheckCase, { kind: "plan" }>) {
  const { code, expected, plan, student } = testCase;
  const check = checkPlan(rules, courses, student, plan, {});
  const found = check.issues.some((issue) => issue.code === code);
  const label = (present: boolean) => `${code} ${present ? "あり" : "なし"}`;
  return {
    outcome: found === expected ? "passed" : check.status === "needs_staff" ? "pending" : "failed",
    expected: label(expected),
    actual: label(found),
  } as const;
}

export function runCheckCases(rules: RuleSet, courses: Course[], cases: CheckCase[]): CaseResult[] {
  return cases.map((testCase) => {
    const { id, title } = testCase;
    try {
      const result =
        testCase.kind === "graduation"
          ? graduationCase(rules, courses, testCase)
          : planCase(rules, courses, testCase);
      return { id, title, ...result };
    } catch (cause) {
      const actual = cause instanceof Error ? cause.message : "判定できません";
      return { id, title, outcome: "failed", expected: "判定できること", actual };
    }
  });
}
