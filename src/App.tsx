import { useEffect, useState } from "react";
import type { Answers, DatasetsResponse, OverviewResponse } from "../shared/api";
import { fetchDatasets, fetchOverview } from "./api";
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

function loadAnswers(datasetId: string): Answers {
  try {
    return JSON.parse(localStorage.getItem(`answers:${datasetId}`) ?? "{}") as Answers;
  } catch {
    return {};
  }
}

function saveAnswers(datasetId: string, answers: Answers) {
  try {
    localStorage.setItem(`answers:${datasetId}`, JSON.stringify(answers));
  } catch {
    // 保存できない環境でも、画面の中では回答を使える
  }
}

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
  const [answers, setAnswers] = useState<Answers>({});
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [previous, setPrevious] = useState<Summary | null>(null);
  const [tab, setTab] = useState<Tab>("questions");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDatasets()
      .then((result) => {
        setDatasets(result.datasets);
        const first = result.datasets[0];
        if (first) {
          setAnswers(loadAnswers(first.id));
          setDatasetId(first.id);
        }
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "取得に失敗しました。");
      });
  }, []);

  useEffect(() => {
    if (!datasetId) return;
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
  }, [datasetId, answers]);

  function updateAnswers(next: Answers) {
    if (!datasetId) return;
    setPrevious(overview?.summary ?? null);
    setAnswers(next);
    saveAnswers(datasetId, next);
  }

  function changeDataset(id: string) {
    setDatasetId(id);
    setAnswers(loadAnswers(id));
    setOverview(null);
    setPrevious(null);
    setSelectedId(null);
  }

  function openStudent(studentId: string) {
    setSelectedId(studentId);
    setTab("students");
  }

  return (
    <main>
      <header className="page-head">
        <div>
          <h1>履修コンパス</h1>
          <p className="muted">職員向けの判定案を作る試作品です。データはすべて架空です。</p>
        </div>
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
      </header>

      {error && <pre role="alert" className="error">{error}</pre>}

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
              onAnswer={(id, optionId) => updateAnswers({ ...answers, [id]: optionId })}
              onClear={(id) => {
                const { [id]: _removed, ...rest } = answers;
                updateAnswers(rest);
              }}
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
        <ExtractionPanel />
      </div>
    </main>
  );
}
