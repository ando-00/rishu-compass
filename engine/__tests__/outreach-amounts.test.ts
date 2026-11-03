import { describe, expect, it } from "vitest";
import { exampleCourses } from "../../data/fictional/example/courses";
import { exampleRules } from "../../data/fictional/example/rules";
import { evaluateStudent } from "../evaluate";
import { draftOutreachMessage, listOutreach } from "../outreach";
import { makeStudent, passed } from "./helpers";

// H14 の A（B23）。声かけの理由と定型の下書きに、不足の量（必要・修得・履修中・未修得の必修）を出す。
// 職員確認の判定には数値を出さない（未確定を確定に見せない）。
const ID = "ambiguity-seminar-credits";

function entryFor(answers: Record<string, string>) {
  const student = makeStudent({ studentYear: 4, yearsEnrolled: 4, records: passed(["入門A", "基礎C"], 1) });
  const evaluation = evaluateStudent(exampleRules, exampleCourses, student, answers);
  const [entry] = listOutreach([evaluation], [student]);
  expect(entry).toBeDefined();
  return entry!;
}

describe("声かけの理由の不足の量", () => {
  it("不足の判定には、必要・修得・履修中の単位と未修得の必修科目を付ける", () => {
    const entry = entryFor({ [ID]: "include" });
    const short = entry.reasons.filter((r) => r.status === "short" && r.required !== undefined);
    expect(short.length).toBeGreaterThan(0);
    for (const reason of short) {
      expect(typeof reason.actual).toBe("number");
      expect(reason.actual!).toBeLessThan(reason.required!);
    }
    expect(entry.reasons.some((r) => (r.missingCourses?.length ?? 0) > 0)).toBe(true);
  });

  it("職員確認の判定には数値を付けない", () => {
    const entry = entryFor({});
    const review = entry.reasons.filter((r) => r.status === "needs_staff");
    expect(review.length).toBeGreaterThan(0);
    for (const reason of review) {
      expect(reason.required).toBeUndefined();
      expect(reason.actual).toBeUndefined();
      expect(reason.enrolled).toBeUndefined();
      expect(reason.missingCourses).toBeUndefined();
    }
  });

  it("定型の下書きに不足の量を書く", () => {
    const entry = entryFor({ [ID]: "include" });
    const draft = draftOutreachMessage(entry);
    const short = entry.reasons.find((r) => r.status === "short" && r.required !== undefined)!;
    expect(draft).toContain(`修得 ${short.actual} / 必要 ${short.required} 単位`);
    expect(draft).toMatch(/未修得: /);
  });
});
