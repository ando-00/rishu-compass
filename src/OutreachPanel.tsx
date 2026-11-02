import type { Outreach } from "../shared/api";
import { JudgmentBadge, StateBadge } from "./StatusBadge";

type Props = {
  outreach: Outreach[];
  onOpenStudent: (studentId: string) => void;
};

function OutreachCard({ entry, onOpenStudent }: { entry: Outreach; onOpenStudent: Props["onOpenStudent"] }) {
  return (
    <article className="card">
      <div className="card-head">
        <button type="button" className="link" onClick={() => onOpenStudent(entry.studentId)}>
          {entry.studentId}
        </button>
        <span className="muted">{entry.studentYear}年次</span>
        <StateBadge state={entry.kind} />
      </div>
      <ul className="reasons">
        {entry.reasons.map((reason) => (
          <li key={reason.ruleId}>
            <JudgmentBadge status={reason.status} />
            <span>
              {reason.name}（{reason.clause}）: {reason.detail}
            </span>
          </li>
        ))}
      </ul>
      {entry.kind === "contact" && (
        <details>
          <summary>声かけ文の下書きを見る</summary>
          <pre>{entry.draft}</pre>
        </details>
      )}
    </article>
  );
}

export function OutreachPanel({ outreach, onOpenStudent }: Props) {
  const contact = outreach.filter((entry) => entry.kind === "contact");
  const review = outreach.filter((entry) => entry.kind === "staff_review");
  return (
    <section>
      <h2>声をかける学生（{contact.length}人）</h2>
      {contact.length === 0 && <p className="muted">声をかける学生はいません。</p>}
      {contact.map((entry) => (
        <OutreachCard key={entry.studentId} entry={entry} onOpenStudent={onOpenStudent} />
      ))}
      <h2>職員が確認する学生（{review.length}人）</h2>
      {review.length === 0 && <p className="muted">職員が確認する学生はいません。</p>}
      {review.map((entry) => (
        <OutreachCard key={entry.studentId} entry={entry} onOpenStudent={onOpenStudent} />
      ))}
    </section>
  );
}
