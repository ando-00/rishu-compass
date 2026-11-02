// 判定の入口。特別な学生の扱いを通らない内部関数は公開しない。
export { evaluatePrepared, evaluateStudent, prepareRules } from "./evaluate";
export type { Judgment, JudgmentStatus, PreparedRules, StudentEvaluation } from "./evaluate";
export { computeImpact, computeImpacts } from "./impact";
export type { AmbiguityImpact, ImpactChange, ImpactOption } from "./impact";
export type {
  Answers,
  Course,
  CourseRecord,
  OfferedTerm,
  SpecialStatus,
  Student,
  Term,
  TermPoint,
} from "./model";
export { draftOutreachMessage, listOutreach } from "./outreach";
export type { OutreachEntry, OutreachReason } from "./outreach";
export { checkPlan, isDisplayablePlan, lockedEnrollments, planningStudent } from "./plan";
export type { PlanCheck, PlanEntry, PlanIssue, PlanIssueCode } from "./plan";
export type { RuleSet } from "./rules";
export { diffStudentStates } from "./stateChanges";
export type { StateChange, StudentState } from "./stateChanges";
export { validateRuleSet } from "./validate";
export { collectQuotes, verifyQuotes } from "./verifyQuotes";
export type { Quote } from "./verifyQuotes";
