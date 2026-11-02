import type { AnswerRecord, Impact, JudgmentStatus, OverviewResponse } from "../shared/api";
import { JudgmentBadge } from "./StatusBadge";

const COUNT_ORDER: JudgmentStatus[] = ["delay_risk", "short", "needs_staff", "expected", "satisfied"];

type Props = {
  overview: OverviewResponse;
  records: AnswerRecord[];
  onAnswer: (ambiguityId: string, optionId: string) => void;
  onClear: (ambiguityId: string) => void;
};

export function ImpactCounts({ impact }: { impact: Impact }) {
  if (!impact.computable) {
    return <p className="notice">この候補はルールの差分で表せないため、人数は計算できません。</p>;
  }
  return (
    <>
      {!impact.judged && (
        <p className="notice">履修上限などに関わる確認事項です。人数のほか、履修案の検査の結果も変わります。</p>
      )}
      <p className="counts">
        回答で判定が変わる学生 <strong>{impact.affectedStudentIds.length}人</strong>
        <span className="muted counts-note">
          別途、職員確認の学生 {impact.staffReviewStudentIds.length}人
        </span>
      </p>
      <table>
        <thead>
          <tr>
            <th>読み方</th>
            <th>関わる判定の人数</th>
          </tr>
        </thead>
        <tbody>
          {impact.options.map((option) => (
            <tr key={option.id}>
              <td>{option.label}</td>
              <td className="count-list">
                {COUNT_ORDER.filter((status) => option.counts?.[status]).map((status) => (
                  <span key={status}>
                    <JudgmentBadge status={status} /> {option.counts?.[status]}人
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function ChangeList({ impact }: { impact: Impact }) {
  if (impact.changes.length === 0) return null;
  return (
    <details>
      <summary>判定が変わる学生を見る</summary>
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
                  {change.statuses[option.id] && (
                    <JudgmentBadge status={change.statuses[option.id]!} />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function AnswerMeta({ record }: { record: AnswerRecord | undefined }) {
  if (!record) return null;
  const answeredAt = new Date(record.answeredAt).toLocaleString("ja-JP");
  return (
    <span className="muted counts-note">
      {record.respondent}、{answeredAt}
    </span>
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

export function QuestionsPanel({ overview, records, onAnswer, onClear }: Props) {
  const { unanswered, answered } = overview;
  return (
    <section>
      <h2>未回答の確認事項（{unanswered.length}件）</h2>
      <p className="muted">
        下の表の「関わる判定の人数」は判定の件数の内訳です。上の人数（声かけ・職員確認・対応なし）との関係は、延期見込みと最終年次の不足が声かけ、未回答で止まった判定が職員確認、それ以外が対応なしです。
      </p>
      {unanswered.length === 0 && <p className="muted">未回答の確認事項はありません。</p>}
      {unanswered.map((impact) => (
        <article className="card" key={impact.ambiguityId}>
          <p className="clause">{impact.clause}</p>
          <h3>{impact.question}</h3>
          <blockquote>{impact.sourceQuote}</blockquote>
          <ImpactCounts impact={impact} />
          <UnreflectedNote impact={impact} />
          <div className="actions">
            {impact.options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => onAnswer(impact.ambiguityId, option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <ChangeList impact={impact} />
        </article>
      ))}

      {answered.length > 0 && <h2>回答済み（{answered.length}件）</h2>}
      {answered.map((impact) => (
        <article className="card" key={impact.ambiguityId}>
          <p className="clause">{impact.clause}</p>
          <h3>{impact.question}</h3>
          <blockquote>{impact.sourceQuote}</blockquote>
          <p>
            回答: <strong>{impact.options.find((o) => o.id === impact.optionId)?.label}</strong>
            <AnswerMeta record={records.find((r) => r.ambiguityId === impact.ambiguityId)} />
          </p>
          {impact.options.find((o) => o.id === impact.optionId)?.reflected === false && (
            <p className="notice">この回答は記録しましたが、判定には反映していません。関わる判定は職員確認のままです。</p>
          )}
          <ImpactCounts impact={impact} />
          <div className="actions">
            <button type="button" className="secondary" onClick={() => onClear(impact.ambiguityId)}>
              回答を取り消す
            </button>
          </div>
          <ChangeList impact={impact} />
        </article>
      ))}
    </section>
  );
}
