import { describe, expect, it } from "vitest";
import { exampleCourses } from "../../data/fictional/example/courses";
import { exampleRules } from "../../data/fictional/example/rules";
import { resolveRules } from "../answers";
import { validateRuleSet } from "../validate";

function problemsAfter(change: (rules: typeof exampleRules) => void) {
  const rules = structuredClone(exampleRules);
  change(rules);
  return validateRuleSet(rules, exampleCourses);
}

describe("validateRuleSet", () => {
  it("見本のルールに問題はない", () => {
    expect(validateRuleSet(exampleRules, exampleCourses)).toEqual([]);
  });

  it("ルールの id の重複を見つける", () => {
    expect(problemsAfter((rules) => (rules.gates[1]!.id = "gate-seminar"))).toEqual([
      expect.stringContaining("重複"),
    ]);
  });

  it("存在しない ambiguityIds を見つける", () => {
    const problems = problemsAfter((rules) => (rules.gates[0]!.ambiguityIds = ["typo"]));
    expect(problems).toEqual([expect.stringContaining("typo")]);
  });

  it("存在しない patches の ruleId を見つける", () => {
    const problems = problemsAfter(
      (rules) => (rules.ambiguities[0]!.options[0]!.patches[0]!.ruleId = "typo"),
    );
    expect(problems).toEqual([expect.stringContaining("typo")]);
  });

  it("patches の field の書き間違いを見つける", () => {
    const problems = problemsAfter(
      (rules) => (rules.ambiguities[0]!.options[0]!.patches[0]!.field = "creditBasiss"),
    );
    expect(problems).toEqual([expect.stringContaining("creditBasiss")]);
  });

  it("存在しない overflowTo を見つける", () => {
    const problems = problemsAfter((rules) => (rules.categories[1]!.overflowTo = "typo"));
    expect(problems).toEqual([expect.stringContaining("typo")]);
  });

  it("存在しない groups を見つける", () => {
    const problems = problemsAfter((rules) => (rules.categories[0]!.groups = ["typo"]));
    expect(problems).toEqual([expect.stringContaining("typo")]);
  });

  it("存在しない科目名を見つける", () => {
    expect(problemsAfter((rules) => (rules.gates[0]!.requiredCourses = ["typo"]))).toEqual([
      expect.stringContaining("typo"),
    ]);
    expect(problemsAfter((rules) => (rules.prerequisites[0]!.anyOf = ["typo"]))).toEqual([
      expect.stringContaining("typo"),
    ]);
  });

  it("存在しない科目数上限の科目群を見つける", () => {
    expect(problemsAfter((rules) => (rules.courseCountLimits[0]!.group = "typo"))).toEqual([
      expect.stringContaining("typo"),
    ]);
  });
});

describe("resolveRules の項目の検査", () => {
  it("field の書き間違いはエラーにする", () => {
    const rules = structuredClone(exampleRules);
    rules.ambiguities[0]!.options[0]!.patches[0]!.field = "creditBasiss";
    expect(() =>
      resolveRules(rules, { "ambiguity-seminar-credits": "include" }),
    ).toThrow("creditBasiss");
  });

  it("patches が空の選択肢も回答済みとして扱う", () => {
    const rules = structuredClone(exampleRules);
    rules.ambiguities[0]!.options[0]!.patches = [];
    const { rules: resolved, unresolved } = resolveRules(rules, {
      "ambiguity-seminar-credits": "include",
    });
    expect(unresolved.size).toBe(0);
    expect(resolved.gates).toEqual(rules.gates);
  });
});
