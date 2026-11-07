import { diffStudentStates, type StateChange, type StudentState } from "../engine/stateChanges";

type Snapshot = { students: { id: string; state: StudentState }[] };

// 判定を更新した操作。読み方を選んだか、回答を取り消したか
export type AnswerAction = "answer" | "clear";

export function changesMessage(count: number, action: AnswerAction) {
  if (action === "clear") {
    return count === 0 ? "この取り消しで職員の対応が変わる学生はいません。" : `回答の取り消しで、職員の対応が変わった学生は ${count}人です。`;
  }
  return count === 0 ? "この回答で職員の対応が変わる学生はいません。" : `直前の回答で、職員の対応が変わった学生は ${count}人です。`;
}

export function changedBadgeLabel(action: AnswerAction) {
  return action === "clear" ? "直前の取り消しで変化" : "直前の回答で変化";
}

// 回答の前後で、職員の対応が変わった学生。
// 回答を記録してから新しい判定が届くまでは、手元の一覧がまだ回答の前のものなので比べない（null）。
// 比べると、判定が届くまでの間「変わる学生はいません」と出てしまう（第3回の監査 A3-4）
export function changesAfterAnswer(before: Snapshot | null, current: Snapshot | null): StateChange[] | null {
  if (!before || !current || before === current) return null;
  return diffStudentStates(before.students, current.students);
}
