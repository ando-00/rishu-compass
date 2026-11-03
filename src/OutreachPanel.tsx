import { useState } from "react";
import { describeAmounts } from "../engine/outreach";
import type { StateChange } from "../engine/stateChanges";
import type { Outreach, OverviewResponse } from "../shared/api";
import { FinalYearSummary } from "./FinalYearSummary";
import { JudgmentBadge, NewlyListedBadge, StateBadge } from "./StatusBadge";

type Props = {
  outreach: Outreach[];
  finalYear: OverviewResponse["finalYear"];
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

// 不足の決まり文句は「不足」のバッジと同じことを言うので、量があるときは量だけを出す
const SHORT_DETAIL = "必要な単位または科目が不足しています。";

function reasonText(reason: Outreach["reasons"][number]) {
  const amounts = describeAmounts(reason);
  if (reason.status === "short" && reason.detail === SHORT_DETAIL && amounts) return <>: {amounts}</>;
  return (
    <>
      : {reason.detail}
      {amounts && <span className="muted">（{amounts}）</span>}
    </>
  );
}

// 重い判定から並べる。一覧の行には先頭の判定だけを出し、押すと全部を開く
const REASON_ORDER = { delay_risk: 0, short: 1, needs_staff: 2, expected: 3, satisfied: 4 } as const;

function OutreachRow({ entry, newlyListed, onOpenStudent }: CardProps) {
  const [open, setOpen] = useState(false);
  const sorted = [...entry.reasons].sort((a, b) => REASON_ORDER[a.status] - REASON_ORDER[b.status]);
  const top = sorted[0];
  const detailId = `outreach-${entry.studentId}`;
  return (
    <li className={open ? "outreach-row open" : "outreach-row"}>
      <div className="outreach-line">
        <button type="button" className="link" onClick={() => onOpenStudent(entry.studentId)}>
          {entry.studentId}
        </button>
        <span className="muted nowrap">{entry.studentYear}年次</span>
        <span className="outreach-badges">
          <StateBadge state={entry.kind} />
          {newlyListed && <NewlyListedBadge />}
        </span>
        <button
          type="button"
          className="outreach-toggle"
          aria-expanded={open}
          aria-controls={detailId}
          onClick={() => setOpen(!open)}
        >
          {top && (
            <>
              <JudgmentBadge status={top.status} />
              <span className="reason-name">
                {top.name}（{top.clause}）
              </span>
              <span className="outreach-summary">{describeAmounts(top) || top.detail}</span>
            </>
          )}
          <span className="outreach-more">
            {sorted.length > 1 ? `ほか${sorted.length - 1}件` : ""}
            <span aria-hidden="true">{open ? " ▲" : " ▼"}</span>
          </span>
        </button>
      </div>
      {open && (
        <div className="outreach-detail" id={detailId}>
          <ul className="reasons">
            {sorted.map((reason) => (
              <li key={reason.ruleId}>
                <JudgmentBadge status={reason.status} />
                <span>
                  <span className="reason-name">
                    {reason.name}（{reason.clause}）
                  </span>
                  {reasonText(reason)}
                </span>
              </li>
            ))}
          </ul>
          <div className="links-row">
            <details>
              <summary>根拠の文</summary>
              <Grounds reasons={entry.reasons} />
            </details>
            {entry.draft && (
              <details>
                <summary>声かけ文の下書きを見る</summary>
                <pre>{entry.draft}</pre>
              </details>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

export function OutreachPanel({ outreach, finalYear, changes, onOpenStudent }: Props) {
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
  const row = (entry: Outreach) => (
    <OutreachRow
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
      <div className="filter-bar">
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
        {filtering && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setYear("all");
              setRuleName("all");
            }}
          >
            絞り込みを外す
          </button>
        )}
      </div>
      <FinalYearSummary summary={finalYear} />
      <div className="section-head" id="outreach-contact">
        <h2>声をかける学生（{count(contact, shownContact)}）</h2>
      </div>
      <p className="lead">
        卒業の延期が見込まれる学生、最終年次で要件が足りない学生、履修条件を期限までに満たせない見込みの学生です。行を押すと理由と根拠を開き、学生 ID を押すと区分ごとの判定と履修案を開きます。
      </p>
      {contact.length === 0 && <p className="card muted">声をかける学生はいません。</p>}
      {contact.length > 0 && shownContact.length === 0 && (
        <p className="card muted">絞り込みに当てはまる学生はいません。</p>
      )}
      {shownContact.length > 0 && <ul className="outreach-list">{shownContact.map(row)}</ul>}
      <div className="section-head" id="outreach-review">
        <h2>職員が確認する学生（{count(review, shownReview)}）</h2>
      </div>
      <p className="lead">
        未回答の確認事項や、編入・休学などの特別な状態があり、コードでは判定を決められない学生です。未回答の確認事項だけが理由の学生は、回答すると判定が決まります。
      </p>
      {review.length === 0 && <p className="card muted">職員が確認する学生はいません。</p>}
      {review.length > 0 && shownReview.length === 0 && (
        <p className="card muted">絞り込みに当てはまる学生はいません。</p>
      )}
      {shownReview.length > 0 && <ul className="outreach-list">{shownReview.map(row)}</ul>}
    </section>
  );
}
