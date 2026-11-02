import { z } from "zod";
import type { Course, RuleSet, Student } from "../../engine";
import type { GateTarget, StudentCondition } from "../../engine/rules";

// Structured Outputs には任意の項目と型の組み合わせの数に制限がある。
// そのため engine の RuleSet とは別に、項目をすべて必須にした形で受け取り、toRuleSet で変換する。
const ruleBase = {
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
};

export const extractionOutputSchema = z.object({
  graduation: z.object({
    ...ruleBase,
    minYears: z.number().int(),
    totalCredits: z.number().int(),
  }),
  categories: z.array(
    z.object({
      ...ruleBase,
      name: z.string(),
      groups: z.array(z.string()),
      minCredits: z.number().int(),
      requireAll: z.boolean(),
      maxCredits: z.number().int().nullable(),
      overflowTo: z.string().nullable(),
      subLimits: z.array(
        z.object({ groups: z.array(z.string()), maxCredits: z.number().int() }),
      ),
    }),
  ),
  gates: z.array(
    z.object({
      ...ruleBase,
      name: z.string(),
      target: z.object({
        kind: z.enum(["course", "promotion"]),
        courses: z.array(z.string()),
        toYear: z.number().int().nullable(),
      }),
      checkAtEndOfYear: z.number().int(),
      minCredits: z.number().int().nullable(),
      creditBasis: z.enum(["earned", "countable"]).nullable(),
      requiredCourses: z.array(z.string()),
      requiredMayBeEnrolled: z.boolean(),
      retryAfterMet: z.boolean(),
    }),
  ),
  loadLimits: z.array(
    z.object({
      ...ruleBase,
      maxPerYear: z.number().int().nullable(),
      maxPerTerm: z.number().int(),
      retakeExclusion: z.enum(["none", "failed", "failed_or_disqualified"]),
    }),
  ),
  courseCountLimits: z.array(
    z.object({ ...ruleBase, group: z.string(), maxPerTerm: z.number().int() }),
  ),
  prerequisites: z.array(
    z.object({
      ...ruleBase,
      course: z.string(),
      conditions: z.array(z.array(z.string())),
      allowSameTerm: z.boolean(),
    }),
  ),
  enrollment: z
    .object({
      ...ruleBase,
      forbidBeforeAssignedYear: z.boolean(),
      forbidRetakeOfPassed: z.boolean(),
    })
    .nullable(),
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

export type ExtractionOutput = z.infer<typeof extractionOutputSchema>;
export type ExtractionNote = ExtractionOutput["notes"][number];

export type RuleSetMeta = {
  id: string;
  name: string;
  admissionYears: number[];
};

export type ExtractionSource = RuleSetMeta & {
  courses: Course[];
  students: Student[];
};

type OutputBase = Pick<ExtractionOutput["graduation"], "id" | "clause" | "sourceQuote" | "status" | "when" | "ambiguityIds">;

function toCondition(rule: OutputBase, problems: string[]) {
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

function toBase(rule: OutputBase, problems: string[]) {
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

function toTarget(gate: ExtractionOutput["gates"][number], problems: string[]): GateTarget {
  const { kind, courses, toYear } = gate.target;
  if (kind === "course") return { kind, courses };
  if (toYear === null) problems.push(`${gate.id}: 進級先の年次がありません`);
  return { kind, toYear: toYear ?? 0 };
}

export function toRuleSet(output: ExtractionOutput, meta: RuleSetMeta) {
  const problems: string[] = [];
  const rules: RuleSet = {
    id: meta.id,
    name: meta.name,
    admissionYears: meta.admissionYears,
    graduation: {
      ...toBase(output.graduation, problems),
      minYears: output.graduation.minYears,
      totalCredits: output.graduation.totalCredits,
    },
    categories: output.categories.map((category) => ({
      ...toBase(category, problems),
      name: category.name,
      groups: category.groups,
      minCredits: category.minCredits,
      requireAll: category.requireAll,
      ...(category.maxCredits === null ? {} : { maxCredits: category.maxCredits }),
      overflowTo: category.overflowTo,
      ...(category.subLimits.length > 0 ? { subLimits: category.subLimits } : {}),
    })),
    gates: output.gates.map((gate) => ({
      ...toBase(gate, problems),
      name: gate.name,
      target: toTarget(gate, problems),
      checkAtEndOfYear: gate.checkAtEndOfYear,
      ...(gate.minCredits === null ? {} : { minCredits: gate.minCredits }),
      ...(gate.creditBasis === null ? {} : { creditBasis: gate.creditBasis }),
      requiredCourses: gate.requiredCourses,
      ...(gate.requiredMayBeEnrolled ? { requiredMayBeEnrolled: true } : {}),
      retryAfterMet: gate.retryAfterMet,
    })),
    loadLimits: output.loadLimits.map((limit) => ({
      ...toBase(limit, problems),
      ...(limit.maxPerYear === null ? {} : { maxPerYear: limit.maxPerYear }),
      maxPerTerm: limit.maxPerTerm,
      retakeExclusion: limit.retakeExclusion,
    })),
    courseCountLimits: output.courseCountLimits.map((limit) => ({
      ...toBase(limit, problems),
      group: limit.group,
      maxPerTerm: limit.maxPerTerm,
    })),
    prerequisites: output.prerequisites.map((prerequisite) => ({
      ...toBase(prerequisite, problems),
      course: prerequisite.course,
      conditions: prerequisite.conditions,
      allowSameTerm: prerequisite.allowSameTerm,
    })),
    ...(output.enrollment
      ? {
          enrollment: {
            ...toBase(output.enrollment, problems),
            forbidBeforeAssignedYear: output.enrollment.forbidBeforeAssignedYear,
            forbidRetakeOfPassed: output.enrollment.forbidRetakeOfPassed,
          },
        }
      : {}),
    ambiguities: output.ambiguities,
  };
  return { rules, notes: output.notes, problems };
}
