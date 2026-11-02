import { useEffect, useRef, useState } from "react";
import type { AdviseResponse, SavedAdvice } from "../shared/advise";
import type { Answers } from "../shared/api";
import { adviseStudent, fetchLatestAdvice } from "./api";
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

function RecordNote({ saved }: { saved: SavedAdvice }) {
  return (
    <p className="muted">
      {saved.recordedAt
        ? `${new Date(saved.recordedAt).toLocaleString("ja-JP")}に作成した記録です。`
        : "この結果は記録できませんでした。"}
    </p>
  );
}

export function AdvisorPanel({ datasetId, studentId, answers }: Props) {
  const [saved, setSaved] = useState<SavedAdvice | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 学生や回答が変わったあとに届いた結果を、別の学生の案として見せない。
  const latestRequest = useRef(0);
  const result = saved?.advice ?? null;

  useEffect(() => {
    const request = ++latestRequest.current;
    setSaved(null);
    setRunning(false);
    setError(null);
    fetchLatestAdvice(datasetId, studentId, answers)
      .then((found) => {
        if (request === latestRequest.current) setSaved(found);
      })
      .catch((cause: unknown) => {
        if (request !== latestRequest.current) return;
        setError(cause instanceof Error ? cause.message : "以前の履修案を読み込めませんでした。");
      });
  }, [datasetId, studentId, answers]);

  async function run() {
    const request = ++latestRequest.current;
    setRunning(true);
    setSaved(null);
    setError(null);
    try {
      const created = await adviseStudent(datasetId, studentId, answers);
      if (request === latestRequest.current) setSaved(created);
    } catch (cause) {
      if (request !== latestRequest.current) return;
      setError(cause instanceof Error ? cause.message : "履修案を作れませんでした。");
    } finally {
      if (request === latestRequest.current) setRunning(false);
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
          {running ? "作成中です" : result ? "履修案を作り直す" : "履修案を作る"}
        </button>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {saved && result && (
        <div className="plan-result" aria-live="polite">
          <PlanBadge status={result.status} />
          <RecordNote saved={saved} />
          {result.status === "passed" ? <PlanResult result={result} /> : <p>{result.reason}</p>}
        </div>
      )}
    </div>
  );
}
