import type { StateChange } from "../engine/stateChanges";
import { StateBadge } from "./StatusBadge";

type Props = {
  changes: StateChange[];
  onOpenStudent: (studentId: string) => void;
  onOpenOutreach: () => void;
};

function groupByRoute(changes: StateChange[]) {
  const groups = new Map<string, StateChange[]>();
  for (const change of changes) {
    const key = `${change.from}:${change.to}`;
    groups.set(key, [...(groups.get(key) ?? []), change]);
  }
  return [...groups.values()];
}

export function ChangesPanel({ changes, onOpenStudent, onOpenOutreach }: Props) {
  return (
    <section className="changes card" aria-live="polite">
      <h2 id="answer-result" tabIndex={-1}>全学生の判定を更新しました</h2>
      {changes.length === 0 && <p className="muted">この回答で職員の対応が変わる学生はいません。</p>}
      {changes.length > 0 && <p>直前の回答で、職員の対応が変わった学生は {changes.length}人です。</p>}
      {groupByRoute(changes).map((group) => {
        const { from, to } = group[0]!;
        return (
          <div className="change-group" key={`${from}-${to}`}>
            <p>
              <StateBadge state={from} /> から <StateBadge state={to} /> へ {group.length}人
            </p>
            <ul className="change-students">
              {group.map(({ studentId }) => (
                <li key={studentId}>
                  <button type="button" className="link" onClick={() => onOpenStudent(studentId)}>
                    {studentId}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {changes.some(({ to }) => to === "contact") && (
        <div className="actions">
          <button type="button" onClick={onOpenOutreach}>
            声かけ一覧を見る
          </button>
        </div>
      )}
    </section>
  );
}
