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
