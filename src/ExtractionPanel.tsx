import { retakeNotice } from "./retakeNotice";
import { useEffect, useRef, useState } from "react";
import type { Ambiguity } from "../engine/rules";
import {
  MAX_HANDBOOK_LENGTH,
  type DatasetsResponse,
  type ProposalResponse,
  type Respondent,
  type SourcesResponse,
  type VersionCompareResponse,
} from "../shared/api";
import {
  confirmProposal,
  extractProposal,
  fetchLatestProposal,
  fetchSources,
  fetchVersionCompare,
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

// 要項の版の比較。同じ大学の一つ前の確定版と、この案のルールの差分（H25 の G）
function VersionDiff({ proposalId }: { proposalId: number | null }) {
  const [compare, setCompare] = useState<VersionCompareResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    // 別の案に替わったら、前の案の比較を残さない（追加の監査 R-14）
    setCompare(null);
    setError(null);
    if (proposalId === null) return;
    let active = true;
    fetchVersionCompare(proposalId)
      .then((result) => {
        if (active) setCompare(result);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "取得に失敗しました。");
      });
    return () => {
      active = false;
    };
  }, [proposalId]);

  if (error) return <p className="notice">前の確定版と比べられませんでした: {error}</p>;
  if (!compare) return null;
  const { base, diff } = compare;
  if (!base || !diff) return <p className="muted">この大学に確定した前の版はないので、版の比較はありません。</p>;
  const count =
    diff.changed.length + diff.removed.length + diff.added.length + diff.ambiguitiesRemoved.length + diff.ambiguitiesAdded.length;
  return (
    <>
      <h3>
        前の確定版（第{base.version}版）との違い（{count}件）
      </h3>
      <p className="muted">
        {base.respondent}が {new Date(base.confirmedAt).toLocaleString("ja-JP")} に確定した版と、ルールを比べました。曖昧箇所は ID が同じものを同じとみなします。
      </p>
      {count === 0 && <p className="muted">ルールの違いはありません。</p>}
      {diff.changed.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>項目</th>
                <th>内容</th>
                <th>第{base.version}版</th>
                <th>この案</th>
              </tr>
            </thead>
            <tbody>
              {diff.changed.map(({ item, field, before, after }) => (
                <tr key={`${item}-${field}`}>
                  <td>{item}</td>
                  <td>{fieldLabel(field)}</td>
                  <td>{before}</td>
                  <td>{after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {diff.removed.length > 0 && <p>この案でなくなったルール: {diff.removed.join("、")}</p>}
      {diff.added.length > 0 && <p>この案で増えたルール: {diff.added.join("、")}</p>}
      {diff.ambiguitiesRemoved.length > 0 && (
        <p>
          この案でなくなった確認事項:{" "}
          {diff.ambiguitiesRemoved.map(({ clause, question }) => `${clause}「${question}」`).join("、")}
        </p>
      )}
      {diff.ambiguitiesAdded.length > 0 && (
        <p>
          この案で増えた確認事項:{" "}
          {diff.ambiguitiesAdded.map(({ clause, question }) => `${clause}「${question}」`).join("、")}
        </p>
      )}
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
      // 確定の一覧を読み直すまで押せないままにする。二重に確定しない（追加の監査 R-14）
      onConfirmed(datasetId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "確定できませんでした。");
      setSaving(false);
    }
  }

  // 確定や取り消しが一覧に反映されたら、また押せるようにする
  useEffect(() => {
    setSaving(false);
  }, [confirmedDatasetId]);

  if (confirmedDatasetId) {
    return (
      <div className="card confirm-box" id="confirm-proposal">
        <h3>職員の確定</h3>
        <p className="muted">この案は確定済みです。</p>
        <div className="actions">
          <button type="button" className="secondary" onClick={() => onConfirmed(confirmedDatasetId)}>
            判定を見る
          </button>
        </div>
      </div>
    );
  }

  const notice = retakeNotice(proposal.rules);
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
    <div className="card confirm-box" id="confirm-proposal">
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
      {notice && <p className="notice" data-testid="retake-notice">{notice}</p>}
      {blocked && <p className="notice">{blocked}</p>}
      <div className="actions">
        <button type="button" disabled={blocked !== null || saving} onClick={() => void confirm()}>
          このルール案を確定する
        </button>
      </div>
      {error && <pre role="alert" className="error">{error}</pre>}
    </div>
  );
}

type Tone = "good" | "bad" | "warn" | "neutral";

function Stat({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <div className={`stat tone-${tone}`}>
      <p className="muted">{label}</p>
      <p className="stat-value">{value}</p>
    </div>
  );
}

// 案の全体を先に示す。数字の意味は下の各節にある
function ProposalStats({ proposal, rows }: { proposal: ProposalResponse; rows: RuleRow[] }) {
  const { caseResults, rules, notes, problems, runs } = proposal;
  const passed = caseResults.filter(({ outcome }) => outcome === "passed").length;
  const failed = caseResults.filter(({ outcome }) => outcome === "failed").length;
  return (
    <div className="stats">
      <Stat label="ルール" value={`${rows.length}件`} tone="neutral" />
      <Stat
        label="変換の成功"
        value={`${runs.succeeded}/${runs.requested}回`}
        tone={runs.succeeded === runs.requested ? "good" : "warn"}
      />
      <Stat
        label="検査用ケースの通過"
        value={`${passed}/${caseResults.length}件`}
        tone={failed > 0 ? "bad" : caseResults.length === 0 ? "neutral" : passed === caseResults.length ? "good" : "warn"}
      />
      <Stat
        label="職員に確認する箇所"
        value={`${rules.ambiguities.length}件`}
        tone={rules.ambiguities.length > 0 ? "warn" : "neutral"}
      />
      <Stat label="反映できなかった箇所" value={`${notes.length}件`} tone={notes.length > 0 ? "warn" : "neutral"} />
      {problems.length > 0 && <Stat label="検査で残った問題" value={`${problems.length}件`} tone="bad" />}
    </div>
  );
}

type ProposalProps = Omit<ConfirmProps, "rows">;

function Proposal({ proposal, respondent, confirmedDatasetId, onConfirmed }: ProposalProps) {
  const { rules, notes, problems, attempts, extraQuestions, caseResults, recording } = proposal;
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
      <ProposalStats proposal={proposal} rows={rows} />
      <div className="actions">
        <span className="muted">
          修正を含む呼び出し {attempts.length}回（モデル {attempts.at(-1)?.model}）
        </span>
        <button
          type="button"
          className="secondary"
          onClick={() => document.getElementById("confirm-proposal")?.scrollIntoView({ behavior: "smooth" })}
        >
          確定の欄へ移る
        </button>
      </div>
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
      <VersionDiff proposalId={proposal.proposalId} />
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
  const [loadingRecord, setLoadingRecord] = useState(false);
  // 大学を変えたあとに届いた案を、今の大学の案として見せない。保存はされているので、戻れば開ける（追加の監査 R-12）
  const latestRequest = useRef(0);

  useEffect(() => {
    fetchSources()
      .then(setData)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "取得に失敗しました。");
      });
  }, []);

  // 費用をかけて作った案を、画面を開き直しても確認できるようにする。
  useEffect(() => {
    latestRequest.current += 1;
    setRunning(false);
    setLoadingRecord(false);
    setError(null);
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
    const request = ++latestRequest.current;
    setRunning(true);
    setError(null);
    setProposal(null);
    try {
      const created = await extractProposal(sourceId, handbook);
      if (request === latestRequest.current) setProposal(created);
    } catch (cause) {
      if (request === latestRequest.current) setError(cause instanceof Error ? cause.message : "変換に失敗しました。");
    } finally {
      if (request === latestRequest.current) setRunning(false);
    }
  }

  async function loadRecorded() {
    if (!sourceId) return;
    const request = ++latestRequest.current;
    setLoadingRecord(true);
    setError(null);
    try {
      const loaded = await loadRecordedProposal(sourceId);
      if (request === latestRequest.current) setProposal(loaded);
    } catch (cause) {
      if (request === latestRequest.current) setError(cause instanceof Error ? cause.message : "記録を読み込めませんでした。");
    } finally {
      if (request === latestRequest.current) setLoadingRecord(false);
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
      <p className="lead">
        要項の文章から、Claude が根拠の条文つきのルール案と、読み方が分かれる箇所の質問を作ります。案はコードで検査し、職員が確定するまで判定に使いません。
      </p>
      <div className="card extract-form">
        <p>対象の大学: {selected?.name}（上の「対象」で変えられます）</p>
        <label>
          要項の文章
          <textarea
            rows={8}
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
            <button type="button" className="secondary" disabled={running || loadingRecord} onClick={() => void loadRecorded()}>
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
