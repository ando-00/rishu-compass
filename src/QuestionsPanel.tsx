import type { AnswerHistoryEntry, AnswerRecord, Impact, JudgmentStatus, OverviewResponse } from "../shared/api";
import { JudgmentBadge } from "./StatusBadge";

const COUNT_ORDER: JudgmentStatus[] = ["delay_risk", "short", "needs_staff", "expected", "satisfied"];

type Props = {
  overview: OverviewResponse;
  records: AnswerRecord[];
  history: AnswerHistoryEntry[];
  onAnswer: (ambiguityId: string, optionId: string) => void;
  onClear: (ambiguityId: string) => void;
};

type ImpactProps = {
  impact: Impact;
  // 回答済みの読み方。回答できる画面では onAnswer を渡す
  chosen?: string | null;
  onAnswer?: (optionId: string) => void;
};

// 読み方ごとに、関わる判定の人数を並べる。回答できる画面では、読み方の行そのものが回答のボタンになる
export function ImpactCounts({ impact, chosen, onAnswer }: ImpactProps) {
  return (
    <>
      {!impact.computable && (
        <p className="notice">この候補はルールの差分で表せないため、人数は計算できません。</p>
      )}
      {impact.computable && !impact.judged && (
        <p className="notice">履修上限などに関わる確認事項です。人数のほか、履修案の検査の結果も変わります。</p>
      )}
      <p className="options-label">
        {onAnswer ? "読み方を選んで回答します" : "読み方"}
        {impact.computable && (
          <span className="muted counts-note">
            （回答で判定が変わる学生 {impact.affectedStudentIds.length}人、別途、職員確認の学生{" "}
            {impact.staffReviewStudentIds.length}人）
          </span>
        )}
      </p>
      <div className="options">
        {impact.options.map((option) => {
          const body = (
            <>
              <span className="option-label">{option.label}</span>
              <span className="option-action">
                {onAnswer ? "この読み方で回答 →" : chosen === option.id ? "回答済み" : ""}
              </span>
              {impact.computable && (
                <span className="option-counts">
                  {COUNT_ORDER.filter((status) => option.counts?.[status]).map((status) => (
                    <span key={status}>
                      <JudgmentBadge status={status} /> {option.counts?.[status]}人
                    </span>
                  ))}
                </span>
              )}
            </>
          );
          const state = chosen === undefined ? "" : chosen === option.id ? " chosen" : " dimmed";
          return onAnswer ? (
            <button key={option.id} type="button" className="option" onClick={() => onAnswer(option.id)}>
              {body}
            </button>
          ) : (
            <div key={option.id} className={`option${state}`}>
              {body}
            </div>
          );
        })}
      </div>
    </>
  );
}

export function ChangeList({ impact }: { impact: Impact }) {
  if (impact.changes.length === 0) return null;
  return (
    <details>
      <summary>判定が変わる学生を見る（{impact.changes.length}件）</summary>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>学生</th>
              <th>判定</th>
              {impact.options.map((option) => (
                <th key={option.id}>{option.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {impact.changes.map((change) => (
              <tr key={`${change.studentId}-${change.ruleId}`}>
                <td>{change.studentId}</td>
                <td>{change.name}</td>
                {impact.options.map((option) => (
                  <td key={option.id}>
                    {change.statuses[option.id] && <JudgmentBadge status={change.statuses[option.id]!} />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// 回答の経過（誰がいつどの読み方にし、いつ取り消したか）。記録は追記だけなので、すべて残っている
function AnswerHistory({ impact, history }: { impact: Impact; history: AnswerHistoryEntry[] }) {
  const entries = history.filter((entry) => entry.ambiguityId === impact.ambiguityId);
  if (entries.length === 0) return null;
  const label = (optionId: string | null) =>
    optionId === null ? "回答を取り消した" : `「${impact.options.find((o) => o.id === optionId)?.label ?? optionId}」に回答`;
  return (
    <details className="answer-history">
      <summary>回答の経過（{entries.length}件）</summary>
      <ul>
        {entries.map((entry, index) => (
          <li key={`${entry.answeredAt}-${index}`} className="muted">
            {new Date(entry.answeredAt).toLocaleString("ja-JP")} {entry.respondent}が{label(entry.optionId)}
          </li>
        ))}
      </ul>
    </details>
  );
}

function UnreflectedNote({ impact }: { impact: Impact }) {
  const labels = impact.options.filter(({ reflected }) => !reflected).map(({ label }) => `「${label}」`);
  if (labels.length === 0) return null;
  return (
    <p className="notice">
      {labels.join("、")}と答えても記録するだけで、判定には反映しません。関わる判定は職員確認のままです。
    </p>
  );
}

function QuestionHead({ impact, answered }: { impact: Impact; answered?: boolean }) {
  return (
    <>
      <div className="card-head">
        <p className="clause">{impact.clause}</p>
        {answered && <span className="badge badge-good">回答済み</span>}
      </div>
      <h3>{impact.question}</h3>
      <blockquote>{impact.sourceQuote}</blockquote>
    </>
  );
}

export function QuestionsPanel({ overview, records, history, onAnswer, onClear }: Props) {
  const { unanswered, answered } = overview;
  return (
    <section>
      <div className="section-head">
        <h2>未回答の確認事項（{unanswered.length}件）</h2>
      </div>
      <p className="lead">
        要項の読み方が分かれる箇所です。読み方ごとの人数を見比べて、大学としての読み方を選んでください。回答はすぐに全学生の判定に反映され、あとから取り消せます。
      </p>
      <details className="help">
        <summary>人数の見方</summary>
        <p>
          読み方ごとの人数は、判定の件数の内訳です。上の人数（声かけ・職員確認・対応なし）との関係は、延期見込みと最終年次の不足が声かけ、未回答で止まった判定が職員確認、それ以外が対応なしです。
        </p>
      </details>
      {unanswered.length === 0 && <p className="card muted">未回答の確認事項はありません。</p>}
      {unanswered.map((impact) => (
        <article className="card" key={impact.ambiguityId}>
          <QuestionHead impact={impact} />
          <ImpactCounts impact={impact} onAnswer={(optionId) => onAnswer(impact.ambiguityId, optionId)} />
          <UnreflectedNote impact={impact} />
          <div className="links-row">
            <ChangeList impact={impact} />
            <AnswerHistory impact={impact} history={history} />
          </div>
        </article>
      ))}

      {answered.length > 0 && (
        <div className="section-head">
          <h2>回答済み（{answered.length}件）</h2>
        </div>
      )}
      {answered.map((impact) => {
        const record = records.find((r) => r.ambiguityId === impact.ambiguityId);
        const option = impact.options.find((o) => o.id === impact.optionId);
        return (
          <article className="card" key={impact.ambiguityId}>
            <QuestionHead impact={impact} answered />
            <div className="actions">
              <span>
                回答: <strong>{option?.label}</strong>
                {record && (
                  <span className="muted counts-note">
                    （{record.respondent}、{new Date(record.answeredAt).toLocaleString("ja-JP")}）
                  </span>
                )}
              </span>
              <button type="button" className="secondary" onClick={() => onClear(impact.ambiguityId)}>
                回答を取り消す
              </button>
            </div>
            {option?.reflected === false && (
              <p className="notice">この回答は記録しましたが、判定には反映していません。関わる判定は職員確認のままです。</p>
            )}
            <ImpactCounts impact={impact} chosen={impact.optionId} />
            <div className="links-row">
              <ChangeList impact={impact} />
              <AnswerHistory impact={impact} history={history} />
            </div>
          </article>
        );
      })}
    </section>
  );
}
