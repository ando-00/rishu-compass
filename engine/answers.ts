import type { Answers } from "./model";
import type { RuleSet } from "./rules";

function allRules(rules: RuleSet) {
  return [
    rules.graduation,
    ...rules.categories,
    ...rules.gates,
    ...rules.loadLimits,
    ...rules.courseCountLimits,
    ...rules.prerequisites,
    ...(rules.enrollment ? [rules.enrollment] : []),
  ];
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
      const rule = allRules(rules).find((r) => r.id === patch.ruleId);
      if (!rule) throw new Error(`ルールがありません: ${patch.ruleId}`);
      (rule as Record<string, unknown>)[patch.field] = patch.value;
    }
    unresolved.delete(ambiguityId);
  }

  return { rules, unresolved };
}
