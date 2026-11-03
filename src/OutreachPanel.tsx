import { useState, type ReactNode } from "react";
import { describeAmounts } from "../engine/outreach";
import type { StateChange } from "../engine/stateChanges";
import type { Outreach, OverviewResponse } from "../shared/api";
import { FinalYearSummary } from "./FinalYearSummary";
import { JudgmentBadge, NewlyListedBadge } from "./StatusBadge";

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

// 一覧の行の「内容」。理由が具体的なら最初の1文を出し、量を添える。全文は行を開くと出る
function summaryText(reason: Outreach["reasons"][number]) {
  const amounts = describeAmounts(reason);
  if (reason.detail === SHORT_DETAIL || !reason.detail) return amounts;
  const first = reason.detail.split("。")[0];
  return amounts ? `${first}（${amounts}）` : first;
}

// 重い判定から並べる。一覧の行には先頭の判定だけを出し、押すと全部を開く
const REASON_ORDER = { delay_risk: 0, short: 1, needs_staff: 2, expected: 3, satisfied: 4 } as const;

function OutreachRow({ entry, newlyListed, onOpenStudent }: CardProps) {
  const [open, setOpen] = useState(false);
  const sorted = [...entry.reasons].sort((a, b) => REASON_ORDER[a.status] - REASON_ORDER[b.status]);
  const top = sorted[0];
  const detailId = `outreach-${entry.studentId}`;
  return (
    <>
      <tr
        className={open ? "outreach-row open" : "outreach-row"}
        // 行のどこを押しても開く。ボタンはキーボードで開くためのもの
        onClick={(event) => {
          if (!(event.target as HTMLElement).closest("button")) setOpen(!open);
        }}
      >
        <td className="nowrap">
          <button type="button" className="link id" onClick={() => onOpenStudent(entry.studentId)}>
            {entry.studentId}
          </button>
          {newlyListed && <NewlyListedBadge />}
        </td>
        <td className="num">{entry.studentYear}</td>
        <td className="nowrap">
          {top && (
            <>
              <JudgmentBadge status={top.status} /> {top.name}
              <span className="muted">（{top.clause}）</span>
            </>
          )}
        </td>
        <td className="outreach-summary">{top && summaryText(top)}</td>
        <td className="nowrap outreach-more">
          <button
            type="button"
            className="link"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={() => setOpen(!open)}
          >
            {sorted.length > 1 ? `ほか${sorted.length - 1}件` : "詳細"}
            <span aria-hidden="true">{open ? " ▴" : " ▾"}</span>
          </button>
        </td>
      </tr>
      {open && (
        <tr className="outreach-detail-row">
          <td />
          <td colSpan={4} className="outreach-detail" id={detailId}>
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
          </td>
        </tr>
      )}
    </>
  );
}

function OutreachTable({ entries, row }: { entries: Outreach[]; row: (entry: Outreach) => ReactNode }) {
  return (
    <div className="table-scroll">
      <table className="outreach-table">
        <thead>
          <tr>
            <th>学生</th>
            <th className="num">年次</th>
            <th>主な理由</th>
            <th>内容</th>
            <th />
          </tr>
        </thead>
        <tbody>{entries.map(row)}</tbody>
      </table>
    </div>
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
      <p className="lead">卒業の延期の見込み、最終年次の不足、期限までに満たせない履修条件がある学生です。</p>
      {contact.length === 0 && <p className="empty-line">声をかける学生はいません。</p>}
      {contact.length > 0 && shownContact.length === 0 && (
        <p className="empty-line">絞り込みに当てはまる学生はいません。</p>
      )}
      {shownContact.length > 0 && <OutreachTable entries={shownContact} row={row} />}
      <div className="section-head" id="outreach-review">
        <h2>職員が確認する学生（{count(review, shownReview)}）</h2>
      </div>
      <p className="lead">未回答の確認事項や、編入・休学などがあり、コードでは判定を決められない学生です。</p>
      {review.length === 0 && <p className="empty-line">職員が確認する学生はいません。</p>}
      {review.length > 0 && shownReview.length === 0 && (
        <p className="empty-line">絞り込みに当てはまる学生はいません。</p>
      )}
      {shownReview.length > 0 && <OutreachTable entries={shownReview} row={row} />}
    </section>
  );
}
