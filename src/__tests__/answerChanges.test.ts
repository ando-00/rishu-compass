import { describe, expect, it } from "vitest";
import { changesAfterAnswer } from "../answerChanges";

const before = { students: [{ id: "S0007", state: "staff_review" as const }, { id: "S0010", state: "clear" as const }] };
const after = { students: [{ id: "S0007", state: "contact" as const }, { id: "S0010", state: "clear" as const }] };

describe("changesAfterAnswer（回答のあとの「全学生の判定を更新しました」。第3回の監査 A3-4）", () => {
  it("回答していなければ出さない", () => {
    expect(changesAfterAnswer(null, before)).toBeNull();
  });

  it("回答を記録した直後で、新しい判定がまだ届いていなければ出さない（「変わる学生はいません」と出さない）", () => {
    expect(changesAfterAnswer(before, before)).toBeNull();
  });

  it("新しい判定を取れなかったときは出さない", () => {
    expect(changesAfterAnswer(before, null)).toBeNull();
  });

  it("新しい判定が届いたら、対応が変わった学生を返す", () => {
    expect(changesAfterAnswer(before, after)).toEqual([{ studentId: "S0007", from: "staff_review", to: "contact" }]);
  });

  it("新しい判定が届いて誰も変わらなければ、空の一覧を返す", () => {
    expect(changesAfterAnswer(before, { students: [...before.students] })).toEqual([]);
  });
});
