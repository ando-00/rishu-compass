import { Fragment, useEffect, useRef, useState } from "react";
import { amountCaveat } from "./judgmentAmounts";
import type {
  Answers,
  Judgment,
  OverviewResponse,
  PlanCheckResponse,
  PlanEntry,
  StudentResponse,
} from "../shared/api";
import { AdvisorPanel } from "./AdvisorPanel";
import { checkPlan, fetchCourses, fetchPlanCandidates, fetchStudent } from "./api";
import { type CourseOption, candidatesFor, TERMS } from "./courseCandidates";
import { RegistrationCheck } from "./RegistrationCheck";
import { JudgmentBadge, PlanBadge, StateBadge } from "./StatusBadge";

const STATE_FILTERS = [
  { id: "all", label: "すべて" },
  { id: "contact", label: "声かけ" },
  { id: "staff_review", label: "職員確認" },
  { id: "clear", label: "対応なし" },
] as const;

export type StateFilter = (typeof STATE_FILTERS)[number]["id"];

const STATE_ORDER = { contact: 0, staff_review: 1, clear: 2 } as const;

type Props = {
  datasetId: string;
  answers: Answers;
  students: OverviewResponse["students"];
  selectedId: string | null;
  onSelect: (studentId: string) => void;
  filter: StateFilter;
  onFilterChange: (filter: StateFilter) => void;
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
  const [checking, setChecking] = useState(false);
  // 入力や学生が変わったあとに届いた結果を、今の入力の結果として見せない（追加の監査 R-3）
  const latestRequest = useRef(0);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [unavailable, setUnavailable] = useState<ReadonlySet<string>>(new Set());

  // 候補は選びやすくするためだけに使う。検査は入力された科目名で engine が行う
  useEffect(() => {
    let active = true;
    fetchCourses(datasetId)
      .then((result) => active && setCourses(result.courses))
      .catch(() => active && setCourses([]));
    return () => {
      active = false;
    };
  }, [datasetId]);

  // 修得済み、履修中、失格の再履修で検査に必ず落ちる科目は候補に出さない（B41）。外せなくても入力はできる
  useEffect(() => {
    let active = true;
    setUnavailable(new Set());
    fetchPlanCandidates(datasetId, studentId, answers)
      .then((result) => active && setUnavailable(new Set(result.unavailable.map(({ course }) => course))))
      .catch(() => active && setUnavailable(new Set()));
    return () => {
      active = false;
    };
  }, [datasetId, studentId, answers]);

  // 検査の結果は、検査したときの入力のもの。入力を直したら結果を消し、検査していない案の横に「検査に通過」を残さない
  function clearResult() {
    latestRequest.current += 1;
    setResult(null);
    setError(null);
    setChecking(false);
  }

  function changeLines(next: Record<string, string>) {
    clearResult();
    setLines(next);
  }

  function addCourse(term: string, name: string) {
    if (!name) return;
    const current = (lines[term] ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (current.includes(name)) return;
    changeLines({ ...lines, [term]: [...current, name].join("\n") });
  }

  useEffect(() => {
    clearResult();
    setLines({});
  }, [studentId]);

  // 対象や回答が変わると検査の前提が変わるので、前の結果を残さない
  useEffect(() => {
    clearResult();
  }, [datasetId, answers]);

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
    const request = ++latestRequest.current;
    setChecking(true);
    setError(null);
    try {
      const checked = await checkPlan(datasetId, studentId, plan, answers);
      if (request === latestRequest.current) setResult(checked);
    } catch (cause) {
      if (request !== latestRequest.current) return;
      setResult(null);
      setError(cause instanceof Error ? cause.message : "検査に失敗しました。");
    } finally {
      if (request === latestRequest.current) setChecking(false);
    }
  }

  return (
    <div>
      <h3>履修案の検査</h3>
      <p className="muted">
        科目名を1行に1つ入力するか、学期ごとの候補から選びます。後期の学生の案は、翌年度に履修する科目として検査します。今年度に履修中の科目は、すべて修得したものとして数えます。
      </p>
      {unavailable.size > 0 && (
        <p className="muted">修得済み・履修中などで案に入れられない {unavailable.size}科目は、候補に出していません。</p>
      )}
      <div className="plan-grid">
        {TERMS.map((term) => (
          <div key={term} className="plan-term">
            <label>
              {term}
              <textarea
                rows={5}
                value={lines[term] ?? ""}
                onChange={(event) => changeLines({ ...lines, [term]: event.target.value })}
              />
            </label>
            {courses.length > 0 && (
              <select
                aria-label={`${term}に科目を足す`}
                value=""
                onChange={(event) => addCourse(term, event.target.value)}
              >
                <option value="">候補から足す（{candidatesFor(courses, term, unavailable).length}科目）</option>
                {candidatesFor(courses, term, unavailable).map((course) => (
                  <option key={course.name} value={course.name}>
                    {course.name}（{course.assignedYear}年次・{course.credits}単位）
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
      </div>
      <div className="actions">
        <button type="button" disabled={checking} onClick={() => void submit()}>
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

const RESULT_LABELS = { passed: "修得", failed: "不合格", disqualified: "失格", enrolled: "履修中" } as const;
const TERM_ORDER = { 前期: 0, 通年: 1, 後期: 2 } as const;

// 履修の記録。判定案を成績と突き合わせて確かめるために出す。判定には使わない表示だけの表
function RecordsTable({ records }: { records: StudentResponse["records"] }) {
  const sorted = [...records].sort(
    (a, b) => a.studentYear - b.studentYear || TERM_ORDER[a.term] - TERM_ORDER[b.term] || a.course.localeCompare(b.course, "ja"),
  );
  // 判定を確かめるときだけ開く。見出しは閉じていても見える
  return (
    <details className="records">
      <summary>
        <h3>履修の記録（{records.length}件）</h3>
        <span className="muted">修得・不合格・失格・履修中を年次と学期の順に並べます</span>
      </summary>
      {records.length === 0 ? (
        <p className="muted">記録がありません。</p>
      ) : (
        <div className="records-scroll">
          <table>
            <thead>
              <tr>
                <th>年次</th>
                <th>学期</th>
                <th>科目</th>
                <th>結果</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((record, index) => (
                <tr key={`${record.course}-${record.studentYear}-${record.term}-${index}`}>
                  <td className="nowrap">{record.studentYear}年次</td>
                  <td className="nowrap">{record.term}</td>
                  <td>{record.course}</td>
                  <td className="nowrap">{RESULT_LABELS[record.result]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

export function StudentsPanel({ datasetId, answers, students, selectedId, onSelect, filter, onFilterChange }: Props) {
  const [detail, setDetail] = useState<StudentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [year, setYear] = useState("all");
  const years = [...new Set(students.map((student) => student.studentYear))].sort((a, b) => a - b);
  // 対応が要る学生を上に出す。同じ対応の中は学生 ID の順
  const shown = students
    .filter(
      ({ id, state, studentYear }) =>
        (filter === "all" || state === filter) &&
        (year === "all" || String(studentYear) === year) &&
        id.toLowerCase().includes(keyword.trim().toLowerCase()),
    )
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]);

  const state = students.find(({ id }) => id === selectedId)?.state;

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
    <>
      <RegistrationCheck datasetId={datasetId} answers={answers} onSelect={onSelect} />
      <section className="students">
        <div className="student-side">
          <div className="segmented" role="group" aria-label="絞り込み">
            {STATE_FILTERS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                onClick={() => onFilterChange(id)}
              >
                {label} {id === "all" ? students.length : students.filter(({ state }) => state === id).length}
              </button>
            ))}
          </div>
          <div className="student-filter">
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
              学生 ID
              <input value={keyword} placeholder="例: S0095" onChange={(event) => setKeyword(event.target.value)} />
            </label>
            <p className="muted">{shown.length}人を表示（声かけ、職員確認、対応なしの順）</p>
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
          {!selectedId && (
            <div className="empty">
              <p>
                左の一覧から学生を選ぶと、区分ごとの判定と根拠、履修の記録、履修案がここに出ます。
                <br />
                声かけの学生から見るときは、上の「声かけ」の人数を押してください。
              </p>
            </div>
          )}
          {error && <p role="alert" className="error">{error}</p>}
          {selectedId && detail && detail.student.id === selectedId && (
            <>
              <div className="card">
              <div className="detail-head">
                <h2>
                  {detail.student.id}（{detail.student.studentYear}年次）
                </h2>
                {state && <StateBadge state={state} />}
                <p className="muted">
                  {detail.student.admissionYear}年度入学
                  {detail.student.major ? `・${detail.student.major}` : ""}
                  {detail.student.hasMinor ? "・副専攻あり" : ""}
                </p>
              </div>
              {detail.excludedReason && <p className="notice">{detail.excludedReason}</p>}
              <table className="judgment-table">
                <thead>
                  <tr>
                    <th>判定</th>
                    <th>結果</th>
                    <th>単位</th>
                    <th>根拠</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.judgments.map((judgment) => (
                    <Fragment key={judgment.ruleId}>
                      <tr className="judgment-row">
                        <td className="nowrap">{judgment.name}</td>
                        <td>
                          <JudgmentBadge status={judgment.status} />
                        </td>
                        <td className="nowrap">{credits(judgment)}</td>
                        <td className={judgment.clause.length > 16 ? undefined : "nowrap"}>{judgment.clause}</td>
                      </tr>
                      <tr className="judgment-detail">
                        <td colSpan={4}>
                          {judgment.reason}
                          {judgment.missingCourses && judgment.missingCourses.length > 0 && (
                            <span className="muted"> 未修得: {judgment.missingCourses.join("、")}</span>
                          )}
                          {amountCaveat(judgment) && <span className="muted"> {amountCaveat(judgment)}</span>}
                          <span className="quote">{judgment.sourceQuote}</span>
                        </td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
              </div>
              <div className="card">
                <AdvisorPanel datasetId={datasetId} studentId={selectedId} answers={answers} />
              </div>
              <div className="card">
                <RecordsTable records={detail.records} />
              </div>
              <div className="card">
                <PlanForm datasetId={datasetId} studentId={selectedId} answers={answers} />
              </div>
            </>
          )}
        </div>
      </section>
    </>
  );
}
