import { useEffect, useState } from "react";
import type { Answers, RegistrationCheckResponse } from "../shared/api";
import { checkRegistrations } from "./api";
import { PlanBadge } from "./StatusBadge";

type Props = {
  datasetId: string;
  answers: Answers;
  onSelect: (studentId: string) => void;
};

// 今期の登録をまとめて検査した結果（H25 の J）。今期はもう始まっているので、職員確認の候補として出す。
// 声かけと職員確認の人数には足さない
export function RegistrationCheck({ datasetId, answers, onSelect }: Props) {
  const [result, setResult] = useState<RegistrationCheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    checkRegistrations(datasetId, answers)
      .then((response) => {
        if (active) {
          setResult(response);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "取得に失敗しました。");
      });
    return () => {
      active = false;
    };
  }, [datasetId, answers]);

  if (error) return <p role="alert" className="error">今期の登録を検査できませんでした: {error}</p>;
  if (!result) return null;
  const failed = result.results.filter(({ status }) => status === "failed").length;
  const staff = result.results.length - failed;
  return (
    <details className="records card">
      <summary>
        <h3>今期の登録の検査（職員確認の候補）</h3>
        <span className="muted">
          履修中の登録がある {result.checked}人のうち、不合格 {failed}人、職員確認 {staff}人
        </span>
      </summary>
      <p className="muted">
        今年度の履修中の登録に、履修案と同じ検査を掛けました。今期はもう始まっているので、職員が確かめる候補です。上の声かけと職員確認の人数には入りません。
      </p>
      {result.results.length === 0 ? (
        <p className="muted">検査に通らなかった学生はいません。</p>
      ) : (
        <div className="records-scroll">
          <table>
            <thead>
              <tr>
                <th>学生</th>
                <th>年次</th>
                <th>結果</th>
                <th>内容</th>
              </tr>
            </thead>
            <tbody>
              {result.results.map(({ studentId, studentYear, status, issues }) => {
                // 未回答で止まった項目より、具体的な問題を先に出す
                const ordered = [...issues].sort(
                  (a, b) => Number(a.code === "PENDING_RULE") - Number(b.code === "PENDING_RULE"),
                );
                const messages = [...new Set(ordered.map(({ message }) => message))];
                return (
                  <tr key={studentId}>
                    <td className="nowrap">
                      <button type="button" className="link" onClick={() => onSelect(studentId)}>
                        {studentId}
                      </button>
                    </td>
                    <td className="nowrap">{studentYear}年次</td>
                    <td className="nowrap">
                      <PlanBadge status={status} />
                    </td>
                    <td>
                      {messages.slice(0, 2).join(" ")}
                      {messages.length > 2 && <span className="muted">（ほか {messages.length - 2}件）</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
