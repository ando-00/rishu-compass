import { describe, expect, it } from "vitest";
import { checkPlan } from "../plan";
import { specCourses, specRules } from "./fixtures/spec-sakuradai";
import { makeStudent } from "./helpers";

// 時限の重なりの根拠に、要項の時間割の章を示す（2026-11-02 の人の決定、かもめ大学の「7 時間割」）
const plan = [
  { course: "月一A", term: "前期" as const },
  { course: "月一B", term: "前期" as const },
];
const student = makeStudent({ studentYear: 2 });

function conflict(rules: typeof specRules) {
  return checkPlan(rules, specCourses, student, plan, { "credit-basis": "earned" }).issues.find(
    (issue) => issue.code === "TIME_CONFLICT",
  );
}

describe("時限の重なりの根拠", () => {
  it("ルールに時間割の項目があれば、その条文と根拠の文を示す", () => {
    const timetable = { id: "timetable", clause: "7 時間割", sourceQuote: "授業は月曜から土曜の1限から6限に行います。" };
    expect(conflict({ ...specRules, timetable })).toMatchObject({
      ruleId: "timetable",
      clause: "7 時間割",
      sourceQuote: "授業は月曜から土曜の1限から6限に行います。",
    });
  });

  it("なければ今までどおり「時間割」を示す", () => {
    expect(conflict(specRules)).toMatchObject({ ruleId: "timetable", clause: "時間割", sourceQuote: "" });
  });
});
