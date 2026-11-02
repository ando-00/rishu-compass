import { checkPlan, evaluateStudent, isDisplayablePlan, planningStudent } from "../../engine";
import type { AdviseResponse } from "../../shared/advise";
import type { ModelUsage } from "../rule-extraction/model";
import { ADVISOR_SYSTEM_PROMPT, advisorPrompt } from "./prompt";
import { createAdvisorTools, type AdvisorInput, type AdvisorTool } from "./tools";

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

export async function adviseStudent(loop: AdvisorLoop, input: AdvisorInput): Promise<AdviseResponse> {
  const { rules, courses, student, answers } = input;
  // 適用外の学生は全判定が職員確認なので、Claude を呼ばない。
  const { excludedReason } = evaluateStudent(rules, courses, student, answers);
  if (excludedReason) return { status: "needs_staff", reason: excludedReason, iterations: 0 };

  const target = planningStudent(student);
  const { tools, state } = createAdvisorTools(input);
  const { iterations } = await loop({
    system: ADVISOR_SYSTEM_PROMPT,
    prompt: advisorPrompt(student.id, target.studentYear),
    tools,
  });

  if (state.escalated !== null) return { status: "needs_staff", reason: state.escalated, iterations };
  if (!state.submitted) return { status: "needs_staff", reason: NO_PLAN_REASON, iterations };

  // 道具の中の検査を信じず、画面へ返す直前にもう一度検査する。
  const { plan, draft } = state.submitted;
  const check = checkPlan(rules, courses, target, plan, answers);
  if (!isDisplayablePlan(check)) {
    return { status: "needs_staff", reason: NO_PLAN_REASON, iterations };
  }

  const credits = new Map(courses.map((course) => [course.name, course.credits]));
  const entries = plan.map((entry) => ({ ...entry, credits: credits.get(entry.course) ?? 0 }));
  return {
    status: "passed",
    plan: entries,
    totalCredits: entries.reduce((sum, entry) => sum + entry.credits, 0),
    planningYear: target.studentYear,
    warnings: check.warnings,
    draft: `${DRAFT_LABEL}\n\n${draft}`,
    iterations,
  };
}
