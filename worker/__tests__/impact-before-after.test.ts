import { describe, expect, it } from "vitest";
import { diffStudentStates } from "../../engine/stateChanges";
import { overviewResponseSchema } from "../../shared/api";
import app from "../index";

// 監査の第2.5回の A25-2、A25-3。確認事項の「回答で判定が変わる学生」は、回答の前後で職員の対応が変わる学生を
// すべて含む。「別途、職員確認の学生」は、その曖昧箇所で止まっている学生だけを数える。

async function overview(id: string, answers: Record<string, string>) {
  const res = await app.request(`/api/datasets/${id}/overview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
  });
  expect(res.status).toBe(200);
  return overviewResponseSchema.parse(await res.json());
}

describe("回答の前後の変化と影響人数（A25-2）", () => {
  it("かもめ大学: 順に答えたとき、対応が変わる学生は毎回「回答で判定が変わる学生」に含まれる", async () => {
    const steps: [string, string][] = [
      ["credit-basis", "earned"],
      ["retry-after-met", "deny"],
      ["thesis-enrolled", "earned-only"],
      ["thesis-enrolled-timing", "through-check"],
    ];
    let answers: Record<string, string> = {};
    let movedTotal = 0;
    for (const [id, option] of steps) {
      const before = await overview("kamome", answers);
      const card = before.unanswered.find((u) => u.ambiguityId === id)!;
      answers = { ...answers, [id]: option };
      const after = await overview("kamome", answers);
      const moved = diffStudentStates(before.students, after.students).map((c) => c.studentId);
      movedTotal += moved.length;
      expect({ id, moved, affected: card.affectedStudentIds.length }).toMatchObject({ id });
      expect(card.affectedStudentIds).toEqual(expect.arrayContaining(moved));
    }
    // 監査で確かめた事実: 4件目で7人が職員確認から声かけに移る
    expect(movedTotal).toBeGreaterThanOrEqual(7);
  }, 60000);

  it("さくら台大学: 第6条に答えて動く6人は、両方の読み方で「回答で判定が変わる学生」に含まれる", async () => {
    const before = await overview("sakuradai", {});
    const card = before.unanswered.find((u) => u.ambiguityId === "seminar-credit-basis")!;
    for (const option of ["earned", "countable"]) {
      const after = await overview("sakuradai", { "seminar-credit-basis": option });
      const moved = diffStudentStates(before.students, after.students).map((c) => c.studentId);
      expect(card.affectedStudentIds).toEqual(expect.arrayContaining(moved));
    }
  }, 60000);
});

describe("別途、職員確認の学生（A25-3）", () => {
  it("さくら台大学の第13条: 今の一覧で職員確認の学生だけを数え、回答で変わる学生とは重ならない", async () => {
    const ov = await overview("sakuradai", {});
    const card = ov.unanswered.find((u) => u.ambiguityId === "retake-disqualified-scope")!;
    const inReview = new Set(ov.students.filter((s) => s.state === "staff_review").map((s) => s.id));
    expect(card.staffReviewStudentIds.length).toBeGreaterThan(0);
    for (const id of card.staffReviewStudentIds) {
      expect(inReview.has(id)).toBe(true);
      expect(card.affectedStudentIds).not.toContain(id);
    }
    // 一覧の職員確認（29人）を超えない。直す前は293人だった
    expect(card.staffReviewStudentIds.length).toBeLessThanOrEqual(ov.summary.staffReview);
  }, 60000);
});
