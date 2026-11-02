import { checkPlan, evaluateStudent, isDisplayablePlan, type PlanEntry } from "../../engine";
import type { AdviseResponse, Correction } from "../../shared/advise";
import type { ModelUsage } from "../rule-extraction/model";
import { ADVISOR_SYSTEM_PROMPT, advisorPrompt } from "./prompt";
import {
  createAdvisorTools,
  planningTarget,
  type AdvisorInput,
  type AdvisorTool,
  type PlanInput,
} from "./tools";

export const DRAFT_LABEL = "【下書き】職員が内容を確認してから使ってください。";

export type LoopRequest = {
  system: string;
  prompt: string;
  tools: AdvisorTool[];
};

export type LoopResult = {
  stopReason: string | null;
  iterations: number;
  usage: ModelUsage;
};

export type AdvisorLoop = (request: LoopRequest) => Promise<LoopResult>;

const NO_PLAN_REASON = "周回の上限までに検査を通る案を作れなかったので、職員の確認に回します。";

// 画面へ返す案はすべてここを通す。道具の中の検査や保存したときの結果を信じず、今のルールで検査する。
export function reviewPlan(
  input: PlanInput,
  plan: PlanEntry[],
  draft: string,
  iterations: number,
  corrections: Correction[],
) {
  const { rules, courses, answers } = input;
  const { target, lockedNotes } = planningTarget(input);
  const check = checkPlan(rules, courses, target, plan, answers);
  if (!isDisplayablePlan(check)) return null;

  const credits = new Map(courses.map((course) => [course.name, course.credits]));
  const entries = plan.map((entry) => ({ ...entry, credits: credits.get(entry.course) ?? 0 }));
  return {
    status: "passed" as const,
    plan: entries,
    totalCredits: entries.reduce((sum, entry) => sum + entry.credits, 0),
    planningYear: target.studentYear,
    warnings: [...lockedNotes, ...check.warnings],
    draft,
    iterations,
    corrections,
  };
}

export async function adviseStudent(loop: AdvisorLoop, input: AdvisorInput): Promise<AdviseResponse> {
  const { rules, courses, student, answers } = input;
  // 適用外の学生は全判定が職員確認なので、Claude を呼ばない。
  const { excludedReason } = evaluateStudent(rules, courses, student, answers);
  if (excludedReason) return { status: "needs_staff", reason: excludedReason, iterations: 0 };

  const { tools, state, target } = createAdvisorTools(input);
  const { iterations } = await loop({
    system: ADVISOR_SYSTEM_PROMPT,
    prompt: advisorPrompt(student.id, target.studentYear),
    tools,
  });

  if (state.escalated !== null) return { status: "needs_staff", reason: state.escalated, iterations };
  if (!state.submitted) return { status: "needs_staff", reason: NO_PLAN_REASON, iterations };

  const { plan, draft } = state.submitted;
  return (
    reviewPlan(input, plan, `${DRAFT_LABEL}\n\n${draft}`, iterations, state.corrections) ?? {
      status: "needs_staff",
      reason: NO_PLAN_REASON,
      iterations,
    }
  );
}
