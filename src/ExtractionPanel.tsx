import { useEffect, useState } from "react";
import type { Ambiguity } from "../engine/rules";
import {
  MAX_HANDBOOK_LENGTH,
  type DatasetsResponse,
  type ProposalResponse,
  type Respondent,
  type SourcesResponse,
} from "../shared/api";
import {
  confirmProposal,
  extractProposal,
  fetchLatestProposal,
  fetchSources,
  loadRecordedProposal,
} from "./api";
import { ChangeList, ImpactCounts } from "./QuestionsPanel";
import { fieldLabel, summarizeRules, type RuleRow } from "./ruleSummary";
import { CaseBadge, ReviewBadge } from "./StatusBadge";

function Questions({ ambiguities, proposal }: { ambiguities: Ambiguity[]; proposal: ProposalResponse }) {
  return (
    <>
      <h3>職員に確認する箇所（{ambiguities.length}件）</h3>
      {ambiguities.length === 0 && (
        <p className="muted">読み方が分かれる箇所は見つかりませんでした。見逃しがないとは言えません。</p>
      )}
      {ambiguities.map((ambiguity) => {
        const impact = proposal.impacts?.find(({ ambiguityId }) => ambiguityId === ambiguity.id);
        return (
          <article className="card" key={ambiguity.id}>
            <p className="clause">{ambiguity.clause}</p>
            <h3>{ambiguity.question}</h3>
            <blockquote>{ambiguity.sourceQuote}</blockquote>
            {impact ? (
              <>
                <ImpactCounts impact={impact} />
                <ChangeList impact={impact} />
              </>
            ) : (
              <>
                <ul>
                  {ambiguity.options.map((option) => (
                    <li key={option.id}>{option.label}</li>
                  ))}
                </ul>
                <p className="notice">検査の問題が残っているため、人数を計算していません。</p>
              </>
            )}
          </article>
        );
      })}
    </>
  );
}

function RuleTable({ rows }: { rows: RuleRow[] }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>条文</th>
            <th>ルール案</th>
            <th>根拠の文</th>
            <th>状態</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="nowrap">{row.clause}</td>
              <td>{row.summary}</td>
              <td className="muted">{row.sourceQuote}</td>
              <td>
                <ReviewBadge review={row.review} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Disagreements({ proposal }: { proposal: ProposalResponse }) {
  const { disagreements, runs } = proposal;
  if (runs.succeeded < 2) {
    return <p className="notice">変換が {runs.succeeded}回しか成功しなかったため、回ごとの比較はできません。</p>;
  }
  if (disagreements.length === 0) {
    return (
      <p className="muted">
        {runs.succeeded}回の変換で項目は割れませんでした。同じ誤りが毎回出た場合は、ここでは見つかりません。
      </p>
    );
  }
  return (
    <>
      <h3>変換の回によって割れた項目（{disagreements.length}件）</h3>
      <p className="muted">
        採用した案にあるルールは要確認にしてあります。「採用した案」が「なし」の項目は、確定しても判定に入りません。要項を見て確かめてください。
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>項目</th>
              <th>内容</th>
              {disagreements[0]?.values.map((_, index) => (
                <th key={index}>{index === 0 ? "採用した案" : `他の案${index}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {disagreements.map(({ item, field, values }) => (
              <tr key={`${item}-${field}`}>
                <td>{item}</td>
                <td>{fieldLabel(field)}</td>
                {values.map((value, index) => (
                  <td key={index}>{value}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ExtraQuestions({ questions }: { questions: ProposalResponse["extraQuestions"] }) {
  if (questions.length === 0) return null;
  return (
    <>
      <h3>判定に結びつけられなかった質問（{questions.length}件）</h3>
      <p className="notice">他の回が見つけた質問です。採用した案のルールに対応づけられず、回答を判定に反映できないので、この案は確定できません。要項を変換し直してください。</p>
      {questions.map(({ clause, sourceQuote, question, options }) => (
        <article className="card" key={sourceQuote}>
          <p className="clause">{clause}</p>
          <h3>{question}</h3>
          <blockquote>{sourceQuote}</blockquote>
          <ul>
            {options.map((option) => (
              <li key={option}>{option}</li>
            ))}
          </ul>
        </article>
      ))}
    </>
  );
}

function CaseResults({ results }: { results: ProposalResponse["caseResults"] }) {
  if (results.length === 0) return null;
  const pending = results.filter(({ outcome }) => outcome === "pending").length;
  return (
    <>
      <h3>検査用ケースの結果（{results.length}件）</h3>
      {pending > 0 && (
        <p className="muted">保留 {pending}件は、未確定のルールで判定が止まっている状態で、誤りではありません。</p>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th className="nowrap">ケース</th>
              <th>内容</th>
              <th>期待</th>
              <th>結果</th>
              <th>状態</th>
            </tr>
          </thead>
          <tbody>
            {results.map(({ id, title, expected, actual, outcome }) => (
              <tr key={id}>
                <td className="nowrap">{id}</td>
                <td>{title}</td>
                <td>{expected}</td>
                <td>{actual}</td>
                <td>
                  <CaseBadge outcome={outcome} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

type ConfirmProps = {
  proposal: ProposalResponse;
  rows: RuleRow[];
  respondent: Respondent;
  confirmedDatasetId: string | undefined;
  onConfirmed: (datasetId: string) => void;
};

function ConfirmSection({ proposal, rows, respondent, confirmedDatasetId, onConfirmed }: ConfirmProps) {
  const [accepted, setAccepted] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { proposalId, problems, caseResults } = proposal;
  const reviewRows = rows.filter(({ review }) => review === "needs_review");
  const failed = caseResults.filter(({ outcome }) => outcome === "failed").length;

  function toggle(id: string, checked: boolean) {
    setAccepted((current) => (checked ? [...current, id] : current.filter((value) => value !== id)));
  }

  async function confirm() {
    if (proposalId === null) return;
    setSaving(true);
    setError(null);
    try {
      const { datasetId } = await confirmProposal(proposalId, { respondent, acceptedRuleIds: accepted });
      onConfirmed(datasetId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "確定できませんでした。");
    } finally {
      setSaving(false);
    }
  }

  if (confirmedDatasetId) {
    return (
      <>
        <h3>職員の確定</h3>
        <p className="muted">この案は確定済みです。</p>
        <div className="actions">
          <button type="button" className="secondary" onClick={() => onConfirmed(confirmedDatasetId)}>
            判定を見る
          </button>
        </div>
      </>
    );
  }

  const blocked =
    proposalId === null
      ? "この案は保存できなかったので確定できません。"
      : problems.length > 0
        ? "検査の問題が残っているので確定できません。"
        : proposal.extraQuestions.length > 0
          ? "判定に結びつけられない質問が残っているので確定できません。"
        : failed > 0
          ? `検査用ケースが ${failed}件一致しないので確定できません。`
          : null;

  return (
    <>
      <h3>職員の確定</h3>
      <p className="muted">
        確定すると、このルールを新しい版として全学生を判定します。前の版の回答は引き継ぎません。確定者として {respondent} を記録します。
      </p>
      {reviewRows.length > 0 && (
        <>
          <p>
            要確認のルールが {reviewRows.length}件あります。要項と照らして認めたものだけ選んでください。
            認めないルールは、確定後も職員確認のままです。
          </p>
          {reviewRows.map(({ id, clause, summary }) => (
            <label className="check-row" key={id}>
              <input
                type="checkbox"
                checked={accepted.includes(id)}
                onChange={(event) => toggle(id, event.target.checked)}
              />
              <span>
                {clause}: {summary}
              </span>
            </label>
          ))}
        </>
      )}
      {blocked && <p className="notice">{blocked}</p>}
      <div className="actions">
        <button type="button" disabled={blocked !== null || saving} onClick={() => void confirm()}>
          このルール案を確定する
        </button>
      </div>
      {error && <pre role="alert" className="error">{error}</pre>}
    </>
  );
}

type ProposalProps = Omit<ConfirmProps, "rows">;

function Proposal({ proposal, respondent, confirmedDatasetId, onConfirmed }: ProposalProps) {
  const { rules, notes, problems, attempts, runs, extraQuestions, caseResults, recording } = proposal;
  const rows = summarizeRules(rules);
  return (
    <section>
      <h2>ルール案</h2>
      <p className="notice">
        職員が確定するまで、この案は判定に使いません。根拠の文が要項にあることは検査しましたが、解釈が正しいことは保証しません。
      </p>
      {recording && (
        <p className="notice">
          {recording.recordedAt} に {recording.model} で変換した記録を読み込みました。今回は Claude を呼んでいません。
        </p>
      )}
      <p className="muted">
        ルール {rows.length}件、変換 {runs.succeeded}/{runs.requested}回成功、修正を含む呼び出し {attempts.length}回（モデル {attempts.at(-1)?.model}）
      </p>
      {problems.length > 0 && (
        <div className="notice" role="alert">
          <p>検査で残った問題が {problems.length}件あります。</p>
          <ul>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}
      {proposal.strayCourses.length > 0 && (
        <div className="notice" role="status">
          <p>
            どの区分にも入らない科目が {proposal.strayCourses.length}件あります。確定はできますが、これらを修得した学生の卒業要件は職員確認になります。
          </p>
          <p className="muted">{proposal.strayCourses.join("、")}</p>
        </div>
      )}
      <CaseResults results={caseResults} />
      <Disagreements proposal={proposal} />
      <Questions ambiguities={rules.ambiguities} proposal={proposal} />
      <ExtraQuestions questions={extraQuestions} />
      <h3>ルールの一覧</h3>
      <RuleTable rows={rows} />
      {notes.length > 0 && (
        <>
          <h3>ルールへ反映できなかった箇所（{notes.length}件）</h3>
          {notes.map((note) => (
            <article className="card" key={`${note.clause}-${note.sourceQuote}`}>
              <p className="clause">{note.clause}</p>
              <blockquote>{note.sourceQuote}</blockquote>
              <p>{note.reason}</p>
            </article>
          ))}
        </>
      )}
      <ConfirmSection
        key={proposal.proposalId}
        proposal={proposal}
        rows={rows}
        respondent={respondent}
        confirmedDatasetId={confirmedDatasetId}
        onConfirmed={onConfirmed}
      />
    </section>
  );
}

type PanelProps = {
  datasets: DatasetsResponse["datasets"];
  // 上の「対象」の大学。大学の指定を1か所にする
  sourceId: string | undefined;
  respondent: Respondent;
  onConfirmed: (datasetId: string) => void;
};

export function ExtractionPanel({ datasets, sourceId, respondent, onConfirmed }: PanelProps) {
  const [data, setData] = useState<SourcesResponse | null>(null);
  const [handbook, setHandbook] = useState("");
  const [running, setRunning] = useState(false);
  const [proposal, setProposal] = useState<ProposalResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSources()
      .then(setData)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "取得に失敗しました。");
      });
  }, []);

  // 費用をかけて作った案を、画面を開き直しても確認できるようにする。
  useEffect(() => {
    setProposal(null);
    setHandbook("");
    if (!sourceId) return;
    let active = true;
    fetchLatestProposal(sourceId)
      .then((result) => {
        if (active) setProposal(result.proposal);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "取得に失敗しました。");
      });
    return () => {
      active = false;
    };
  }, [sourceId]);

  async function run() {
    if (!sourceId) return;
    setRunning(true);
    setError(null);
    setProposal(null);
    try {
      setProposal(await extractProposal(sourceId, handbook));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "変換に失敗しました。");
    } finally {
      setRunning(false);
    }
  }

  async function loadRecorded() {
    if (!sourceId) return;
    setError(null);
    try {
      setProposal(await loadRecordedProposal(sourceId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "記録を読み込めませんでした。");
    }
  }

  const confirmedDatasetId = datasets.find(
    ({ confirmation }) => confirmation && confirmation.proposalId === proposal?.proposalId,
  )?.id;
  const selected = data?.sources.find(({ id }) => id === sourceId);
  if (data && !selected) {
    return (
      <section>
        <h2>要項の取り込み</h2>
        <p className="notice">この対象には要項がありません。上の「対象」で大学を選んでください。</p>
      </section>
    );
  }

  const sample = selected?.handbook ?? "";
  const tooLong = handbook.length > MAX_HANDBOOK_LENGTH;
  const canRun = Boolean(data?.extractionEnabled) && handbook.trim() !== "" && !tooLong && !running;

  return (
    <section>
      <h2>要項の取り込み</h2>
      {data && !data.extractionEnabled && (
        <p className="notice">
          この環境では要項の変換を使えません。「記録を読み込む」を押すと、実際の変換の記録で確定から判定までを試せます。
        </p>
      )}
      <div className="extract-form">
        <p>対象の大学: {selected?.name}（上の「対象」で変えられます）</p>
        <label>
          要項の文章
          <textarea
            rows={12}
            value={handbook}
            onChange={(event) => setHandbook(event.target.value)}
          />
        </label>
        {tooLong && <p className="notice">要項は {MAX_HANDBOOK_LENGTH} 文字までです。</p>}
        <div className="actions">
          <button type="button" className="secondary" onClick={() => setHandbook(sample)}>
            この大学の要項を入れる
          </button>
          <button type="button" disabled={!canRun} onClick={() => void run()}>
            ルール案を作る
          </button>
          {selected?.recorded && (
            <button type="button" className="secondary" disabled={running} onClick={() => void loadRecorded()}>
              記録を読み込む
            </button>
          )}
        </div>
      </div>
      {running && <p role="status">同じ要項を3回変換して比べています。数分かかることがあります。</p>}
      {error && <pre role="alert" className="error">{error}</pre>}
      {proposal && (
        <Proposal
          proposal={proposal}
          respondent={respondent}
          confirmedDatasetId={confirmedDatasetId}
          onConfirmed={onConfirmed}
        />
      )}
    </section>
  );
}
