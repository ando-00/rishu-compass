import { describe, expect, it } from "vitest";
import { exampleRules } from "../../data/fictional/example/rules";
import { resolveRules } from "../answers";

const gate = (rules: typeof exampleRules) => rules.gates.find((g) => g.id === "gate-seminar");

describe("resolveRules", () => {
  it("未回答の曖昧箇所を未解決として返す", () => {
    const { rules, unresolved } = resolveRules(exampleRules, {});
    expect(unresolved).toEqual(new Set(["ambiguity-seminar-credits"]));
    expect(gate(rules)?.creditBasis).toBe("earned");
  });

  it("回答した選択肢の値をルールに反映する", () => {
    const { rules, unresolved } = resolveRules(exampleRules, {
      "ambiguity-seminar-credits": "exclude",
    });
    expect(unresolved.size).toBe(0);
    expect(gate(rules)?.creditBasis).toBe("countable");
  });

  it("元のルールを書き換えない", () => {
    resolveRules(exampleRules, { "ambiguity-seminar-credits": "exclude" });
    expect(gate(exampleRules)?.creditBasis).toBe("earned");
  });

  it("存在しない曖昧箇所への回答はエラーにする", () => {
    expect(() => resolveRules(exampleRules, { unknown: "include" })).toThrow("unknown");
  });

  it("存在しない選択肢への回答はエラーにする", () => {
    expect(() =>
      resolveRules(exampleRules, { "ambiguity-seminar-credits": "unknown" }),
    ).toThrow("unknown");
  });

  it("存在しないルールを書き換える選択肢はエラーにする", () => {
    const broken = structuredClone(exampleRules);
    broken.ambiguities[0]!.options[0]!.patches[0]!.ruleId = "missing";
    expect(() =>
      resolveRules(broken, { "ambiguity-seminar-credits": "include" }),
    ).toThrow("missing");
  });
});
