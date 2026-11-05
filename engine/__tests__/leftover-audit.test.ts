// 追加の監査（2026-11-05）で記録した S3 のうち、判定の人数を変えずに直せるもの。期待値はテストのルールから手で求めた。
import { describe, expect, it } from "vitest";
import { exampleCourses } from "../../data/fictional/example/courses";
import { exampleRules } from "../../data/fictional/example/rules";
import { compareRules } from "../compareRules";
import { computeImpacts, settledStudentIds } from "../impact";
import type { Course, Student } from "../model";
import { checkCurrentRegistrations, checkPlan, lockedEnrollments, pendingPromotions, unresolvedEnrollments } from "../plan";
import type { RuleSet } from "../rules";
import { enrolled, makeStudent, passed } from "./helpers";

const ORIGINAL = exampleRules.ambiguities[0]!.id;

describe("既定のプロパティ名と同じ曖昧箇所の ID（R-9）", () => {
  it.each(["constructor", "toString", "hasOwnProperty"])("%s も未回答の一覧に出る", (id) => {
    const rules = JSON.parse(JSON.stringify(exampleRules).replaceAll(`"${ORIGINAL}"`, `"${id}"`)) as RuleSet;
    const student = makeStudent({ studentYear: 2 });
    expect(computeImpacts(rules, exampleCourses, [student], {}).map(({ ambiguityId }) => ambiguityId)).toContain(id);
  });

  it("答えた曖昧箇所は未回答の一覧に出ない", () => {
    const rules = JSON.parse(JSON.stringify(exampleRules).replaceAll(`"${ORIGINAL}"`, '"constructor"')) as RuleSet;
    const option = rules.ambiguities[0]!.options[0]!.id;
    expect(computeImpacts(rules, exampleCourses, [], { constructor: option }).map(({ ambiguityId }) => ambiguityId)).not.toContain("constructor");
  });

  it("対応が要らないと確かめる計算でも、未回答として読み方を試す", () => {
    const rules = JSON.parse(JSON.stringify(exampleRules).replaceAll(`"${ORIGINAL}"`, '"constructor"')) as RuleSet;
    const plain = settledStudentIds(exampleRules, exampleCourses, [makeStudent({ studentYear: 2 })], {});
    const renamed = settledStudentIds(rules, exampleCourses, [makeStudent({ studentYear: 2 })], {});
    expect([...renamed]).toEqual([...plain]);
  });
});

describe("同じ名前になるルールの突き合わせ（R-10）", () => {
  const base = { clause: "第1条", sourceQuote: "本文", retakeExclusion: "none" as const };
  const withLimits = (terms: number[]) => ({
    ...exampleRules,
    loadLimits: terms.map((maxPerTerm, index) => ({ ...base, id: `load-${index}`, maxPerTerm })),
  });

  it("条件のない履修上限が2件あれば、2件とも順に比べる", () => {
    const result = compareRules(withLimits([24, 28]), withLimits([24, 28]));
    expect(result.missing).toEqual([]);
    expect(result.extra).toEqual([]);
    expect(result.mismatches).toEqual([]);
  });

  it("2件目の値が違えば、ないとせずに値の違いとして出す", () => {
    const result = compareRules(withLimits([24, 28]), withLimits([24, 30]));
    expect(result.missing).toEqual([]);
    expect(result.mismatches.map(({ field, base: from, other }) => [field, from, other])).toEqual([["maxPerTerm", 28, 30]]);
  });

  it("相手に1件しかなければ、残りの1件をないと数える", () => {
    expect(compareRules(withLimits([24, 28]), withLimits([24])).missing).toHaveLength(1);
    expect(compareRules(withLimits([24]), withLimits([24, 28])).extra).toHaveLength(1);
  });
});

describe("今期の登録に科目データにない科目がある学生（R-11）", () => {
  it("判定と同じく職員確認にする", () => {
    const student = makeStudent({ studentYear: 2, records: [...passed(["入門A"]), ...enrolled(["不明な科目"], 2, "後期")] });
    const result = checkCurrentRegistrations(exampleRules, exampleCourses, student, {});
    expect(result?.courses).toEqual(["不明な科目"]);
    expect(result?.check.status).toBe("needs_staff");
    expect(result?.check.issues.map(({ code }) => code)).not.toContain("UNKNOWN_COURSE");
  });

  it("前の年度の記録に科目データにない科目がある学生も同じ", () => {
    const student = makeStudent({ studentYear: 2, records: [...passed(["不明な科目"]), ...enrolled(["応用B"], 2, "後期")] });
    expect(checkCurrentRegistrations(exampleRules, exampleCourses, student, {})?.check.status).toBe("needs_staff");
  });
});

describe("算入先の区分が学生に当てはまらないルール（A3-11）", () => {
  const base = { clause: "第1条", sourceQuote: "本文" };
  const courses: Course[] = [
    { name: "X", credits: 2, assignedYear: 1, groups: ["甲"], offeredIn: "前期" },
    { name: "Y", credits: 2, assignedYear: 1, groups: ["乙"], offeredIn: "前期" },
  ];
  const rules: RuleSet = {
    id: "mini",
    name: "mini",
    admissionYears: [2024],
    graduation: { id: "graduation", ...base, minYears: 4, totalCredits: 4 },
    categories: [
      { id: "a", ...base, name: "甲", groups: ["甲"], minCredits: 2, requireAll: false, overflowTo: "b" },
      { id: "b", ...base, name: "乙", groups: ["乙"], minCredits: 2, requireAll: false, overflowTo: null, when: { hasMinor: true } },
    ],
    gates: [
      {
        id: "gate",
        ...base,
        name: "条件",
        target: { kind: "course", courses: ["Y"] },
        checkAtEndOfYear: 1,
        minCredits: 2,
        creditBasis: "earned",
        requiredCourses: [],
        retryAfterMet: true,
      },
    ],
    loadLimits: [{ id: "load", ...base, maxPerTerm: 24, retakeExclusion: "none" }],
    courseCountLimits: [],
    prerequisites: [],
    ambiguities: [],
  };
  const student: Student = makeStudent({ major: undefined, hasMinor: false, studentYear: 2, records: enrolled(["Y"], 2) });

  it("履修案の前提の関数は例外を投げず、何も返さない", () => {
    expect(lockedEnrollments(rules, courses, student, {})).toEqual([]);
    expect(unresolvedEnrollments(rules, courses, student, {})).toEqual([]);
    expect(pendingPromotions(rules, courses, student, {})).toEqual([]);
  });

  it("検査は職員確認を返す", () => {
    expect(checkPlan(rules, courses, student, [{ course: "X", term: "前期" }], {}).status).toBe("needs_staff");
  });
});
