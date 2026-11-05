import { diffStudentStates, type StateChange, type StudentState } from "../engine/stateChanges";

type Snapshot = { students: { id: string; state: StudentState }[] };

// 回答の前後で、職員の対応が変わった学生。
// 回答を記録してから新しい判定が届くまでは、手元の一覧がまだ回答の前のものなので比べない（null）。
// 比べると、判定が届くまでの間「変わる学生はいません」と出てしまう（第3回の監査 A3-4）
export function changesAfterAnswer(before: Snapshot | null, current: Snapshot | null): StateChange[] | null {
  if (!before || !current || before === current) return null;
  return diffStudentStates(before.students, current.students);
}
