import type { Answers } from "./model";
import type { RulePatch, RuleSet } from "./rules";

type FieldType = "number" | "boolean" | "nullableNumber" | "nullableText" | readonly string[];

// 回答で変えられる項目と値の型。書き間違いが何も変えずに通らないよう、ここにないものは拒む。
const PATCHABLE_FIELDS = {
  graduation: { minYears: "number", totalCredits: "number" },
  category: {
    minCredits: "number",
    requireAll: "boolean",
    maxCredits: "nullableNumber",
    overflowTo: "nullableText",
  },
  gate: {
    checkAtEndOfYear: "number",
    minCredits: "number",
    creditBasis: ["earned", "countable"],
    requiredMayBeEnrolled: "boolean",
    enrolledThroughCheckOnly: "boolean",
    retryAfterMet: "boolean",
  },
  load: {
    maxPerYear: "number",
    maxPerTerm: "number",
    retakeExclusion: ["none", "failed", "failed_or_disqualified"],
  },
  courseCount: { maxPerTerm: "number" },
  prerequisite: { allowSameTerm: "boolean" },
  enrollment: { forbidBeforeAssignedYear: "boolean", forbidRetakeOfPassed: "boolean" },
  retake: { forbidDisqualified: "boolean" },
  timetable: {},
} as const satisfies Record<string, Record<string, FieldType>>;

type RuleKind = keyof typeof PATCHABLE_FIELDS;

export function listRules(rules: RuleSet) {
  const tagged = <T>(kind: RuleKind, list: T[]) => list.map((rule) => ({ kind, rule }));
  return [
    ...tagged("graduation", [rules.graduation]),
    ...tagged("category", rules.categories),
    ...tagged("gate", rules.gates),
    ...tagged("load", rules.loadLimits),
    ...tagged("courseCount", rules.courseCountLimits),
    ...tagged("prerequisite", rules.prerequisites),
    ...tagged("enrollment", rules.enrollment ? [rules.enrollment] : []),
    ...tagged("retake", rules.retake ? [rules.retake] : []),
    ...tagged("timetable", rules.timetable ? [rules.timetable] : []),
  ];
}

function matchesType(type: FieldType, value: RulePatch["value"]) {
  if (typeof type !== "string") return typeof value === "string" && type.includes(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "nullableNumber") return value === null || typeof value === "number";
  return value === null || typeof value === "string";
}

export function patchProblem(rules: RuleSet, patch: RulePatch) {
  const target = listRules(rules).find(({ rule }) => rule.id === patch.ruleId);
  if (!target) return `ルールがありません: ${patch.ruleId}`;
  const fields: Record<string, FieldType> = PATCHABLE_FIELDS[target.kind];
  const type = fields[patch.field];
  if (type === undefined) return `変更できない項目です: ${patch.ruleId} の ${patch.field}`;
  if (!matchesType(type, patch.value)) {
    return `値の型が違います: ${patch.ruleId} の ${patch.field}`;
  }
  return null;
}

export function resolveRules(base: RuleSet, answers: Answers) {
  const rules = structuredClone(base);
  const entries = listRules(rules);
  const unresolved = new Set(rules.ambiguities.map((ambiguity) => ambiguity.id));

  for (const [ambiguityId, optionId] of Object.entries(answers)) {
    const ambiguity = rules.ambiguities.find((a) => a.id === ambiguityId);
    if (!ambiguity) throw new Error(`曖昧箇所がありません: ${ambiguityId}`);
    const option = ambiguity.options.find((o) => o.id === optionId);
    if (!option) throw new Error(`選択肢がありません: ${ambiguityId} の ${optionId}`);

    // 差分で表せない回答は反映できないので、未解決のまま残す。
    if (option.patches === null) continue;
    for (const patch of option.patches) {
      const problem = patchProblem(rules, patch);
      if (problem) throw new Error(problem);
      const target = entries.find(({ rule }) => rule.id === patch.ruleId);
      (target?.rule as Record<string, unknown>)[patch.field] = patch.value;
    }
    unresolved.delete(ambiguityId);
  }

  // 未解決の曖昧箇所が書き換えるルールは、ambiguityIds になくても未確定として扱う。
  // 超過分の算入先を書き換えるときは、回答で単位を受け取る区分も未確定になる。
  for (const ambiguity of rules.ambiguities) {
    if (!unresolved.has(ambiguity.id)) continue;
    for (const option of ambiguity.options) {
      for (const patch of option.patches ?? []) {
        const touched = patch.field === "overflowTo" ? [patch.ruleId, patch.value] : [patch.ruleId];
        for (const { rule } of entries.filter(({ rule }) => touched.includes(rule.id))) {
          const ids = (rule.ambiguityIds ??= []);
          if (!ids.includes(ambiguity.id)) ids.push(ambiguity.id);
        }
      }
    }
  }

  return { rules, unresolved };
}
