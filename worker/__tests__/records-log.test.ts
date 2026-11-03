import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdviseResponse } from "../../shared/advise";
import { recordAdvice } from "../advisor/records";
import type { PlanInput } from "../advisor/tools";

// ログに学生の情報や案の本文を残さない（docs/AUDIT.md 第2回）。記録に失敗したときのログを確かめる
describe("履修案の記録に失敗したときのログ", () => {
  afterEach(() => vi.restoreAllMocks());

  it("Error 以外の値が投げられても、その中身をログに出さない", async () => {
    const secret = "S0095 への下書きの本文";
    const db = {
      prepare: () => {
        throw { detail: secret };
      },
    } as unknown as D1Database;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const input = { student: { id: "S0095" }, answers: {} } as unknown as PlanInput;
    const advice = { status: "needs_staff", reason: "理由", iterations: 0 } as unknown as AdviseResponse;

    expect(await recordAdvice(db, "sakuradai", input, advice)).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("S0095");
  });
});
