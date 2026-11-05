import { describe, expect, it } from "vitest";
import { evaluateStudent } from "../evaluate";
import type { Course } from "../model";
import { strayCourses, validateRuleSet } from "../validate";
import { specCourses, specRules } from "./fixtures/spec-sakuradai";
import { makeStudent, passed } from "./helpers";

// 監査の第1回の A1-26。どの区分にも入らない科目を修得した学生は、単位を黙って捨てずに職員確認にする（2026-11-02 の人の決定）。
const STRAY: Course = { name: "区分外の科目", credits: 2, assignedYear: 1, groups: ["どの区分にもない群"] };
const courses = [...specCourses, STRAY];

function graduation(records: ReturnType<typeof passed>) {
  const result = evaluateStudent(specRules, courses, makeStudent({ records }), { "credit-basis": "earned" });
  return result.judgments.find((j) => j.kind === "graduation")!;
}

describe("どの区分にも入らない科目（A1-26）", () => {
  it("修得した学生の卒業要件は、不足ではなく職員確認になり、科目を示す", () => {
    const result = graduation(passed(["基礎必修1", "区分外の科目"]));
    expect(result.status).toBe("needs_staff");
    expect(result.uncountedCourses).toEqual(["区分外の科目"]);
    expect(result.reason).toContain("区分外の科目");
  });

  it("修得していなければ、今までどおり不足になる", () => {
    expect(graduation(passed(["基礎必修1"])).status).toBe("short");
  });

  it("卒業要件自身の曖昧箇所が未回答で、確定の区分に不足があっても、区分に入らない科目を修得していれば職員確認のまま（H30。第3回の監査 A3-6）", () => {
    const rules = structuredClone(specRules);
    rules.graduation.ambiguityIds = ["credit-basis"];
    const of = (names: string[]) =>
      evaluateStudent(rules, courses, makeStudent({ records: passed(names) }), {}).judgments.find((j) => j.kind === "graduation")!;
    expect(of(["基礎必修1"]).status).toBe("short");
    expect(of(["基礎必修1", "区分外の科目"]).status).toBe("needs_staff");
  });

  it("区分に入らない科目を警告として返し、ルールの検査の問題にはしない（確定を止めない）", () => {
    expect(strayCourses(specRules, courses)).toEqual(["区分外の科目"]);
    expect(validateRuleSet(specRules, courses)).toEqual(validateRuleSet(specRules, specCourses));
  });
});
