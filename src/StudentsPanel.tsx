import { useEffect, useState } from "react";
import type {
  Answers,
  Judgment,
  OverviewResponse,
  PlanCheckResponse,
  PlanEntry,
  StudentResponse,
} from "../shared/api";
import { AdvisorPanel } from "./AdvisorPanel";
import { checkPlan, fetchStudent } from "./api";
import { JudgmentBadge, PlanBadge, StateBadge } from "./StatusBadge";

const TERMS = ["前期", "後期", "通年"] as const;

const STATE_FILTERS = [
  { id: "all", label: "すべて" },
  { id: "contact", label: "声かけ" },
  { id: "staff_review", label: "職員確認" },
  { id: "clear", label: "対応なし" },
] as const;

type StateFilter = (typeof STATE_FILTERS)[number]["id"];

type Props = {
  datasetId: string;
  answers: Answers;
  students: OverviewResponse["students"];
  selectedId: string | null;
  onSelect: (studentId: string) => void;
};

function credits({ required, actual, enrolled }: Judgment) {
  if (required === undefined || actual === undefined) return "";
  const inProgress = enrolled ? `（履修中 ${enrolled}）` : "";
  return `${actual} / ${required}単位${inProgress}`;
}

function PlanForm({ datasetId, studentId, answers }: { datasetId: string; studentId: string; answers: Answers }) {
  const [lines, setLines] = useState<Record<string, string>>({});
  const [result, setResult] = useState<PlanCheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLines({});
    setResult(null);
    setError(null);
  }, [studentId]);

  async function submit() {
    const plan: PlanEntry[] = TERMS.flatMap((term) =>
      (lines[term] ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((course) => ({ course, term })),
    );
    if (plan.length === 0) {
      setError("科目を1つ以上入力してください。");
      return;
    }
    try {
      setError(null);
      setResult(await checkPlan(datasetId, studentId, plan, answers));
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : "検査に失敗しました。");
    }
  }

  return (
    <div>
      <h3>履修案の検査</h3>
      <p className="muted">科目名を1行に1つ入力します。</p>
      <div className="plan-grid">
        {TERMS.map((term) => (
          <label key={term}>
            {term}
            <textarea
              rows={5}
              value={lines[term] ?? ""}
              onChange={(event) => setLines({ ...lines, [term]: event.target.value })}
            />
          </label>
        ))}
      </div>
      <div className="actions">
        <button type="button" onClick={submit}>
          検査する
        </button>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {result && (
        <div className="plan-result" aria-live="polite">
          <PlanBadge status={result.status} />
          {result.status === "passed" && <p>すべての検査に通りました。</p>}
          {result.status !== "passed" && <p>この履修案は学生に示せません。</p>}
          <ul className="reasons">
            {result.issues.map((issue, index) => (
              <li key={`${issue.ruleId}-${index}`}>
                <span>
                  {issue.message}（{issue.clause}）{issue.hint}
                </span>
              </li>
            ))}
            {result.warnings.map((warning) => (
              <li key={warning}>
                <span className="muted">{warning}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function StudentsPanel({ datasetId, answers, students, selectedId, onSelect }: Props) {
  const [detail, setDetail] = useState<StudentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StateFilter>("all");
  const [keyword, setKeyword] = useState("");
  const shown = students.filter(
    ({ id, state }) =>
      (filter === "all" || state === filter) && id.toLowerCase().includes(keyword.trim().toLowerCase()),
  );

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    fetchStudent(datasetId, selectedId, answers)
      .then((result) => {
        if (active) {
          setDetail(result);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "取得に失敗しました。");
      });
    return () => {
      active = false;
    };
  }, [datasetId, selectedId, answers]);

  return (
    <section className="students">
      <div>
        <div className="student-filter">
          <label>
            絞り込み
            <select value={filter} onChange={(event) => setFilter(event.target.value as StateFilter)}>
              {STATE_FILTERS.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            学生 ID
            <input value={keyword} onChange={(event) => setKeyword(event.target.value)} />
          </label>
          <p className="muted">{shown.length}人</p>
        </div>
        <ul className="student-list" aria-label="学生の一覧">
          {shown.map((student) => (
            <li key={student.id}>
              <button
                type="button"
                className={student.id === selectedId ? "row selected" : "row"}
                aria-current={student.id === selectedId}
                onClick={() => onSelect(student.id)}
              >
                <span>{student.id}</span>
                <span className="muted">{student.studentYear}年次</span>
                <StateBadge state={student.state} />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="student-detail">
        {!selectedId && <p className="muted">学生を選んでください。</p>}
        {error && <p role="alert" className="error">{error}</p>}
        {selectedId && detail && detail.student.id === selectedId && (
          <>
            <h2>
              {detail.student.id}（{detail.student.studentYear}年次）
            </h2>
            <p className="muted">
              {detail.student.admissionYear}年度入学
              {detail.student.major ? `・${detail.student.major}` : ""}
              {detail.student.hasMinor ? "・副専攻あり" : ""}
            </p>
            {detail.excludedReason && <p className="notice">{detail.excludedReason}</p>}
            <table>
              <thead>
                <tr>
                  <th>判定</th>
                  <th>結果</th>
                  <th>単位</th>
                  <th>根拠</th>
                  <th>説明</th>
                </tr>
              </thead>
              <tbody>
                {detail.judgments.map((judgment) => (
                  <tr key={judgment.ruleId}>
                    <td className="nowrap">{judgment.name}</td>
                    <td>
                      <JudgmentBadge status={judgment.status} />
                    </td>
                    <td className="nowrap">{credits(judgment)}</td>
                    <td className="nowrap">{judgment.clause}</td>
                    <td>
                      {judgment.reason}
                      {judgment.missingCourses && judgment.missingCourses.length > 0 && (
                        <span className="muted"> 未修得: {judgment.missingCourses.join("、")}</span>
                      )}
                      <span className="quote">{judgment.sourceQuote}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <AdvisorPanel datasetId={datasetId} studentId={selectedId} answers={answers} />
            <PlanForm datasetId={datasetId} studentId={selectedId} answers={answers} />
          </>
        )}
      </div>
    </section>
  );
}
