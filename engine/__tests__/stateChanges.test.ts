import { describe, expect, it } from "vitest";
import { diffStudentStates } from "../stateChanges";

describe("diffStudentStates", () => {
  it("状態が変わった学生だけを返す", () => {
    const before = [
      { id: "S1", state: "staff_review" as const },
      { id: "S2", state: "clear" as const },
    ];
    const after = [
      { id: "S1", state: "contact" as const },
      { id: "S2", state: "clear" as const },
    ];
    expect(diffStudentStates(before, after)).toEqual([{ studentId: "S1", from: "staff_review", to: "contact" }]);
  });

  it("声かけ、職員確認、対応なしの順に並べ、同じ行き先の中は回答後の並びのままにする", () => {
    const before = [
      { id: "S1", state: "contact" as const },
      { id: "S2", state: "staff_review" as const },
      { id: "S3", state: "clear" as const },
      { id: "S4", state: "staff_review" as const },
    ];
    const after = [
      { id: "S1", state: "clear" as const },
      { id: "S2", state: "contact" as const },
      { id: "S3", state: "staff_review" as const },
      { id: "S4", state: "contact" as const },
    ];
    expect(diffStudentStates(before, after).map(({ studentId }) => studentId)).toEqual(["S2", "S4", "S3", "S1"]);
  });

  it("片方にしかいない学生は比べない", () => {
    const before = [{ id: "S1", state: "clear" as const }];
    const after = [{ id: "S2", state: "contact" as const }];
    expect(diffStudentStates(before, after)).toEqual([]);
  });
});
