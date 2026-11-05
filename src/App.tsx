import { Fragment, useEffect, useMemo, useState } from "react";
import {
  respondentSchema,
  type AnswerHistoryEntry,
  type AnswerRecord,
  type DatasetsResponse,
  type OverviewResponse,
  type PreviousAnswer,
  type Respondent,
} from "../shared/api";
import { changesAfterAnswer } from "./answerChanges";
import { fetchAnswerRecords, fetchDatasets, fetchOverview, saveAnswer, withdrawProposal } from "./api";
import { ChangesPanel } from "./ChangesPanel";
import { ExtractionPanel } from "./ExtractionPanel";
import { OutreachPanel } from "./OutreachPanel";
import { QuestionsPanel } from "./QuestionsPanel";
import { StudentsPanel } from "./StudentsPanel";
import "./app.css";

type Tab = "import" | "questions" | "outreach" | "students";

// 職員の作業の順に並べる。学生別は順番の外にある
const TABS: { id: Tab; label: string; step?: number }[] = [
  { id: "import", label: "要項の取り込み", step: 1 },
  { id: "questions", label: "確認事項", step: 2 },
  { id: "outreach", label: "声かけ", step: 3 },
  { id: "students", label: "学生別" },
];

type SummaryProps = {
  label: string;
  value: number;
  note: string;
  tone?: "bad" | "warn" | "good";
  previous?: number;
  onOpen: () => void;
};

function SummaryCell({ label, value, note, tone, previous, onOpen }: SummaryProps) {
  return (
    <button type="button" className={`summary-cell${tone ? ` tone-${tone}` : ""}`} onClick={onOpen}>
      <p className="summary-label">{label}</p>
      <p>
        <span className="summary-value">{value}人</span>
        {previous !== undefined && previous !== value && (
          <span className="summary-delta">
            直前 {previous}人（{value > previous ? "+" : ""}
            {value - previous}）
          </span>
        )}
      </p>
      <p className="summary-note">{note}</p>
    </button>
  );
}

export function App() {
  const [datasets, setDatasets] = useState<DatasetsResponse["datasets"]>([]);
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [records, setRecords] = useState<AnswerRecord[] | null>(null);
  const [history, setHistory] = useState<AnswerHistoryEntry[]>([]);
  const [previousAnswers, setPreviousAnswers] = useState<PreviousAnswer[]>([]);
  const [respondent, setRespondent] = useState<Respondent>("教務職員A");
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [previous, setPrevious] = useState<OverviewResponse | null>(null);
  const [tab, setTab] = useState<Tab>("questions");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const answers = useMemo(
    () => Object.fromEntries((records ?? []).map((r) => [r.ambiguityId, r.optionId])),
    [records],
  );
  const changes = useMemo(() => changesAfterAnswer(previous, overview), [previous, overview]);

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
        if (active) {
          setRecords(result.records);
          setHistory(result.history);
          setPreviousAnswers(result.previous);
        }
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
      setPrevious(overview);
      setRecords(result.records);
      setHistory(result.history);
      setPreviousAnswers(result.previous);
      setAnswerError(null);
    } catch (cause) {
      setAnswerError(cause instanceof Error ? cause.message : "回答を記録できませんでした。");
    }
  }

  function changeDataset(id: string) {
    // 同じ対象では取り直しが走らないので、読み込み済みの内容を消さない。
    if (id === datasetId) return;
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

  function openTab(next: Tab, anchor?: string) {
    setTab(next);
    // 切り替えた画面が描かれてから、その節まで移る
    requestAnimationFrame(() => {
      const target = anchor ? document.getElementById(anchor) : null;
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      else window.scrollTo({ top: 0 });
    });
  }

  function tabCount(id: Tab) {
    if (!overview) return null;
    if (id === "questions" && overview.unanswered.length > 0)
      return <span className="tab-count warn">未回答 {overview.unanswered.length}</span>;
    if (id === "outreach" && overview.summary.contact > 0)
      return <span className="tab-count bad">{overview.summary.contact}人</span>;
    return null;
  }

  const current = datasets.find(({ id }) => id === datasetId);
  const confirmation = current?.confirmation;
  // どのルールで判定しているかを常に示す（監査の A25-19、P3-14。3役が「初期の数字が何のルールか分からない」と挙げた）
  const ruleSource = !current
    ? null
    : confirmation
      ? `職員が確定したルール案（第${confirmation.proposalId}版）で判定しています。`
      : current.sourceId
        ? "作り手が要項を読んで決めた正解ルールで判定しています。職員がルール案を確定すると、その版に切り替わります。"
        : "見本のルールで判定しています。";

  return (
    <>
      <header className="app-bar">
        <div className="app-bar-inner">
          <div className="brand">
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
        </div>
      </header>
      <main>
        {ruleSource && (
          <p className={confirmation ? "confirmation confirmed" : "confirmation"} data-testid="rule-source">
            <span>
              {ruleSource}
              {confirmation &&
                `${confirmation.respondent}が${new Date(confirmation.confirmedAt).toLocaleString("ja-JP")}に確定しました。`}
            </span>
            {confirmation && (
              <button type="button" className="secondary" onClick={() => void withdraw(confirmation.proposalId)}>
                確定を取り消す
              </button>
            )}
          </p>
        )}
  
        {error && <pre role="alert" className="error">{error}</pre>}
        {answerError && <pre role="alert" className="error">{answerError}</pre>}
  
        {overview && (
          <>
            <div className="summary">
              <SummaryCell
                label="学生"
                value={overview.summary.total}
                note="全学生の一覧を開く"
                onOpen={() => openTab("students")}
              />
              <SummaryCell
                label="声かけ"
                value={overview.summary.contact}
                note="延期見込み・最終年次の不足など"
                tone="bad"
                previous={previous?.summary.contact}
                onOpen={() => openTab("outreach", "outreach-contact")}
              />
              <SummaryCell
                label="職員確認"
                value={overview.summary.staffReview}
                note="コードでは決められない判定がある"
                tone="warn"
                previous={previous?.summary.staffReview}
                onOpen={() => openTab("outreach", "outreach-review")}
              />
              <SummaryCell
                label="対応なし"
                value={overview.summary.clear}
                note="今は声をかけなくてよい"
                tone="good"
                previous={previous?.summary.clear}
                onOpen={() => openTab("students")}
              />
            </div>
  
            {changes && tab !== "import" && (
              <ChangesPanel
                changes={changes}
                onOpenStudent={openStudent}
                onOpenOutreach={() => setTab("outreach")}
              />
            )}
  
            {/* 番号と件数は見た目の手がかり。読み上げではタブの名前だけにする */}
            <nav className="tabs" aria-label="画面の切り替え">
              {TABS.map(({ id, label, step }) => (
                <Fragment key={id}>
                  {step === undefined && <span className="tab-spacer" />}
                  <button
                    type="button"
                    className={id === tab ? "tab active" : "tab"}
                    aria-current={id === tab ? "page" : undefined}
                    onClick={() => setTab(id)}
                  >
                    {step !== undefined && (
                      <span className="step-number" aria-hidden="true">
                        {step}
                      </span>
                    )}
                    {label}
                    <span aria-hidden="true">{tabCount(id)}</span>
                  </button>
                </Fragment>
              ))}
            </nav>
  
            {tab === "questions" && (
              <QuestionsPanel
                overview={overview}
                datasetName={
                  (current?.name ?? "") + (confirmation ? `（確定ルール 第${confirmation.proposalId}版）` : "")
                }
                records={records ?? []}
                history={history}
                previousAnswers={previousAnswers}
                onAnswer={(id, optionId) => void submitAnswer(id, optionId)}
                onClear={(id) => void submitAnswer(id, null)}
              />
            )}
            {tab === "outreach" && (
              <OutreachPanel
                outreach={overview.outreach}
                finalYear={overview.finalYear}
                changes={changes ?? []}
                onOpenStudent={openStudent}
              />
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
            sourceId={datasets.find(({ id }) => id === datasetId)?.sourceId}
            respondent={respondent}
            onConfirmed={(id) => void openConfirmed(id)}
          />
        </div>
      </main>
    </>
  );
}
