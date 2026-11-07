import { z } from "zod";
import { planEntrySchema } from "./api";

// 検査に落ちて直した経過。文はコードの検査が返したもので、Claude の文章ではない
// 鍵がない環境で履修案を作ろうとしたときの案内。理由だけで終わらせず、記録を見られる手順を示す（P3-18）。
// 文のとおりに読めることは worker/__tests__/recorded-advice.test.ts で確かめる。
export const NO_ADVISOR_MESSAGE =
  "この環境では履修案の作成を使えません。さくら台大学の第6条だけに「単位だけを数える」の読み方で答えて S0095 を開くと、「記録を読み込む」で実際に作った案の記録を見られます。";

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
    // 卒業要件が延期見込み（卒業予定までに足りない見込み）の学生の案にだけ付く。職員面談に回す印で、Claude ではなくコードが付ける（H28）
    staffReview: z.string().optional(),
    // 同梱の記録を読み込んだ案にだけ付く。この案では Claude を呼んでいない
    recording: z.object({ model: z.string(), recordedAt: z.string() }).optional(),
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
  // 今の回答と今のルールで検査を通る、同梱の記録があるときに true
  recordingAvailable: z.boolean().optional(),
});

export type Correction = z.infer<typeof correctionSchema>;
export type AdviseResponse = z.infer<typeof adviseResponseSchema>;
export type SavedAdvice = z.infer<typeof savedAdviceSchema>;
