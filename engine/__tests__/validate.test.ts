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
      (rules) => (rules.ambiguities[0]!.options[0]!.patches![0]!.ruleId = "typo"),
    );
    expect(problems).toEqual([expect.stringContaining("typo")]);
  });

  it("patches の field の書き間違いを見つける", () => {
    const problems = problemsAfter(
      (rules) => (rules.ambiguities[0]!.options[0]!.patches![0]!.field = "creditBasiss"),
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
    expect(problemsAfter((rules) => (rules.prerequisites[0]!.conditions = [["typo"]]))).toEqual([
      expect.stringContaining("typo"),
    ]);
  });

  it("存在しない上限の科目群を見つける", () => {
    expect(
      problemsAfter((rules) => {
        rules.categories.at(-1)!.subLimits = [{ groups: ["typo"], maxCredits: 1 }];
      }),
    ).toEqual([expect.stringContaining("typo")]);
  });

  it("存在しない先修の対象科目を見つける", () => {
    expect(problemsAfter((rules) => (rules.prerequisites[0]!.course = "typo"))).toEqual([
      expect.stringContaining("typo"),
    ]);
  });

  it("patches の値の型の違いを見つける", () => {
    const problems = problemsAfter((rules) => {
      rules.ambiguities[0]!.options[0]!.patches = [
        { ruleId: "load-normal", field: "maxPerTerm", value: "24" },
      ];
    });
    expect(problems).toEqual([expect.stringContaining("型")]);
  });

  it("差分が空の選択肢を見つける", () => {
    const problems = problemsAfter((rules) => (rules.ambiguities[0]!.options[0]!.patches = []));
    expect(problems).toEqual([expect.stringContaining("差分が空")]);
  });

  it("算入先の循環を見つける", () => {
    const problems = problemsAfter(
      (rules) => (rules.categories.at(-1)!.overflowTo = "major-a-no-minor"),
    );
    expect(problems).toEqual([expect.stringContaining("循環")]);
  });

  it("patches の不正な算入先を見つける", () => {
    const problems = problemsAfter((rules) => {
      rules.ambiguities[0]!.options[0]!.patches = [
        { ruleId: "free", field: "overflowTo", value: "typo" },
      ];
    });
    expect(problems).toEqual([expect.stringContaining("typo")]);
  });

  it("どのルールからも参照されない曖昧箇所を見つける", () => {
    const problems = problemsAfter((rules) => {
      rules.gates[0]!.ambiguityIds = [];
      rules.ambiguities[0]!.options.forEach((option) => (option.patches = null));
    });
    expect(problems).toEqual([expect.stringContaining("参照されていません")]);
  });

  it("根拠の文がないルールを見つける", () => {
    expect(problemsAfter((rules) => (rules.gates[0]!.sourceQuote = " "))).toEqual([
      expect.stringContaining("根拠の文"),
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
    rules.ambiguities[0]!.options[0]!.patches![0]!.field = "creditBasiss";
    expect(() =>
      resolveRules(rules, { "ambiguity-seminar-credits": "include" }),
    ).toThrow("creditBasiss");
  });

  it("値の型の違いはエラーにする", () => {
    const rules = structuredClone(exampleRules);
    rules.ambiguities[0]!.options[0]!.patches = [
      { ruleId: "load-normal", field: "maxPerTerm", value: "24" },
    ];
    expect(() => resolveRules(rules, { "ambiguity-seminar-credits": "include" })).toThrow("型");
  });
});
