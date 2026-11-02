import { describe, expect, it } from "vitest";
import { exampleCourses } from "../../data/fictional/example/courses";
import { exampleRules } from "../../data/fictional/example/rules";
import { allocateCredits } from "../credits";
import { indexCourses } from "../model";
import type { RuleSet } from "../rules";
import { makeStudent, numberedNames } from "./helpers";

const catalog = indexCourses(exampleCourses);
const student = makeStudent();

function allocation(names: string[], rules: RuleSet = exampleRules, target = student) {
  return allocateCredits(rules, catalog, target, new Set(names));
}

function category(names: string[], id: string, rules: RuleSet = exampleRules, target = student) {
  const found = allocation(names, rules, target).categories.find((c) => c.categoryId === id);
  if (!found) throw new Error(id);
  return found;
}

describe("allocateCredits", () => {
  it("修得科目を区分ごとに集計する", () => {
    expect(category(["入門A", "入門B"], "basic-required").total).toBe(4);
  });

  it("超過分を算入先の区分へ送る", () => {
    const names = numberedNames("専門", 18);
    expect(category(names, "major-a-no-minor")).toMatchObject({
      total: 36,
      counted: 30,
      overflowed: 6,
    });
    expect(category(names, "free")).toMatchObject({ received: 6, counted: 6 });
  });

  it("区分の算入上限を超えた分は卒業単位に算入しない", () => {
    const names = numberedNames("専門", 20).concat(["応用B", "応用C", "集中"]);
    const free = category(names, "free");
    expect(free).toMatchObject({ received: 16, counted: 12, lost: 4 });
    expect(allocation(names).counted).toBe(42);
  });

  it("区分の一部にかかる上限を適用する", () => {
    const free = category(numberedNames("他", 6), "free");
    expect(free).toMatchObject({ direct: 4, counted: 4, lost: 8 });
  });

  it("算入先がない超過分は算入しない", () => {
    const rules = structuredClone(exampleRules);
    rules.categories[0]!.minCredits = 4;
    rules.categories[0]!.maxCredits = 4;
    const basic = category(["入門A", "入門B", "基礎C"], "basic-required", rules);
    expect(basic).toMatchObject({ counted: 4, overflowed: 0, lost: 2 });
  });

  it("算入先の区分が先に書かれていても順番に影響されない", () => {
    const rules = structuredClone(exampleRules);
    rules.categories.reverse();
    expect(category(numberedNames("専門", 18), "free", rules).received).toBe(6);
  });

  it("複数の区分からの超過分を合算する", () => {
    const rules = structuredClone(exampleRules);
    rules.categories[0]!.overflowTo = "free";
    const names = [...numberedNames("専門", 16), "入門A", "入門B", "基礎C", "基礎D", "基礎E"];
    rules.categories[0]!.minCredits = 8;
    expect(category(names, "free", rules).received).toBe(4);
  });

  it("修得した全単位と算入した単位を分けて返す", () => {
    const result = allocation(numberedNames("他", 6));
    expect(result.earned).toBe(12);
    expect(result.counted).toBe(4);
  });

  it("どの区分にも入らない科目を返す", () => {
    expect(allocation(["乙01"]).uncategorized).toEqual(["乙01"]);
  });

  it("学生の条件に合う区分だけを使う", () => {
    const withMinor = makeStudent({ hasMinor: true });
    const names = numberedNames("専門", 11);
    const major = category(names, "major-a-with-minor", exampleRules, withMinor);
    expect(major).toMatchObject({ counted: 20, overflowed: 2 });
    expect(allocation(["乙01"], exampleRules, withMinor).uncategorized).toEqual([]);
    expect(allocation(names).categories.map((c) => c.categoryId)).not.toContain(
      "major-a-with-minor",
    );
  });

  it("すべて修得する区分の未修得科目を返す", () => {
    const basic = category(["入門A", "入門B"], "basic-required");
    expect(basic.missingCourses).toEqual(["基礎C", "基礎D", "基礎E"]);
  });

  it("循環する算入先はエラーにする", () => {
    const rules = structuredClone(exampleRules);
    rules.categories.find((c) => c.id === "free")!.overflowTo = "major-a-no-minor";
    expect(() => allocation([], rules)).toThrow("循環");
  });

  it("学生に適用されない算入先はエラーにする", () => {
    const rules = structuredClone(exampleRules);
    rules.categories.find((c) => c.id === "major-a-no-minor")!.overflowTo = "minor-a";
    expect(() => allocation([], rules)).toThrow("minor-a");
  });

  it("科目データにない科目はエラーにする", () => {
    expect(() => allocation(["存在しない科目"])).toThrow("存在しない科目");
  });
});
