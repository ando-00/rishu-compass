import { useEffect, useMemo, useState } from "react";
import {
  respondentSchema,
  type AnswerRecord,
  type DatasetsResponse,
  type OverviewResponse,
  type Respondent,
} from "../shared/api";
import { fetchAnswerRecords, fetchDatasets, fetchOverview, saveAnswer, withdrawProposal } from "./api";
import { ExtractionPanel } from "./ExtractionPanel";
import { OutreachPanel } from "./OutreachPanel";
import { QuestionsPanel } from "./QuestionsPanel";
import { StudentsPanel } from "./StudentsPanel";
import "./app.css";

type Tab = "import" | "questions" | "outreach" | "students";
type Summary = OverviewResponse["summary"];

const TABS: { id: Tab; label: string }[] = [
  { id: "import", label: "要項の取り込み" },
  { id: "questions", label: "確認事項" },
  { id: "outreach", label: "声かけ" },
  { id: "students", label: "学生別" },
];

function SummaryCell({ label, value, previous }: { label: string; value: number; previous?: number }) {
  return (
    <div className="summary-cell">
      <p className="muted">{label}</p>
      <p className="summary-value">{value}人</p>
      {previous !== undefined && previous !== value && (
        <p className="muted">回答前 {previous}人</p>
      )}
    </div>
  );
}

export function App() {
  const [datasets, setDatasets] = useState<DatasetsResponse["datasets"]>([]);
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [records, setRecords] = useState<AnswerRecord[] | null>(null);
  const [respondent, setRespondent] = useState<Respondent>("教務職員A");
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [previous, setPrevious] = useState<Summary | null>(null);
  const [tab, setTab] = useState<Tab>("questions");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const answers = useMemo(
    () => Object.fromEntries((records ?? []).map((r) => [r.ambiguityId, r.optionId])),
    [records],
  );

  useEffect(() => {
    fetchDatasets()
      .then((result) => {
        setDatasets(result.datasets);
        const first = result.datasets[0];
        if (first) setDatasetId(first.id);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "取得に失敗しました。");
      });
  }, []);

  useEffect(() => {
    if (!datasetId) return;
    let active = true;
    fetchAnswerRecords(datasetId)
      .then((result) => {
        if (active) setRecords(result.records);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        // 読めないときは未回答として扱い、関わる判定を職員確認に倒す。
        setRecords([]);
        setAnswerError(cause instanceof Error ? cause.message : "回答を読み込めませんでした。");
      });
    return () => {
      active = false;
    };
  }, [datasetId]);

  useEffect(() => {
    if (!datasetId || records === null) return;
    let active = true;
    fetchOverview(datasetId, answers)
      .then((result) => {
        if (active) {
          setOverview(result);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setOverview(null);
          setError(cause instanceof Error ? cause.message : "取得に失敗しました。");
        }
      });
    return () => {
      active = false;
    };
  }, [datasetId, records, answers]);

  // 記録できた回答だけを判定に使う。
  async function submitAnswer(ambiguityId: string, optionId: string | null) {
    if (!datasetId) return;
    try {
      const result = await saveAnswer(datasetId, { ambiguityId, optionId, respondent });
      setPrevious(overview?.summary ?? null);
      setRecords(result.records);
      setAnswerError(null);
    } catch (cause) {
      setAnswerError(cause instanceof Error ? cause.message : "回答を記録できませんでした。");
    }
  }

  function changeDataset(id: string) {
    setDatasetId(id);
    setRecords(null);
    setAnswerError(null);
    setOverview(null);
    setPrevious(null);
    setSelectedId(null);
  }

  async function reloadDatasets() {
    const result = await fetchDatasets();
    setDatasets(result.datasets);
    return result.datasets;
  }

  async function openConfirmed(id: string) {
    try {
      await reloadDatasets();
      changeDataset(id);
      setTab("questions");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "取得に失敗しました。");
    }
  }

  async function withdraw(proposalId: number) {
    try {
      await withdrawProposal(proposalId, respondent);
      const [first] = await reloadDatasets();
      if (first) changeDataset(first.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "確定を取り消せませんでした。");
    }
  }

  function openStudent(studentId: string) {
    setSelectedId(studentId);
    setTab("students");
  }

  const confirmation = datasets.find(({ id }) => id === datasetId)?.confirmation;

  return (
    <main>
      <header className="page-head">
        <div>
          <h1>履修コンパス</h1>
          <p className="muted">職員向けの判定案を作る試作品です。データはすべて架空です。</p>
        </div>
        <div className="page-controls">
          <label>
            対象
            <select value={datasetId ?? ""} onChange={(event) => changeDataset(event.target.value)}>
              {datasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            回答者
            <select
              value={respondent}
              onChange={(event) => setRespondent(respondentSchema.parse(event.target.value))}
            >
              {respondentSchema.options.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {confirmation && (
        <p className="confirmation">
          <span className="muted">
            {confirmation.respondent}が{new Date(confirmation.confirmedAt).toLocaleString("ja-JP")}に確定したルールです。
          </span>
          <button type="button" className="secondary" onClick={() => void withdraw(confirmation.proposalId)}>
            確定を取り消す
          </button>
        </p>
      )}

      {error && <pre role="alert" className="error">{error}</pre>}
      {answerError && <pre role="alert" className="error">{answerError}</pre>}

      {overview && (
        <>
          <div className="summary">
            <SummaryCell label="学生" value={overview.summary.total} />
            <SummaryCell label="声かけ" value={overview.summary.contact} previous={previous?.contact} />
            <SummaryCell
              label="職員確認"
              value={overview.summary.staffReview}
              previous={previous?.staffReview}
            />
            <SummaryCell label="対応なし" value={overview.summary.clear} previous={previous?.clear} />
          </div>

          <nav className="tabs" aria-label="画面の切り替え">
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={id === tab ? "tab active" : "tab"}
                aria-current={id === tab ? "page" : undefined}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>

          {tab === "questions" && (
            <QuestionsPanel
              overview={overview}
              records={records ?? []}
              onAnswer={(id, optionId) => void submitAnswer(id, optionId)}
              onClear={(id) => void submitAnswer(id, null)}
            />
          )}
          {tab === "outreach" && (
            <OutreachPanel outreach={overview.outreach} onOpenStudent={openStudent} />
          )}
          {tab === "students" && datasetId && (
            <StudentsPanel
              datasetId={datasetId}
              answers={answers}
              students={overview.students}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
        </>
      )}

      {/* 変換には数分かかるので、タブを切り替えても結果を残す */}
      <div hidden={tab !== "import"}>
        <ExtractionPanel
          datasets={datasets}
          respondent={respondent}
          onConfirmed={(id) => void openConfirmed(id)}
        />
      </div>
    </main>
  );
}
