import { z } from "zod";
import { planEntrySchema } from "./api";

// 履修案は engine の検査を通ったものだけを返す。単位は科目データの値で、Claude の出力ではない
export const adviseResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("passed"),
    plan: z.array(planEntrySchema.extend({ credits: z.number() })),
    totalCredits: z.number(),
    planningYear: z.number(),
    warnings: z.array(z.string()),
    draft: z.string(),
    iterations: z.number(),
  }),
  z.object({
    status: z.literal("needs_staff"),
    reason: z.string(),
    iterations: z.number(),
  }),
]);

export type AdviseResponse = z.infer<typeof adviseResponseSchema>;
