import { describe, expect, it } from "vitest";
import { type CourseOption, candidatesFor } from "../courseCandidates";

const courses: CourseOption[] = [
  { name: "演習Ⅰ", credits: 2, assignedYear: 3, offeredIn: "前期" },
  { name: "演習Ⅱ", credits: 2, assignedYear: 3, offeredIn: "後期" },
  { name: "卒業研究", credits: 4, assignedYear: 4, offeredIn: "通年" },
  { name: "基礎英語", credits: 1, assignedYear: 1 },
];

describe("candidatesFor（履修案の検査の候補。B32）", () => {
  it("開講学期が合う科目と、開講学期の指定がない科目だけを出す", () => {
    expect(candidatesFor(courses, "前期").map((course) => course.name)).toEqual(["基礎英語", "演習Ⅰ"]);
    expect(candidatesFor(courses, "後期").map((course) => course.name)).toEqual(["基礎英語", "演習Ⅱ"]);
    expect(candidatesFor(courses, "通年").map((course) => course.name)).toEqual(["基礎英語", "卒業研究"]);
  });
});

describe("candidatesFor の除外（修得済みなどを候補から外す。B41）", () => {
  it("外す科目の名前を渡すと、その科目を出さない", () => {
    const unavailable = new Set(["基礎英語"]);
    expect(candidatesFor(courses, "前期", unavailable).map((course) => course.name)).toEqual(["演習Ⅰ"]);
  });

  it("渡さなければ今までどおり", () => {
    expect(candidatesFor(courses, "前期", new Set()).map((course) => course.name)).toEqual(["基礎英語", "演習Ⅰ"]);
  });
});
