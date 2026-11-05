import { useEffect, useRef, useState } from "react";
import type { AdviseResponse, Correction, SavedAdvice } from "../shared/advise";
import type { Answers } from "../shared/api";
import { adviseStudent, fetchLatestAdvice, loadRecordedAdvice } from "./api";
import { PlanBadge, StateBadge } from "./StatusBadge";

type Props = {
  datasetId: string;
  studentId: string;
  answers: Answers;
};

const STAGE_LABELS = { plan: "履修案", draft: "声かけ文" } as const;

function Corrections({ corrections }: { corrections: Correction[] }) {
  if (corrections.length === 0) return <p className="muted">最初の検査で通りました。</p>;
  return (
    <div className="corrections">
      <h4>検査に落ちて直した経過（{corrections.length}回）</h4>
      <p className="muted">コードの検査が返した内容です。Claude が案を直し、通った案だけを下に表示しています。</p>
      <ol>
        {corrections.map(({ stage, messages }, index) => (
          <li key={index}>
            <span className="muted">{STAGE_LABELS[stage]}</span>
            <ul>
              {messages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}

function PlanResult({ result }: { result: Extract<AdviseResponse, { status: "passed" }> }) {
  return (
    <>
      {result.staffReview && (
        <p role="note" className="staff-review">
          <StateBadge state="staff_review" /> {result.staffReview}
        </p>
      )}
      <p>
        {result.planningYear}年次に向けた案です。コードの検査を通りました（合計 {result.totalCredits}単位）。
      </p>
      <Corrections corrections={result.corrections} />
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
  const recording = saved.advice?.status === "passed" ? saved.advice.recording : undefined;
  if (recording) {
    return (
      <p className="notice">
        {recording.recordedAt} に {recording.model} で作った記録を読み込みました。今のルールで検査し直しています。今回は Claude を呼んでいません。
      </p>
    );
  }
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

  async function run(create: typeof adviseStudent) {
    const request = ++latestRequest.current;
    setRunning(true);
    setSaved(null);
    setError(null);
    try {
      const created = await create(datasetId, studentId, answers);
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
        <button type="button" disabled={running} onClick={() => void run(adviseStudent)}>
          {running ? "作成中です" : result ? "履修案を作り直す" : "履修案を作る"}
        </button>
        {saved?.recordingAvailable && !result && (
          <button
            type="button"
            className="secondary"
            disabled={running}
            onClick={() => void run(loadRecordedAdvice)}
          >
            記録を読み込む
          </button>
        )}
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
