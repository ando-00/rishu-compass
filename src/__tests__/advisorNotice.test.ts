import { describe, expect, it } from "vitest";
import { NO_ADVISOR_MESSAGE } from "../../shared/advise";
import { advisorNotice } from "../advisorNotice";

const state = { enabled: false, recordingAvailable: false, hasResult: false };

describe("履修案を作れない環境の案内", () => {
  it("作れる環境と、まだ分からないあいだは出さない", () => {
    expect(advisorNotice({ ...state, enabled: true })).toBeNull();
    expect(advisorNotice({ ...state, enabled: null })).toBeNull();
  });

  it("記録がない学生には、記録を見られる手順を示す", () => {
    expect(advisorNotice(state)).toBe(NO_ADVISOR_MESSAGE);
  });

  it("記録がある学生には、今押せるボタンを示す", () => {
    const notice = advisorNotice({ ...state, recordingAvailable: true });
    expect(notice).toContain("「記録を読み込む」を押すと");
    expect(notice).not.toContain("S0095");
  });

  it("結果が出たあとは、押せないボタンの理由だけを示す", () => {
    expect(advisorNotice({ ...state, recordingAvailable: true, hasResult: true })).toBe("この環境では履修案を作り直せません。");
  });
});
