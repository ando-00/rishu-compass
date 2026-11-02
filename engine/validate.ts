import { isPatchableField, listRules } from "./answers";
import type { Course } from "./model";
import type { RuleSet } from "./rules";

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

  for (const gate of rules.gates) {
    gate.requiredCourses.forEach((name) => checkCourse(gate.id, name));
    if (gate.target.kind === "course") {
      gate.target.courses.forEach((name) => checkCourse(gate.id, name));
    }
  }

  for (const prerequisite of rules.prerequisites) {
    checkCourse(prerequisite.id, prerequisite.course);
    prerequisite.anyOf.forEach((name) => checkCourse(prerequisite.id, name));
  }

  for (const limit of rules.courseCountLimits) checkGroup(limit.id, limit.group);

  for (const ambiguity of rules.ambiguities) {
    for (const option of ambiguity.options) {
      for (const patch of option.patches) {
        const where = `${ambiguity.id} の ${option.id}`;
        const target = entries.find(({ rule }) => rule.id === patch.ruleId);
        if (!target) problems.push(`${where}: ルールがありません: ${patch.ruleId}`);
        else if (!isPatchableField(target.kind, patch.field)) {
          problems.push(`${where}: 変更できない項目です: ${patch.ruleId} の ${patch.field}`);
        }
      }
    }
  }

  return problems;
}
