import { describe, expect, it, vi } from "vitest";
import { revealResult } from "../revealResult";

// 独立の全体監査の V-24。下のカードで回答すると、結果の見出しが画面の外に出て、焦点も失われていた。
function element(top: number, bottom: number) {
  return {
    focus: vi.fn(),
    scrollIntoView: vi.fn(),
    getBoundingClientRect: () => ({ top, bottom }),
  } as unknown as HTMLElement & { focus: ReturnType<typeof vi.fn>; scrollIntoView: ReturnType<typeof vi.fn> };
}

describe("revealResult", () => {
  it("見えているときは画面を動かさず、焦点だけを移す", () => {
    const target = element(300, 330);
    const anchor = element(100, 200);
    revealResult(target, anchor, 768);
    expect(target.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(target.scrollIntoView).not.toHaveBeenCalled();
    expect(anchor.scrollIntoView).not.toHaveBeenCalled();
  });

  it("画面の上に外れているときは、上の人数の欄まで戻す", () => {
    const target = element(-377, -347);
    const anchor = element(-600, -500);
    revealResult(target, anchor, 768);
    expect(target.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(anchor.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("知らせが見えていても、上の人数の欄が画面の外なら戻す（1366×650 の README の流れ）", () => {
    const target = element(45, 70);
    const anchor = element(-85, 40);
    revealResult(target, anchor, 650);
    expect(anchor.scrollIntoView).toHaveBeenCalledOnce();
  });

  it("画面の下に外れているときも戻す", () => {
    const target = element(800, 830);
    const anchor = element(700, 790);
    revealResult(target, anchor, 768);
    expect(anchor.scrollIntoView).toHaveBeenCalledOnce();
  });

  it("移す先がなければ、結果そのものへ移す", () => {
    const target = element(-50, -20);
    revealResult(target, null, 768);
    expect(target.scrollIntoView).toHaveBeenCalledOnce();
  });

  it("結果がなければ何もしない", () => {
    const anchor = element(-600, -500);
    revealResult(null, anchor, 768);
    expect(anchor.scrollIntoView).not.toHaveBeenCalled();
  });
});
