import { describe, expect, it } from "vitest";
import type { Course } from "../model";
import { planCredits } from "../plan";

// 独立の全体監査の V-17。履修案の合計単位も engine で数える。
const courses = [
  { name: "英語Ⅰ", credits: 2 },
  { name: "卒業論文", credits: 4 },
] as Course[];

describe("planCredits", () => {
  it("各科目に科目データの単位を添え、合計を返す", () => {
    const { entries, totalCredits } = planCredits(courses, [
      { course: "英語Ⅰ", term: "前期" },
      { course: "卒業論文", term: "通年" },
    ]);
    expect(entries).toEqual([
      { course: "英語Ⅰ", term: "前期", credits: 2 },
      { course: "卒業論文", term: "通年", credits: 4 },
    ]);
    expect(totalCredits).toBe(6);
  });

  it("科目データにない科目は0単位として数える", () => {
    const { entries, totalCredits } = planCredits(courses, [{ course: "なし", term: "前期" }]);
    expect(entries[0]?.credits).toBe(0);
    expect(totalCredits).toBe(0);
  });

  it("案が空なら合計は0", () => {
    expect(planCredits(courses, [])).toEqual({ entries: [], totalCredits: 0 });
  });
});
