import type { JudgmentStatus, OverviewResponse } from "../shared/api";
import { JudgmentBadge } from "./StatusBadge";

const STATUSES: JudgmentStatus[] = ["satisfied", "expected", "delayed", "short", "delay_risk", "needs_staff"];

// 最終年次の卒業要件と区分ごとの判定の人数。engine が数えた値をそのまま出す。学生 ID は出さない
export function FinalYearSummary({ summary }: { summary: OverviewResponse["finalYear"] }) {
  // 当てはまる学生がいない区分（例: 最終年次に在籍者がいない専攻）は表を長くするだけなので出さない
  const rows = summary.rows.filter((row) => row.notApplicable < summary.studentCount);
  const hidden = summary.rows.length - rows.length;
  return (
    <details className="card final-year">
      <summary>
        最終年次（{summary.minYears}年次以上、{summary.studentCount}人）の卒業要件の内訳
      </summary>
      <p className="lead">
        卒業要件と区分ごとに、判定の人数を数えたものです。区分の行の「当てはまらない」は、専攻や副専攻の条件でその区分の対象にならない学生です。人数は判定の値を数えただけで、学生 ID は載せていません。
      </p>
      {summary.studentCount === 0 ? (
        <p className="muted">最終年次の学生はいません。</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>要件</th>
                <th>条文</th>
                {STATUSES.map((status) => (
                  <th key={status}>
                    <JudgmentBadge status={status} />
                  </th>
                ))}
                <th>当てはまらない</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.ruleId}>
                  <td>
                    {row.name}
                    {row.condition && <span className="muted">（{row.condition}）</span>}
                  </td>
                  <td className="nowrap">{row.clause}</td>
                  {STATUSES.map((status) => (
                    <td key={status} className={row.counts[status] === 0 ? "muted" : undefined}>
                      {row.counts[status]}人
                    </td>
                  ))}
                  <td className="muted">{row.kind === "graduation" ? "—" : `${row.notApplicable}人`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hidden > 0 && <p className="muted">最終年次に対象の学生がいない区分 {hidden}件は省いています。</p>}
    </details>
  );
}
