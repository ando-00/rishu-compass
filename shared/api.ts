import { z } from "zod";
import type { RuleSet } from "../engine/rules";

export const answersSchema = z.record(z.string(), z.string());

export const answersRequestSchema = z.object({ answers: answersSchema });

// 回答者は役割名から選ばせ、実名が入らないようにする。
export const respondentSchema = z.enum(["教務職員A", "教務職員B", "教務職員C"]);

export const saveAnswerRequestSchema = z.object({
  ambiguityId: z.string().min(1),
  // null は回答の取り消し
  optionId: z.string().min(1).nullable(),
  respondent: respondentSchema,
});

export const answerRecordSchema = z.object({
  ambiguityId: z.string(),
  optionId: z.string(),
  respondent: respondentSchema,
  answeredAt: z.string(),
});

// 回答の経過。取り消しは optionId が null
export const answerHistoryEntrySchema = z.object({
  ambiguityId: z.string(),
  optionId: z.string().nullable(),
  respondent: respondentSchema,
  answeredAt: z.string(),
});

// 同じ大学の前の版で、同じ ID の曖昧箇所にした回答。参考に見せるだけで、今の版には反映しない
export const previousAnswerSchema = z.object({
  ambiguityId: z.string(),
  // 前の版のルール案の番号（「確定ルール 第N版」の N）
  version: z.number(),
  // 前の版のルール案での読み方の名前。今の版の選択肢と同じとは限らない
  optionLabel: z.string(),
  respondent: respondentSchema,
  answeredAt: z.string(),
});

export const answerRecordsResponseSchema = z.object({
  records: z.array(answerRecordSchema),
  // 新しい順。曖昧箇所ごとの最新だけでなく、回答し直しと取り消しも残す
  history: z.array(answerHistoryEntrySchema),
  // 新しい版から順
  previous: z.array(previousAnswerSchema),
});

export const planEntrySchema = z.object({
  course: z.string().min(1),
  term: z.enum(["前期", "後期", "通年"]),
});

export const planCheckRequestSchema = z.object({
  studentId: z.string().min(1),
  plan: z.array(planEntrySchema).min(1).max(40),
  answers: answersSchema,
});

export const judgmentStatusSchema = z.enum([
  "satisfied",
  "expected",
  "delayed",
  "short",
  "delay_risk",
  "needs_staff",
]);

const groundSchema = z.object({ ruleId: z.string(), clause: z.string(), sourceQuote: z.string() });

export const judgmentSchema = z.object({
  ruleId: z.string(),
  kind: z.enum(["graduation", "category", "gate"]),
  name: z.string(),
  clause: z.string(),
  sourceQuote: z.string(),
  status: judgmentStatusSchema,
  reason: z.string(),
  ambiguityIds: z.array(z.string()),
  needsContact: z.boolean(),
  required: z.number().optional(),
  actual: z.number().optional(),
  enrolled: z.number().optional(),
  earned: z.number().optional(),
  missingCourses: z.array(z.string()).optional(),
  shortCategories: z.array(z.string()).optional(),
  uncountedCourses: z.array(z.string()).optional(),
  atRisk: z.boolean().optional(),
  eligibleFromYear: z.number().optional(),
  grounds: z.array(groundSchema).optional(),
  unreflected: z.literal(true).optional(),
});

export const impactSchema = z.object({
  ambiguityId: z.string(),
  clause: z.string(),
  sourceQuote: z.string(),
  question: z.string(),
  computable: z.boolean(),
  judged: z.boolean(),
  options: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      counts: z.partialRecord(judgmentStatusSchema, z.number()).nullable(),
      reflected: z.boolean(),
    }),
  ),
  countedRuleNames: z.array(z.string()),
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
  severity: z.number(),
  reasons: z.array(
    z.object({
      ruleId: z.string(),
      name: z.string(),
      clause: z.string(),
      sourceQuote: z.string(),
      status: judgmentStatusSchema,
      detail: z.string(),
      grounds: z.array(groundSchema).optional(),
      // 不足の量。職員確認の判定には付かない
      required: z.number().optional(),
      actual: z.number().optional(),
      enrolled: z.number().optional(),
      missingCourses: z.array(z.string()).optional(),
      // 未回答の確認事項に関わる量。回答で変わりうる（H19）
      mayChange: z.literal(true).optional(),
      unreflected: z.literal(true).optional(),
    }),
  ),
  // 声かけの対象にだけ下書きを作る
  draft: z.string().nullable(),
});

export const confirmationSchema = z.object({
  proposalId: z.number(),
  respondent: respondentSchema,
  confirmedAt: z.string(),
});

export const datasetsResponseSchema = z.object({
  datasets: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      problems: z.array(z.string()),
      // 職員が確定したルールの対象にだけある
      confirmation: confirmationSchema.optional(),
      // 要項のある対象にだけある。見本にはない
      sourceId: z.string().optional(),
      // 確定した版に失格の再履修のルールがない（V-2）
      noRetakeRule: z.literal(true).optional(),
    }),
  ),
});

// 履修案の検査で、科目を候補から選ぶための科目データ。検査は科目名だけで行う
export const coursesResponseSchema = z.object({
  courses: z.array(
    z.object({
      name: z.string(),
      credits: z.number(),
      assignedYear: z.number(),
      offeredIn: z.enum(["前期", "後期", "通年"]).optional(),
    }),
  ),
});

// 履修案の検査の候補から外す科目（B41）。検査で必ず落ちる科目だけで、理由は検査と同じ文
export const planCandidatesRequestSchema = z.object({
  studentId: z.string().min(1),
  answers: answersSchema,
});

export const planCandidatesResponseSchema = z.object({
  unavailable: z.array(z.object({ course: z.string(), message: z.string() })),
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
  // 最終年次の卒業要件と区分ごとの判定の人数。学生 ID は含めない
  finalYear: z.object({
    minYears: z.number(),
    studentCount: z.number(),
    rows: z.array(
      z.object({
        ruleId: z.string(),
        kind: z.enum(["graduation", "category"]),
        name: z.string(),
        clause: z.string(),
        condition: z.string().optional(),
        counts: z.record(judgmentStatusSchema, z.number()),
        notApplicable: z.number(),
      }),
    ),
  }),
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
  // 履修の記録。判定案を成績と突き合わせて確かめるために出す
  records: z.array(
    z.object({
      course: z.string(),
      studentYear: z.number(),
      term: z.enum(["前期", "後期", "通年"]),
      result: z.enum(["passed", "failed", "disqualified", "enrolled"]),
    }),
  ),
});

export const planIssueSchema = z.object({
  code: z.enum([
    "TIME_CONFLICT",
    "OVER_LIMIT",
    "PREREQUISITE_NOT_MET",
    "NOT_OFFERED",
    "WRONG_YEAR",
    "ALREADY_EARNED",
    "DISQUALIFIED_RETAKE",
    "SEMINAR_LOCKED",
    "CATEGORY_LIMIT",
    "PENDING_RULE",
    "UNKNOWN_COURSE",
  ]),
  ruleId: z.string(),
  clause: z.string(),
  sourceQuote: z.string(),
  course: z.string().optional(),
  message: z.string(),
  hint: z.string(),
  ambiguityIds: z.array(z.string()),
});

export const planCheckResponseSchema = z.object({
  status: z.enum(["passed", "failed", "needs_staff"]),
  issues: z.array(planIssueSchema),
  warnings: z.array(z.string()),
  // 検査に通った履修案だけを返す
  plan: z.array(planEntrySchema).nullable(),
});

// 今期の登録をまとめて検査した結果（H25 の J）。検査に通らなかった学生だけを返す。
// 声かけと職員確認の人数には足さない
export const registrationCheckResponseSchema = z.object({
  // 今年度の履修中の記録がある学生の数
  checked: z.number(),
  results: z.array(
    z.object({
      studentId: z.string(),
      studentYear: z.number(),
      status: z.enum(["failed", "needs_staff"]),
      courses: z.array(z.string()),
      issues: z.array(planIssueSchema),
    }),
  ),
});

// 費用の上限として、要項の長さを制限する
export const MAX_HANDBOOK_LENGTH = 40000;

export const extractRequestSchema = z.object({
  handbook: z.string().trim().min(1).max(MAX_HANDBOOK_LENGTH),
});

export const sourcesResponseSchema = z.object({
  extractionEnabled: z.boolean(),
  sources: z.array(
    z.object({ id: z.string(), name: z.string(), handbook: z.string(), recorded: z.boolean() }),
  ),
});

export const storedProposalSchema = z.object({
  // 職員が確定するまでの案。形は engine が定める
  rules: z.custom<RuleSet>((value) => typeof value === "object" && value !== null),
  notes: z.array(z.object({ clause: z.string(), sourceQuote: z.string(), reason: z.string() })),
  problems: z.array(z.string()),
  // pending は未確定のルールで止まっている状態で、誤りではない
  caseResults: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      outcome: z.enum(["passed", "failed", "pending"]),
      expected: z.string(),
      actual: z.string(),
    }),
  ),
  runs: z.object({ requested: z.number(), succeeded: z.number() }),
  // 回によって読み取りが割れた項目。関係するルールは要確認にしてある
  disagreements: z.array(
    z.object({ item: z.string(), field: z.string(), values: z.array(z.string()) }),
  ),
  // 土台の案のルールに結びつけられなかった質問。判定には反映されない
  extraQuestions: z.array(
    z.object({
      clause: z.string(),
      sourceQuote: z.string(),
      question: z.string(),
      options: z.array(z.string()),
    }),
  ),
  attempts: z.array(
    z.object({
      problems: z.number(),
      model: z.string(),
      usage: z.object({
        inputTokens: z.number(),
        outputTokens: z.number(),
        cacheReadTokens: z.number(),
        cacheWriteTokens: z.number(),
      }),
    }),
  ),
  // 記録を読み込んだ案にだけ付く。この案では Claude を呼んでいない
  recording: z.object({ model: z.string(), recordedAt: z.string() }).optional(),
});

export const proposalResponseSchema = storedProposalSchema.extend({
  // 保存できなかった案は確定できない
  proposalId: z.number().nullable(),
  // 検査に問題が残る案では人数を計算しない
  impacts: z.array(impactSchema).nullable(),
  // どの区分にも入らない科目。確定は止めないが、修得した学生の卒業要件は職員確認になる
  strayCourses: z.array(z.string()),
});

export const latestProposalResponseSchema = z.object({
  proposal: proposalResponseSchema.nullable(),
});

// 要項の版の比較。同じ大学の一つ前の確定版と、この案のルールの差分（H25 の G）
const ambiguitySummarySchema = z.object({ id: z.string(), clause: z.string(), question: z.string() });

export const versionCompareResponseSchema = z.object({
  // 比べた確定版。確定版がなければ null
  base: z.object({ version: z.number(), respondent: respondentSchema, confirmedAt: z.string() }).nullable(),
  diff: z
    .object({
      changed: z.array(z.object({ item: z.string(), field: z.string(), before: z.string(), after: z.string() })),
      removed: z.array(z.string()),
      added: z.array(z.string()),
      ambiguitiesRemoved: z.array(ambiguitySummarySchema),
      ambiguitiesAdded: z.array(ambiguitySummarySchema),
    })
    .nullable(),
});

export const confirmRequestSchema = z.object({
  respondent: respondentSchema,
  acceptedRuleIds: z.array(z.string()),
});

export const confirmResponseSchema = z.object({ datasetId: z.string() });

export const withdrawRequestSchema = z.object({ respondent: respondentSchema });

export type Answers = z.infer<typeof answersSchema>;
export type Respondent = z.infer<typeof respondentSchema>;
export type AnswerRecord = z.infer<typeof answerRecordSchema>;
export type AnswerRecordsResponse = z.infer<typeof answerRecordsResponseSchema>;
export type PreviousAnswer = z.infer<typeof previousAnswerSchema>;
export type AnswerHistoryEntry = z.infer<typeof answerHistoryEntrySchema>;
export type PlanEntry = z.infer<typeof planEntrySchema>;
export type JudgmentStatus = z.infer<typeof judgmentStatusSchema>;
export type Judgment = z.infer<typeof judgmentSchema>;
export type Impact = z.infer<typeof impactSchema>;
export type Outreach = z.infer<typeof outreachSchema>;
export type DatasetsResponse = z.infer<typeof datasetsResponseSchema>;
export type CoursesResponse = z.infer<typeof coursesResponseSchema>;
export type PlanCandidatesResponse = z.infer<typeof planCandidatesResponseSchema>;
export type OverviewResponse = z.infer<typeof overviewResponseSchema>;
export type StudentResponse = z.infer<typeof studentResponseSchema>;
export type PlanCheckResponse = z.infer<typeof planCheckResponseSchema>;
export type RegistrationCheckResponse = z.infer<typeof registrationCheckResponseSchema>;
export type SourcesResponse = z.infer<typeof sourcesResponseSchema>;
export type StoredProposal = z.infer<typeof storedProposalSchema>;
export type ProposalResponse = z.infer<typeof proposalResponseSchema>;
export type LatestProposalResponse = z.infer<typeof latestProposalResponseSchema>;
export type VersionCompareResponse = z.infer<typeof versionCompareResponseSchema>;
export type ConfirmResponse = z.infer<typeof confirmResponseSchema>;
