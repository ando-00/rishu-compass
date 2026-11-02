export type StudentState = "contact" | "staff_review" | "clear";

export type StateChange = {
  studentId: string;
  from: StudentState;
  to: StudentState;
};

type Row = { id: string; state: StudentState };

const ORDER: StudentState[] = ["contact", "staff_review", "clear"];

// 回答の前後の一覧を比べ、職員の対応が変わる学生を返す。声をかける相手を先に並べる。
export function diffStudentStates(before: Row[], after: Row[]): StateChange[] {
  const previous = new Map(before.map(({ id, state }) => [id, state]));
  const changes = after.flatMap(({ id, state }) => {
    const from = previous.get(id);
    return from === undefined || from === state ? [] : [{ studentId: id, from, to: state }];
  });
  return ORDER.flatMap((state) => changes.filter(({ to }) => to === state));
}
