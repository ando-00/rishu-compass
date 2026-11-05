import { useState } from "react";
import type {
  AnswerHistoryEntry,
  AnswerRecord,
  Impact,
  JudgmentStatus,
  OverviewResponse,
  PreviousAnswer,
} from "../shared/api";
import { buildMeetingSheet, countedCaption, countedStatuses } from "./meetingSheet";
import { MeetingSheetView } from "./MeetingSheetView";
import { JudgmentBadge, judgmentLabel } from "./StatusBadge";

type Props = {
  overview: OverviewResponse;
  datasetName: string;
  records: AnswerRecord[];
  history: AnswerHistoryEntry[];
  // 同じ大学の前の版で、同じ ID の曖昧箇所にした回答。参考に見せるだけで反映しない
  previousAnswers: PreviousAnswer[];
  onAnswer: (ambiguityId: string, optionId: string) => void;
  onClear: (ambiguityId: string) => void;
};

type ImpactProps = {
  impact: Impact;
  // 回答済みの読み方。回答できる画面では onAnswer を渡す
  chosen?: string | null;
  onAnswer?: (optionId: string) => void;
};

// 読み方を行、判定を列にした表で人数を見比べる。読み方によって人数が違う欄を太字にする
export function ImpactCounts({ impact, chosen, onAnswer }: ImpactProps) {
  const statuses = impact.computable ? countedStatuses(impact.options) : [];
  const differs = (status: JudgmentStatus) =>
    new Set(impact.options.map((option) => option.counts?.[status] ?? 0)).size > 1;
  return (
    <>
      {!impact.computable && (
        <p className="notice">この候補はルールの差分で表せないため、人数は計算できません。</p>
      )}
      {impact.computable && !impact.judged && (
        <p className="notice">履修上限などに関わる確認事項です。人数のほか、履修案の検査の結果も変わります。</p>
      )}
      <div className="table-scroll">
        <table className="options-table">
          <thead>
            <tr>
              <th>読み方</th>
              {statuses.map((status) => (
                <th key={status} className="num">
                  <JudgmentBadge status={status} />
                </th>
              ))}
              {(onAnswer || chosen !== undefined) && <th />}
            </tr>
          </thead>
          <tbody>
            {impact.options.map((option) => (
              <tr
                key={option.id}
                className={chosen === undefined ? undefined : chosen === option.id ? "chosen" : "dimmed"}
              >
                <td className="option-label">{option.label}</td>
                {statuses.map((status) => (
                  <td
                    key={status}
                    className={differs(status) ? "num differs" : "num"}
                    data-label={judgmentLabel(status)}
                  >
                    {option.counts?.[status] ?? 0}人
                  </td>
                ))}
                {onAnswer && (
                  <td className="option-action">
                    <button
                      type="button"
                      className="secondary"
                      aria-label={`「${option.label}」で回答する`}
                      onClick={() => onAnswer(option.id)}
                    >
                      この読み方で回答
                    </button>
                  </td>
                )}
                {!onAnswer && chosen !== undefined && (
                  <td className="option-action">{chosen === option.id && <span className="badge badge-good">回答</span>}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {impact.computable && (
        <p className="muted counts-note">
          {countedCaption(impact.countedRuleNames)}回答で判定が変わる学生は {impact.affectedStudentIds.length}
          人、ほかに職員確認の学生が {impact.staffReviewStudentIds.length}人います。
        </p>
      )}
    </>
  );
}

export function ChangeList({ impact }: { impact: Impact }) {
  if (impact.changes.length === 0) return null;
  return (
    <details>
      <summary>
        判定が変わる学生を見る（{new Set(impact.changes.map(({ studentId }) => studentId)).size}人、判定{" "}
        {impact.changes.length}件）
      </summary>
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

// 前の版の回答。曖昧箇所の ID が同じものだけを出し、この版には反映しない（H25）
function PreviousAnswers({ impact, previousAnswers }: { impact: Impact; previousAnswers: PreviousAnswer[] }) {
  const entries = previousAnswers.filter((entry) => entry.ambiguityId === impact.ambiguityId);
  if (entries.length === 0) return null;
  return (
    <div className="previous-answers">
      <p className="muted">前の版の回答（参考。この版には反映していません）</p>
      <ul>
        {entries.map((entry) => (
          <li key={entry.version}>
            第{entry.version}版で「{entry.optionLabel}」（{entry.respondent}、
            {new Date(entry.answeredAt).toLocaleString("ja-JP")}）
          </li>
        ))}
      </ul>
    </div>
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
      <p className="clause">
        {impact.clause}
        {answered && <span className="badge badge-good">回答済み</span>}
      </p>
      <h3>{impact.question}</h3>
      <blockquote>{impact.sourceQuote}</blockquote>
    </>
  );
}

export function QuestionsPanel({ overview, datasetName, records, history, previousAnswers, onAnswer, onClear }: Props) {
  const { unanswered, answered } = overview;
  const [sheetOpen, setSheetOpen] = useState(false);
  if (sheetOpen) {
    return (
      <section>
        <MeetingSheetView
          sheet={buildMeetingSheet(overview)}
          datasetName={datasetName}
          onClose={() => setSheetOpen(false)}
        />
      </section>
    );
  }
  return (
    <section>
      <div className="section-head">
        <h2>未回答の確認事項（{unanswered.length}件）</h2>
        {unanswered.length > 0 && (
          <button type="button" className="secondary" onClick={() => setSheetOpen(true)}>
            会議資料を開く
          </button>
        )}
      </div>
      <p className="lead">要項の読み方が分かれる箇所です。選んだ読み方は全学生の判定にすぐ反映され、あとから取り消せます。</p>
      <details className="help">
        <summary>人数の見方</summary>
        <p>
          表の人数は、表の下に書いた判定で、学生1人を1回ずつ数えたものです。その判定から先の卒業要件などの変わり方は「判定が変わる学生を見る」に出ます。上の人数（声かけ・職員確認・対応なし）は、学生の全判定から決めています。延期見込みと最終年次の不足が声かけ、未回答で止まった判定が職員確認、それ以外が対応なしです。「見込み」は履修中の科目を修得すれば満たす判定、「遅れ」は判定の時点に満たさず、次の年度以降に認める判定です（認める年次は理由に出ます）。
        </p>
      </details>
      {unanswered.length === 0 && <p className="card muted">未回答の確認事項はありません。</p>}
      {unanswered.map((impact) => (
        <article className="card" key={impact.ambiguityId}>
          <QuestionHead impact={impact} />
          <PreviousAnswers impact={impact} previousAnswers={previousAnswers} />
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
