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

const ISSUE_LABELS: Record<PlanIssueCode, string> = {
  TIME_CONFLICT: "時間割の重なり",
  OVER_LIMIT: "履修上限の超過",
  PREREQUISITE_NOT_MET: "先修条件の未達",
  NOT_OFFERED: "開講なし",
  WRONG_YEAR: "配当年次より前の履修",
  ALREADY_EARNED: "修得済みの再履修",
  DISQUALIFIED_RETAKE: "失格の再履修",
  SEMINAR_LOCKED: "履修条件の未達",
  CATEGORY_LIMIT: "科目数の超過",
  PENDING_RULE: "未確定のルール",
  UNKNOWN_COURSE: "科目データにない科目",
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
  const label = (present: boolean) => `${ISSUE_LABELS[code]} ${present ? "あり" : "なし"}`;
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
