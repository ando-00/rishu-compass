import { Fragment, useEffect, useState } from "react";
import type {
  Answers,
  CoursesResponse,
  Judgment,
  OverviewResponse,
  PlanCheckResponse,
  PlanEntry,
  StudentResponse,
} from "../shared/api";
import { AdvisorPanel } from "./AdvisorPanel";
import { checkPlan, fetchCourses, fetchStudent } from "./api";
import { JudgmentBadge, PlanBadge, StateBadge } from "./StatusBadge";

const TERMS = ["前期", "後期", "通年"] as const;

const STATE_FILTERS = [
  { id: "all", label: "すべて" },
  { id: "contact", label: "声かけ" },
  { id: "staff_review", label: "職員確認" },
  { id: "clear", label: "対応なし" },
] as const;

type StateFilter = (typeof STATE_FILTERS)[number]["id"];

const STATE_ORDER = { contact: 0, staff_review: 1, clear: 2 } as const;

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

type CourseOption = CoursesResponse["courses"][number];

// 学期の欄に入れられる科目。開講学期の指定がない科目は、どの学期にも入れられる（engine の NOT_OFFERED と同じ扱い）
function candidatesFor(courses: CourseOption[], term: (typeof TERMS)[number]) {
  return courses
    .filter(({ offeredIn }) => offeredIn === undefined || offeredIn === term)
    .sort((a, b) => a.assignedYear - b.assignedYear || a.name.localeCompare(b.name, "ja"));
}

function PlanForm({ datasetId, studentId, answers }: { datasetId: string; studentId: string; answers: Answers }) {
  const [lines, setLines] = useState<Record<string, string>>({});
  const [result, setResult] = useState<PlanCheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [courses, setCourses] = useState<CourseOption[]>([]);

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

  function addCourse(term: string, name: string) {
    if (!name) return;
    const current = (lines[term] ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (current.includes(name)) return;
    setLines({ ...lines, [term]: [...current, name].join("\n") });
  }

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
      <p className="muted">
        科目名を1行に1つ入力するか、学期ごとの候補から選びます。「履修案を作る」と同じ前提で検査します。後期の学生は翌年度の案として、履修中の科目を修得した前提で見ます。
      </p>
      <div className="plan-grid">
        {TERMS.map((term) => (
          <div key={term} className="plan-term">
            <label>
              {term}
              <textarea
                rows={5}
                value={lines[term] ?? ""}
                onChange={(event) => setLines({ ...lines, [term]: event.target.value })}
              />
            </label>
            {courses.length > 0 && (
              <select
                aria-label={`${term}に科目を足す`}
                value=""
                onChange={(event) => addCourse(term, event.target.value)}
              >
                <option value="">候補から足す（{candidatesFor(courses, term).length}科目）</option>
                {candidatesFor(courses, term).map((course) => (
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

export function StudentsPanel({ datasetId, answers, students, selectedId, onSelect }: Props) {
  const [detail, setDetail] = useState<StudentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StateFilter>("all");
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
    <section className="students">
      <div className="student-side">
        <div className="segmented" role="group" aria-label="絞り込み">
          {STATE_FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
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
            <table>
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
                      <td className="nowrap">{judgment.clause}</td>
                    </tr>
                    <tr className="judgment-detail">
                      <td colSpan={4}>
                        {judgment.reason}
                        {judgment.missingCourses && judgment.missingCourses.length > 0 && (
                          <span className="muted"> 未修得: {judgment.missingCourses.join("、")}</span>
                        )}
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
  );
}
