import { describe, expect, it } from "vitest";
import { sakuradaiCheckCases } from "../../data/fictional/sakuradai/check-cases";
import { sakuradaiCourses } from "../../data/fictional/sakuradai/courses";
import { goldRules } from "../../data/fictional/sakuradai/gold-rules";
import { runCheckCases } from "../../engine/checkCases";

describe("さくら台大学の検査用ケース", () => {
  it("人が決めた正解ルールで、すべて期待どおりになる", () => {
    const results = runCheckCases(goldRules, sakuradaiCourses, sakuradaiCheckCases);
    expect(results.filter(({ outcome }) => outcome !== "passed")).toEqual([]);
  });

  it("id が重複していない", () => {
    const ids = sakuradaiCheckCases.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("上限のケースの履修案に、要求した数の科目がある", () => {
    const plans = sakuradaiCheckCases.flatMap((testCase) => (testCase.kind === "plan" ? [testCase] : []));
    expect(plans.find(({ id }) => id === "T14")?.plan).toHaveLength(14);
  });
});
