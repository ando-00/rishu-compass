import { describe, expect, it } from "vitest";
import { planCheckNotice, settledNotice } from "../countNotices";

describe("履修案の検査に関わる確認事項の説明", () => {
  it("読み方で表の人数が変わるときは、人数も変わると言う", () => {
    const notice = planCheckNotice([{ counts: { short: 10, needs_staff: 2 } }, { counts: { short: 17, needs_staff: 2 } }]);
    expect(notice).toContain("人数のほか");
  });

  it("読み方で表の人数が変わらないときは、人数も変わるとは言わない", () => {
    const notice = planCheckNotice([{ counts: { short: 152, needs_staff: 48 } }, { counts: { short: 152, needs_staff: 48 } }]);
    expect(notice).not.toContain("人数のほか");
    expect(notice).toContain("表の人数は同じ");
  });

  it("片方にしかない判定も、人数の違いとして数える", () => {
    expect(planCheckNotice([{ counts: { short: 1 } }, { counts: {} }])).toContain("人数のほか");
    expect(planCheckNotice([{ counts: null }, { counts: null }])).toContain("表の人数は同じ");
  });
});

describe("対応なしの学生の職員確認の行の説明", () => {
  it("対応なしで職員確認の行があるときだけ出す", () => {
    expect(settledNotice("clear", [{ status: "needs_staff" }])).toContain("どの読み方でも対応が要らない");
    expect(settledNotice("clear", [{ status: "satisfied" }])).toBeNull();
    expect(settledNotice("staff_review", [{ status: "needs_staff" }])).toBeNull();
    expect(settledNotice("contact", [{ status: "needs_staff" }])).toBeNull();
    expect(settledNotice(undefined, [{ status: "needs_staff" }])).toBeNull();
  });
});
