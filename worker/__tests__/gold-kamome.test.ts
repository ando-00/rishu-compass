import { describe, expect, it } from "vitest";
import { kamomeCheckCases } from "../../data/fictional/kamome/check-cases";
import { kamomeCourses } from "../../data/fictional/kamome/courses";
import { goldRules } from "../../data/fictional/kamome/gold-rules";
import handbook from "../../data/fictional/kamome/handbook.md?raw";
import { kamomeStudents } from "../../data/fictional/kamome/students";
import { collectQuotes, computeImpacts, evaluateStudent, validateRuleSet, verifyQuotes } from "../../engine";
import { runCheckCases } from "../../engine/checkCases";
import { datasetsResponseSchema } from "../../shared/api";
import app from "../index";

const inScope = kamomeStudents.filter((student) => {
  const { excludedReason } = evaluateStudent(goldRules, kamomeCourses, student, {});
  return excludedReason === null;
});

function statusOf(student: (typeof kamomeStudents)[number], ruleId: string, answers = {}) {
  const { judgments } = evaluateStudent(goldRules, kamomeCourses, student, answers);
  return judgments.find((judgment) => judgment.ruleId === ruleId)?.status;
}

function credits(hasMinor: boolean, major: string) {
  return goldRules.categories
    .filter(({ when }) => when?.hasMinor === undefined || when.hasMinor === hasMinor)
    .filter(({ when }) => !when?.major || when.major === major)
    .reduce((sum, { minCredits }) => sum + minCredits, 0);
}

describe("かもめ大学の正解ルール", () => {
  it("参照がすべて実在する", () => {
    expect(validateRuleSet(goldRules, kamomeCourses)).toEqual([]);
  });

  it("根拠の文がすべて手引きに実在する", () => {
    expect(verifyQuotes(collectQuotes(goldRules), handbook)).toEqual([]);
  });

  it("副専攻の有無と専攻によらず、区分の最低単位の合計が卒業単位と合う", () => {
    for (const major of ["心理学専攻", "社会学専攻"]) {
      expect(credits(false, major)).toBe(128);
      expect(credits(true, major)).toBe(128);
    }
  });

  it("手引きの区分ごとの必要単位と合う", () => {
    const sum = (ids: string[]) =>
      goldRules.categories.filter(({ id }) => ids.includes(id)).reduce((total, c) => total + c.minCredits, 0);
    expect(sum(["core-required", "core-elective"])).toBe(40);
    expect(sum(["major-required-psy", "major-elective-psy"])).toBe(64);
    expect(sum(["major-required-psy", "major-elective-minor-psy"])).toBe(52);
  });

  it("必修の区分の科目の単位が最低単位と合う", () => {
    for (const category of goldRules.categories.filter((c) => c.requireAll)) {
      const total = kamomeCourses
        .filter((course) => course.groups.some((group) => category.groups.includes(group)))
        .reduce((sum, course) => sum + course.credits, 0);
      expect(total).toBe(category.minCredits);
    }
  });

  it("卒業研究の着手に必要な科目は、卒業研究を除く専攻必修と一致する", () => {
    for (const gate of goldRules.gates.filter(({ target }) => target.kind === "course")) {
      const required = kamomeCourses
        .filter((course) => course.groups.includes(`${gate.when?.major}/必修`) && course.name !== "卒業研究")
        .map(({ name }) => name)
        .sort();
      expect([...gate.requiredCourses].sort()).toEqual(required);
    }
  });

  it("検査用ケースに不一致がない", () => {
    const results = runCheckCases(goldRules, kamomeCourses, kamomeCheckCases);
    expect(results.filter(({ outcome }) => outcome === "failed")).toEqual([]);
  });

  it("仕込みの4件が曖昧箇所に入っている", () => {
    const ids = goldRules.ambiguities.map(({ id }) => id);
    expect(ids).toEqual(
      expect.arrayContaining(["retake", "seminar-courses", "thesis-enrolled", "minor-withdrawal"]),
    );
  });

  it("画面の対象に入る", async () => {
    const res = await app.request("/api/datasets");
    const { datasets } = datasetsResponseSchema.parse(await res.json());
    expect(datasets.find((dataset) => dataset.id === "kamome")).toMatchObject({ problems: [] });
  });
});

describe("未回答の曖昧箇所", () => {
  it("適用対象の学生がいる", () => {
    expect(inScope.length).toBeGreaterThan(0);
  });

  it("両専攻の科目の未回答で、全学生の卒業の判定が充足にも見込みにもならない", () => {
    for (const student of inScope) {
      expect(["needs_staff", "short"]).toContain(statusOf(student, "graduation"));
    }
  });

  it("副専攻なしの学生の自由科目は、職員確認になる", () => {
    const students = inScope.filter(({ hasMinor }) => !hasMinor);
    expect(students.length).toBeGreaterThan(0);
    for (const student of students) {
      const ruleId = student.major === "心理学専攻" ? "free-psy" : "free-soc";
      expect(statusOf(student, ruleId)).toBe("needs_staff");
    }
  });

  it("差分で表せない曖昧箇所は、回答しても判定が動かない", () => {
    const answers = { "shared-courses": "own-only", "minor-courses": "all", "minor-withdrawal": "no-minor" };
    for (const student of inScope) {
      expect(["needs_staff", "short"]).toContain(statusOf(student, "graduation", answers));
    }
  });

  it("確かな不足がある学生は、未回答でも不足と示す", () => {
    expect(inScope.some((student) => statusOf(student, "graduation") === "short")).toBe(true);
  });

  it("人数は差分で表せるものだけ計算し、表せないものは計算できないと返す", () => {
    const impacts = computeImpacts(goldRules, kamomeCourses, kamomeStudents, {});
    const computable = Object.fromEntries(impacts.map(({ ambiguityId, computable: value }) => [ambiguityId, value]));
    expect(computable).toMatchObject({
      "credit-basis": true,
      retake: true,
      "shared-courses": false,
      "minor-courses": false,
      "minor-withdrawal": false,
      "seminar-courses": false,
    });
  });
});
