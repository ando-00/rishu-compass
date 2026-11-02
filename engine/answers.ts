import type { Answers } from "./model";
import type { RuleSet } from "./rules";

// 回答で変えられる項目。書き間違いが何も変えずに通らないよう、ここにないものは拒む。
const PATCHABLE_FIELDS = {
  graduation: ["minYears", "totalCredits"],
  category: ["minCredits", "requireAll", "maxCredits", "overflowTo"],
  gate: ["checkAtEndOfYear", "minCredits", "creditBasis", "retryAfterMet"],
  load: ["maxPerYear", "maxPerTerm", "countsRetakes", "countsIntensive", "splitsYearLong"],
  courseCount: ["maxPerTerm"],
  prerequisite: ["allowSameTerm"],
  enrollment: ["forbidBeforeAssignedYear", "forbidRetakeOfPassed"],
} as const;

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
  ];
}

export function isPatchableField(kind: RuleKind, field: string) {
  return (PATCHABLE_FIELDS[kind] as readonly string[]).includes(field);
}

export function resolveRules(base: RuleSet, answers: Answers) {
  const rules = structuredClone(base);
  const unresolved = new Set(rules.ambiguities.map((ambiguity) => ambiguity.id));

  for (const [ambiguityId, optionId] of Object.entries(answers)) {
    const ambiguity = rules.ambiguities.find((a) => a.id === ambiguityId);
    if (!ambiguity) throw new Error(`曖昧箇所がありません: ${ambiguityId}`);
    const option = ambiguity.options.find((o) => o.id === optionId);
    if (!option) throw new Error(`選択肢がありません: ${ambiguityId} の ${optionId}`);

    for (const patch of option.patches) {
      const target = listRules(rules).find(({ rule }) => rule.id === patch.ruleId);
      if (!target) throw new Error(`ルールがありません: ${patch.ruleId}`);
      if (!isPatchableField(target.kind, patch.field)) {
        throw new Error(`変更できない項目です: ${patch.ruleId} の ${patch.field}`);
      }
      (target.rule as Record<string, unknown>)[patch.field] = patch.value;
    }
    unresolved.delete(ambiguityId);
  }

  return { rules, unresolved };
}
