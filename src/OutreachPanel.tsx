import { useState } from "react";
import { describeAmounts } from "../engine/outreach";
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
  // 発端の条文を先に出し、卒業要件の条文をあとに出す。
  const cited = [...reasons.flatMap(({ grounds }) => grounds ?? []), ...reasons];
  const unique = [...new Map(cited.map((reason) => [reason.sourceQuote, reason])).values()];
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
              {describeAmounts(reason) && <span className="muted">（{describeAmounts(reason)}）</span>}
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
  // 絞り込みは画面の中だけで行う。人数の計算は engine の結果のまま
  const [year, setYear] = useState("all");
  const [ruleName, setRuleName] = useState("all");
  const years = [...new Set(outreach.map((entry) => entry.studentYear))].sort((a, b) => a - b);
  const ruleNames = [...new Set(outreach.flatMap((entry) => entry.reasons.map((reason) => reason.name)))];
  const matches = (entry: Outreach) =>
    (year === "all" || String(entry.studentYear) === year) &&
    (ruleName === "all" || entry.reasons.some((reason) => reason.name === ruleName));
  const filtering = year !== "all" || ruleName !== "all";
  const contact = outreach.filter((entry) => entry.kind === "contact");
  const review = outreach.filter((entry) => entry.kind === "staff_review");
  const shownContact = contact.filter(matches);
  const shownReview = review.filter(matches);
  const changed = new Set(changes.map(({ studentId }) => studentId));
  const card = (entry: Outreach) => (
    <OutreachCard
      key={entry.studentId}
      entry={entry}
      newlyListed={changed.has(entry.studentId)}
      onOpenStudent={onOpenStudent}
    />
  );
  const count = (all: Outreach[], shown: Outreach[]) =>
    filtering ? `${all.length}人のうち${shown.length}人を表示` : `${all.length}人`;
  return (
    <section>
      <div className="student-filter">
        <label>
          年次
          <select value={year} onChange={(event) => setYear(event.target.value)}>
            <option value="all">すべて</option>
            {years.map((value) => (
              <option key={value} value={String(value)}>
                {value}年次
              </option>
            ))}
          </select>
        </label>
        <label>
          判定の種類
          <select value={ruleName} onChange={(event) => setRuleName(event.target.value)}>
            <option value="all">すべて</option>
            {ruleNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <h2>声をかける学生（{count(contact, shownContact)}）</h2>
      {contact.length === 0 && <p className="muted">声をかける学生はいません。</p>}
      {contact.length > 0 && shownContact.length === 0 && <p className="muted">絞り込みに当てはまる学生はいません。</p>}
      {shownContact.map(card)}
      <h2>職員が確認する学生（{count(review, shownReview)}）</h2>
      {review.length === 0 && <p className="muted">職員が確認する学生はいません。</p>}
      {review.length > 0 && shownReview.length === 0 && <p className="muted">絞り込みに当てはまる学生はいません。</p>}
      {shownReview.map(card)}
    </section>
  );
}
