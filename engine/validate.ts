import { listRules, patchProblem } from "./answers";
import { sortByOverflow } from "./credits";
import type { Course } from "./model";
import type { Category, RuleSet } from "./rules";

function overflowProblem(categories: Category[]) {
  try {
    sortByOverflow(categories.map((c) => ({ ...c, when: undefined } as Category)));
    return null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : "算入先を確認できません";
  }
}

// 型では防げない参照切れを探す。問題の一覧を返し、空なら問題なし。
export function validateRuleSet(rules: RuleSet, courses: Course[]) {
  const problems: string[] = [];
  const entries = listRules(rules);
  const ruleIds = new Set<string>();
  const courseNames = new Set(courses.map((course) => course.name));
  const groups = new Set(courses.flatMap((course) => course.groups));
  const categoryIds = new Set(rules.categories.map((category) => category.id));
  const ambiguityIds = new Set(rules.ambiguities.map((ambiguity) => ambiguity.id));

  const checkCourse = (where: string, name: string) => {
    if (!courseNames.has(name)) problems.push(`${where}: 科目がありません: ${name}`);
  };
  const checkGroup = (where: string, name: string) => {
    if (!groups.has(name)) problems.push(`${where}: 科目群がありません: ${name}`);
  };

  for (const { rule } of entries) {
    if (ruleIds.has(rule.id)) problems.push(`${rule.id}: ルールの id が重複しています`);
    ruleIds.add(rule.id);
    if (rule.sourceQuote.trim() === "") problems.push(`${rule.id}: 根拠の文がありません`);
    for (const id of rule.ambiguityIds ?? []) {
      if (!ambiguityIds.has(id)) problems.push(`${rule.id}: 曖昧箇所がありません: ${id}`);
    }
  }

  for (const category of rules.categories) {
    const { id, overflowTo } = category;
    if (overflowTo !== null && !categoryIds.has(overflowTo)) {
      problems.push(`${id}: 算入先がありません: ${overflowTo}`);
    }
    category.groups.forEach((group) => checkGroup(id, group));
    category.subLimits?.forEach((limit) => limit.groups.forEach((group) => checkGroup(id, group)));
  }

  if (rules.categories.every(({ overflowTo }) => overflowTo === null || categoryIds.has(overflowTo))) {
    const problem = overflowProblem(rules.categories);
    if (problem) problems.push(problem);
  }

  for (const gate of rules.gates) {
    gate.requiredCourses.forEach((name) => checkCourse(gate.id, name));
    if (gate.target.kind === "course") {
      gate.target.courses.forEach((name) => checkCourse(gate.id, name));
    }
  }

  for (const prerequisite of rules.prerequisites) {
    checkCourse(prerequisite.id, prerequisite.course);
    prerequisite.conditions.flat().forEach((name) => checkCourse(prerequisite.id, name));
    if (prerequisite.conditions.length === 0 || prerequisite.conditions.some((c) => c.length === 0)) {
      problems.push(`${prerequisite.id}: 先修の条件が空です`);
    }
  }

  for (const limit of rules.courseCountLimits) checkGroup(limit.id, limit.group);

  for (const ambiguity of rules.ambiguities) {
    if (ambiguity.sourceQuote.trim() === "") problems.push(`${ambiguity.id}: 根拠の文がありません`);
    const referenced = entries.some(({ rule }) => rule.ambiguityIds?.includes(ambiguity.id));
    const patched = ambiguity.options.some((option) => (option.patches ?? []).length > 0);
    if (!referenced && !patched) {
      problems.push(`${ambiguity.id}: どのルールからも参照されていません`);
    }
    for (const option of ambiguity.options) {
      const where = `${ambiguity.id} の ${option.id}`;
      if (option.patches?.length === 0) {
        problems.push(`${where}: 差分が空です。表せないなら patches を null にしてください`);
      }
      for (const patch of option.patches ?? []) {
        const problem = patchProblem(rules, patch);
        if (problem) problems.push(`${where}: ${problem}`);
        if (patch.field === "overflowTo" && patch.value !== null && !categoryIds.has(String(patch.value))) {
          problems.push(`${where}: 算入先がありません: ${String(patch.value)}`);
        }
      }
    }
  }

  return problems;
}
