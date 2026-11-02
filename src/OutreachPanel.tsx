import type { StateChange } from "../engine/stateChanges";
import type { Outreach } from "../shared/api";
import { JudgmentBadge, NewlyListedBadge, StateBadge } from "./StatusBadge";

type Props = {
  outreach: Outreach[];
  changes: StateChange[];
  onOpenStudent: (studentId: string) => void;
};

type CardProps = {
  entry: Outreach;
  newlyListed: boolean;
  onOpenStudent: Props["onOpenStudent"];
};

function Grounds({ reasons }: { reasons: Outreach["reasons"] }) {
  const unique = [...new Map(reasons.map((reason) => [reason.sourceQuote, reason])).values()];
  return (
    <>
      {unique.map(({ ruleId, clause, sourceQuote }) => (
        <blockquote key={ruleId}>{sourceQuote.startsWith(clause) ? sourceQuote : `${clause}: ${sourceQuote}`}</blockquote>
      ))}
    </>
  );
}

function OutreachCard({ entry, newlyListed, onOpenStudent }: CardProps) {
  return (
    <article className="card">
      <div className="card-head">
        <button type="button" className="link" onClick={() => onOpenStudent(entry.studentId)}>
          {entry.studentId}
        </button>
        <span className="muted">{entry.studentYear}年次</span>
        <StateBadge state={entry.kind} />
        {newlyListed && <NewlyListedBadge />}
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
      <details open={entry.kind === "contact"}>
        <summary>根拠の文</summary>
        <Grounds reasons={entry.reasons} />
      </details>
      {entry.draft && (
        <details>
          <summary>声かけ文の下書きを見る</summary>
          <pre>{entry.draft}</pre>
        </details>
      )}
    </article>
  );
}

export function OutreachPanel({ outreach, changes, onOpenStudent }: Props) {
  const contact = outreach.filter((entry) => entry.kind === "contact");
  const review = outreach.filter((entry) => entry.kind === "staff_review");
  const changed = new Set(changes.map(({ studentId }) => studentId));
  const card = (entry: Outreach) => (
    <OutreachCard
      key={entry.studentId}
      entry={entry}
      newlyListed={changed.has(entry.studentId)}
      onOpenStudent={onOpenStudent}
    />
  );
  return (
    <section>
      <h2>声をかける学生（{contact.length}人）</h2>
      {contact.length === 0 && <p className="muted">声をかける学生はいません。</p>}
      {contact.map(card)}
      <h2>職員が確認する学生（{review.length}人）</h2>
      {review.length === 0 && <p className="muted">職員が確認する学生はいません。</p>}
      {review.map(card)}
    </section>
  );
}
