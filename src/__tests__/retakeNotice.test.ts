import { describe, expect, it } from "vitest";
import { confirmedRetakeNote, retakeNotice } from "../retakeNotice";

// 独立の全体監査の V-2。変換の形式に失格の再履修のルールがないので、確定すると失格の科目を止めずに判定する。
// 確定の前と後の画面で、そのことを示す。
describe("失格の再履修のルールがない案の注意（V-2）", () => {
  it("案に再履修のルールがなければ、確定の前に注意を出す", () => {
    const notice = retakeNotice({});
    expect(notice).toContain("失格した科目の再履修");
    expect(notice).toContain("回答は使いません");
    expect(notice).toContain("声かけの人数が変わることがあります");
  });

  it("案に再履修のルールがあれば、注意を出さない", () => {
    const retake = { id: "r", clause: "第13条", sourceQuote: "q", forbidDisqualified: true };
    expect(retakeNotice({ retake })).toBeNull();
  });

  it("確定したあとは、その版に再履修のルールがないときだけ判定の行に添える", () => {
    expect(confirmedRetakeNote(true)).toContain("失格した科目も止めずに判定します");
    expect(confirmedRetakeNote(undefined)).toBe("");
  });
});
