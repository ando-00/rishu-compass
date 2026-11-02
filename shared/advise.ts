import { z } from "zod";
import { planEntrySchema } from "./api";

// 検査に落ちて直した経過。文はコードの検査が返したもので、Claude の文章ではない
export const correctionSchema = z.object({
  stage: z.enum(["plan", "draft"]),
  messages: z.array(z.string()),
});

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
    // 経過を残す前に作った記録には、この項目がない
    corrections: z.array(correctionSchema).default([]),
  }),
  z.object({
    status: z.literal("needs_staff"),
    reason: z.string(),
    iterations: z.number(),
  }),
]);

// recordedAt が null なら記録がない。advice があるときは、案を記録できなかったことを表す
export const savedAdviceSchema = z.object({
  advice: adviseResponseSchema.nullable(),
  recordedAt: z.string().nullable(),
});

export type Correction = z.infer<typeof correctionSchema>;
export type AdviseResponse = z.infer<typeof adviseResponseSchema>;
export type SavedAdvice = z.infer<typeof savedAdviceSchema>;
