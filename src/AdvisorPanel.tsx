import { useEffect, useState } from "react";
import type { AdviseResponse } from "../shared/advise";
import type { Answers } from "../shared/api";
import { adviseStudent } from "./api";
import { PlanBadge } from "./StatusBadge";

type Props = {
  datasetId: string;
  studentId: string;
  answers: Answers;
};

function PlanResult({ result }: { result: Extract<AdviseResponse, { status: "passed" }> }) {
  return (
    <>
      <p>
        {result.planningYear}年次に向けた案です。コードの検査を通りました（合計 {result.totalCredits}単位）。
      </p>
      <table>
        <thead>
          <tr>
            <th>学期</th>
            <th>科目</th>
            <th>単位</th>
          </tr>
        </thead>
        <tbody>
          {result.plan.map(({ course, term, credits }) => (
            <tr key={course}>
              <td>{term}</td>
              <td>{course}</td>
              <td>{credits}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {result.warnings.length > 0 && (
        <ul className="reasons">
          {result.warnings.map((warning) => (
            <li key={warning}>
              <span className="muted">{warning}</span>
            </li>
          ))}
        </ul>
      )}
      <h4>声かけ文の下書き</h4>
      <p className="muted">送信はしません。送るかどうかは職員が決めます。</p>
      <pre className="draft">{result.draft}</pre>
    </>
  );
}

export function AdvisorPanel({ datasetId, studentId, answers }: Props) {
  const [result, setResult] = useState<AdviseResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setError(null);
  }, [studentId]);

  async function run() {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      setResult(await adviseStudent(datasetId, studentId, answers));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "履修案を作れませんでした。");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <h3>履修案</h3>
      <p className="muted">
        履修中の科目をすべて修得した前提で、Claude が案を組みます。検査を通った案だけを表示します。
      </p>
      <div className="actions">
        <button type="button" disabled={running} onClick={() => void run()}>
          {running ? "作成中です" : "履修案を作る"}
        </button>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {result && (
        <div className="plan-result" aria-live="polite">
          <PlanBadge status={result.status} />
          {result.status === "passed" ? <PlanResult result={result} /> : <p>{result.reason}</p>}
        </div>
      )}
    </div>
  );
}
