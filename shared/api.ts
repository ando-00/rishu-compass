import { z } from "zod";

export const answersSchema = z.record(z.string(), z.string());

export const answersRequestSchema = z.object({ answers: answersSchema });

export const planEntrySchema = z.object({
  course: z.string().min(1),
  term: z.enum(["前期", "後期", "通年"]),
});

export const planCheckRequestSchema = z.object({
  studentId: z.string().min(1),
  plan: z.array(planEntrySchema).min(1).max(40),
  answers: answersSchema,
});

export const judgmentStatusSchema = z.enum(["met", "unmet", "pending", "needs_staff"]);

export const judgmentSchema = z.object({
  ruleId: z.string(),
  kind: z.enum(["graduation", "category", "gate"]),
  name: z.string(),
  clause: z.string(),
  status: judgmentStatusSchema,
  reason: z.string(),
  ambiguityIds: z.array(z.string()),
  required: z.number().optional(),
  actual: z.number().optional(),
  missingCourses: z.array(z.string()).optional(),
  atRisk: z.boolean().optional(),
  eligibleFromYear: z.number().optional(),
});

export const impactSchema = z.object({
  ambiguityId: z.string(),
  clause: z.string(),
  question: z.string(),
  options: z.array(z.object({ id: z.string(), label: z.string() })),
  affectedStudentIds: z.array(z.string()),
  staffReviewStudentIds: z.array(z.string()),
  changes: z.array(
    z.object({
      studentId: z.string(),
      ruleId: z.string(),
      name: z.string(),
      clause: z.string(),
      statuses: z.record(z.string(), judgmentStatusSchema),
    }),
  ),
});

export const outreachSchema = z.object({
  studentId: z.string(),
  studentYear: z.number(),
  kind: z.enum(["contact", "staff_review"]),
  reasons: z.array(
    z.object({
      ruleId: z.string(),
      name: z.string(),
      clause: z.string(),
      status: judgmentStatusSchema,
      detail: z.string(),
    }),
  ),
  draft: z.string(),
});

export const datasetsResponseSchema = z.object({
  datasets: z.array(
    z.object({ id: z.string(), name: z.string(), problems: z.array(z.string()) }),
  ),
});

export const overviewResponseSchema = z.object({
  summary: z.object({
    total: z.number(),
    contact: z.number(),
    staffReview: z.number(),
    clear: z.number(),
  }),
  unanswered: z.array(impactSchema),
  answered: z.array(impactSchema.extend({ optionId: z.string() })),
  outreach: z.array(outreachSchema),
  students: z.array(
    z.object({
      id: z.string(),
      studentYear: z.number(),
      major: z.string().optional(),
      state: z.enum(["contact", "staff_review", "clear"]),
    }),
  ),
});

export const studentResponseSchema = z.object({
  student: z.object({
    id: z.string(),
    studentYear: z.number(),
    admissionYear: z.number(),
    major: z.string().optional(),
    hasMinor: z.boolean().optional(),
    specialStatuses: z.array(z.string()),
  }),
  excludedReason: z.string().nullable(),
  judgments: z.array(judgmentSchema),
});

export const planCheckResponseSchema = z.object({
  status: z.enum(["passed", "failed", "needs_staff"]),
  issues: z.array(
    z.object({
      ruleId: z.string(),
      clause: z.string(),
      severity: z.enum(["violation", "needs_staff"]),
      course: z.string().optional(),
      message: z.string(),
      ambiguityIds: z.array(z.string()),
    }),
  ),
  // 検査に通った履修案だけを返す
  plan: z.array(planEntrySchema).nullable(),
});

export type Answers = z.infer<typeof answersSchema>;
export type PlanEntry = z.infer<typeof planEntrySchema>;
export type JudgmentStatus = z.infer<typeof judgmentStatusSchema>;
export type Judgment = z.infer<typeof judgmentSchema>;
export type Impact = z.infer<typeof impactSchema>;
export type Outreach = z.infer<typeof outreachSchema>;
export type DatasetsResponse = z.infer<typeof datasetsResponseSchema>;
export type OverviewResponse = z.infer<typeof overviewResponseSchema>;
export type StudentResponse = z.infer<typeof studentResponseSchema>;
export type PlanCheckResponse = z.infer<typeof planCheckResponseSchema>;
