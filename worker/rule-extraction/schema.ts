import { z } from "zod";
import type { Course, RuleSet, Student } from "../../engine";
import type { GateTarget, StudentCondition } from "../../engine/rules";

// Structured Outputs はスキーマの文法の大きさに上限がある。ルールの種類ごとに別の形を書くと
// 「The compiled grammar is too large」で拒まれる（項目を減らしても通らなかった）。
// そのため API で保証するのは共通の行の形までとし、種類ごとの項目は detail の JSON 文字列で受け取って、
// ここの detailSchemas で検証する。
const RULE_KINDS = [
  "graduation",
  "category",
  "gate",
  "load",
  "courseCount",
  "prerequisite",
  "enrollment",
] as const;

const ruleRowSchema = z.object({
  kind: z.enum(RULE_KINDS),
  id: z.string(),
  clause: z.string(),
  sourceQuote: z.string(),
  status: z.enum(["confirmed", "needs_review"]),
  when: z.array(
    z.object({
      field: z.enum(["major", "hasMinor", "minStudentYear", "minPreviousGpa"]),
      value: z.string(),
    }),
  ),
  ambiguityIds: z.array(z.string()),
  detail: z.string(),
});

export const extractionOutputSchema = z.object({
  rules: z.array(ruleRowSchema),
  ambiguities: z.array(
    z.object({
      id: z.string(),
      clause: z.string(),
      sourceQuote: z.string(),
      question: z.string(),
      options: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          patches: z
            .array(
              z.object({
                ruleId: z.string(),
                field: z.string(),
                value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
              }),
            )
            .nullable(),
        }),
      ),
    }),
  ),
  notes: z.array(
    z.object({ clause: z.string(), sourceQuote: z.string(), reason: z.string() }),
  ),
});

const count = z.number().int().min(0);

// 書き間違えた項目が黙って消えないよう、未知の項目を拒む。
const detailSchemas = {
  graduation: z.strictObject({ minYears: count, totalCredits: count }),
  category: z.strictObject({
    name: z.string(),
    groups: z.array(z.string()),
    minCredits: count,
    requireAll: z.boolean(),
    maxCredits: count.nullable(),
    overflowTo: z.string().nullable(),
    subLimits: z.array(z.strictObject({ groups: z.array(z.string()), maxCredits: count })),
  }),
  gate: z.strictObject({
    name: z.string(),
    target: z.strictObject({
      kind: z.enum(["course", "promotion"]),
      courses: z.array(z.string()),
      toYear: count.nullable(),
    }),
    checkAtEndOfYear: count,
    minCredits: count.nullable(),
    creditBasis: z.enum(["earned", "countable"]).nullable(),
    requiredCourses: z.array(z.string()),
    requiredMayBeEnrolled: z.boolean(),
    retryAfterMet: z.boolean(),
  }),
  load: z.strictObject({
    maxPerYear: count.nullable(),
    maxPerTerm: count,
    retakeExclusion: z.enum(["none", "failed", "failed_or_disqualified"]),
  }),
  courseCount: z.strictObject({ group: z.string(), maxPerTerm: count }),
  prerequisite: z.strictObject({
    course: z.string(),
    conditions: z.array(z.array(z.string())),
    allowSameTerm: z.boolean(),
  }),
  enrollment: z.strictObject({
    forbidBeforeAssignedYear: z.boolean(),
    forbidRetakeOfPassed: z.boolean(),
  }),
};

export type ExtractionOutput = z.infer<typeof extractionOutputSchema>;
export type ExtractionNote = ExtractionOutput["notes"][number];

type RuleRow = ExtractionOutput["rules"][number];
type RuleKind = RuleRow["kind"];

export type RuleSetMeta = {
  id: string;
  name: string;
  admissionYears: number[];
};

export type ExtractionSource = RuleSetMeta & {
  courses: Course[];
  students: Student[];
};

function toCondition(rule: RuleRow, problems: string[]) {
  const condition: StudentCondition = {};
  const invalid = (field: string, value: string) =>
    problems.push(`${rule.id}: 適用条件 ${field} の値を読めません: ${value}`);

  for (const { field, value } of rule.when) {
    if (field in condition) {
      problems.push(`${rule.id}: 適用条件 ${field} が重複しています`);
    } else if (field === "major") {
      condition.major = value;
    } else if (field === "hasMinor") {
      if (value === "true" || value === "false") condition.hasMinor = value === "true";
      else invalid(field, value);
    } else {
      const number = Number(value);
      if (value.trim() === "" || !Number.isFinite(number)) invalid(field, value);
      else condition[field] = number;
    }
  }
  return condition;
}

function toBase(rule: RuleRow, problems: string[]) {
  const when = toCondition(rule, problems);
  return {
    id: rule.id,
    clause: rule.clause,
    sourceQuote: rule.sourceQuote,
    ...(rule.status === "needs_review" ? { status: rule.status } : {}),
    ...(Object.keys(when).length > 0 ? { when } : {}),
    ...(rule.ambiguityIds.length > 0 ? { ambiguityIds: rule.ambiguityIds } : {}),
  };
}

function parseDetail<K extends RuleKind>(rule: RuleRow, kind: K, problems: string[]) {
  let json: unknown;
  try {
    json = JSON.parse(rule.detail);
  } catch {
    problems.push(`${rule.id}: detail を JSON として読めません`);
    return null;
  }
  const parsed = detailSchemas[kind].safeParse(json);
  if (parsed.success) return parsed.data as z.infer<(typeof detailSchemas)[K]>;
  for (const issue of parsed.error.issues) {
    problems.push(`${rule.id}: detail の ${issue.path.join(".") || "全体"}: ${issue.message}`);
  }
  return null;
}

function toTarget(
  id: string,
  { kind, courses, toYear }: z.infer<typeof detailSchemas.gate>["target"],
  problems: string[],
): GateTarget {
  if (kind === "course") return { kind, courses };
  if (toYear === null) problems.push(`${id}: 進級先の年次がありません`);
  return { kind, toYear: toYear ?? 0 };
}

export function toRuleSet(output: ExtractionOutput, meta: RuleSetMeta) {
  const problems: string[] = [];

  const collect = <K extends RuleKind, R>(
    kind: K,
    build: (base: ReturnType<typeof toBase>, detail: z.infer<(typeof detailSchemas)[K]>) => R,
  ) =>
    output.rules
      .filter((rule) => rule.kind === kind)
      .flatMap((rule) => {
        const detail = parseDetail(rule, kind, problems);
        return detail ? [build(toBase(rule, problems), detail)] : [];
      });

  const [graduation, ...extraGraduation] = collect("graduation", (base, detail) => ({
    ...base,
    ...detail,
  }));
  const [enrollment, ...extraEnrollment] = collect("enrollment", (base, detail) => ({
    ...base,
    ...detail,
  }));
  if (extraGraduation.length > 0) problems.push("graduation は1件だけ書いてください");
  if (extraEnrollment.length > 0) problems.push("enrollment は1件以下にしてください");

  const categories = collect("category", (base, { maxCredits, subLimits, ...detail }) => ({
    ...base,
    ...detail,
    ...(maxCredits === null ? {} : { maxCredits }),
    ...(subLimits.length > 0 ? { subLimits } : {}),
  }));
  const gates = collect(
    "gate",
    (base, { target, minCredits, creditBasis, requiredMayBeEnrolled, ...detail }) => ({
      ...base,
      ...detail,
      target: toTarget(base.id, target, problems),
      ...(minCredits === null ? {} : { minCredits }),
      ...(creditBasis === null ? {} : { creditBasis }),
      ...(requiredMayBeEnrolled ? { requiredMayBeEnrolled } : {}),
    }),
  );
  const loadLimits = collect("load", (base, { maxPerYear, ...detail }) => ({
    ...base,
    ...detail,
    ...(maxPerYear === null ? {} : { maxPerYear }),
  }));
  const courseCountLimits = collect("courseCount", (base, detail) => ({ ...base, ...detail }));
  const prerequisites = collect("prerequisite", (base, detail) => ({ ...base, ...detail }));

  if (!graduation) {
    problems.push("graduation（卒業要件）がありません");
    return { rules: null, notes: output.notes, problems };
  }

  const rules: RuleSet = {
    id: meta.id,
    name: meta.name,
    admissionYears: meta.admissionYears,
    graduation,
    categories,
    gates,
    loadLimits,
    courseCountLimits,
    prerequisites,
    ...(enrollment ? { enrollment } : {}),
    ambiguities: output.ambiguities,
  };
  return { rules, notes: output.notes, problems };
}
