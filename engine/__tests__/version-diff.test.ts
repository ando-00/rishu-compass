import { describe, expect, it } from "vitest";
import { exampleRules } from "../../data/fictional/example/rules";
import type { RuleSet } from "../rules";
import { diffVersions } from "../versionDiff";

function changed(change: (rules: RuleSet) => void) {
  const rules = structuredClone(exampleRules);
  change(rules);
  return rules;
}

describe("diffVersions（要項の版の比較。H25 の G。B39）", () => {
  it("同じルールなら差分はない", () => {
    expect(diffVersions(exampleRules, structuredClone(exampleRules))).toEqual({
      changed: [],
      removed: [],
      added: [],
      ambiguitiesRemoved: [],
      ambiguitiesAdded: [],
    });
  });

  it("値が変わった項目を、意味の名前、項目、前の値、今の値で出す", () => {
    const next = changed((rules) => {
      rules.categories.find(({ id }) => id === "basic-required")!.minCredits = 12;
    });
    const { changed: rows } = diffVersions(exampleRules, next);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ field: "minCredits", before: "10", after: "12" });
    expect(rows[0]!.item).toMatch(/^区分: /);
  });

  it("曖昧箇所の読み方で変わる項目の値も比べる", () => {
    const next = changed((rules) => {
      rules.gates.find(({ id }) => id === "gate-seminar")!.creditBasis = "countable";
    });
    const before = exampleRules.gates.find(({ id }) => id === "gate-seminar")!.creditBasis;
    expect(before).not.toBe("countable");
    expect(diffVersions(exampleRules, next).changed.map(({ field }) => field)).toEqual(["creditBasis"]);
  });

  it("消えたルールと増えたルールを出す", () => {
    const next = changed((rules) => {
      rules.prerequisites = rules.prerequisites.filter(({ id }) => id !== "prereq-b");
      rules.courseCountLimits.push({ ...rules.courseCountLimits[0]!, id: "count-new", group: "新しい科目群" });
    });
    const diff = diffVersions(exampleRules, next);
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0]).toMatch(/^先修条件: /);
    expect(diff.added).toEqual(["科目数の上限: 新しい科目群"]);
  });

  it("曖昧箇所の増減は ID で見て、条文と質問を添える", () => {
    const ambiguity = exampleRules.ambiguities[0]!;
    const next = changed((rules) => {
      rules.ambiguities = [{ ...rules.ambiguities[0]!, id: "ambiguity-new", question: "新しい質問" }];
    });
    const diff = diffVersions(exampleRules, next);
    expect(diff.ambiguitiesRemoved).toEqual([
      { id: ambiguity.id, clause: ambiguity.clause, question: ambiguity.question },
    ]);
    expect(diff.ambiguitiesAdded).toEqual([{ id: "ambiguity-new", clause: ambiguity.clause, question: "新しい質問" }]);
  });
});
