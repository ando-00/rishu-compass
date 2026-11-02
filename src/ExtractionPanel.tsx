import { useEffect, useState } from "react";
import type { Ambiguity } from "../engine/rules";
import { MAX_HANDBOOK_LENGTH, type ProposalResponse, type SourcesResponse } from "../shared/api";
import { extractProposal, fetchSources } from "./api";
import { ChangeList, ImpactCounts } from "./QuestionsPanel";
import { summarizeRules, type RuleRow } from "./ruleSummary";
import { ReviewBadge } from "./StatusBadge";

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

function Proposal({ proposal }: { proposal: ProposalResponse }) {
  const { rules, notes, problems, attempts } = proposal;
  const rows = summarizeRules(rules);
  return (
    <section>
      <h2>ルール案</h2>
      <p className="notice">
        この案はまだ判定に使いません。根拠の文が要項にあることは検査しましたが、解釈が正しいことは保証しません。
      </p>
      <p className="muted">
        ルール {rows.length}件、変換 {attempts.length}回（モデル {attempts.at(-1)?.model}）
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
      <Questions ambiguities={rules.ambiguities} proposal={proposal} />
      <h3>ルールの一覧</h3>
      <RuleTable rows={rows} />
      {notes.length > 0 && (
        <>
          <h3>ルールにしなかった箇所（{notes.length}件）</h3>
          {notes.map((note) => (
            <article className="card" key={`${note.clause}-${note.sourceQuote}`}>
              <p className="clause">{note.clause}</p>
              <blockquote>{note.sourceQuote}</blockquote>
              <p>{note.reason}</p>
            </article>
          ))}
        </>
      )}
    </section>
  );
}

export function ExtractionPanel() {
  const [data, setData] = useState<SourcesResponse | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [handbook, setHandbook] = useState("");
  const [running, setRunning] = useState(false);
  const [proposal, setProposal] = useState<ProposalResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSources()
      .then((result) => {
        setData(result);
        setSourceId(result.sources[0]?.id ?? "");
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "取得に失敗しました。");
      });
  }, []);

  async function run() {
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

  const sample = data?.sources.find(({ id }) => id === sourceId)?.handbook ?? "";
  const tooLong = handbook.length > MAX_HANDBOOK_LENGTH;
  const canRun = Boolean(data?.extractionEnabled) && handbook.trim() !== "" && !tooLong && !running;

  return (
    <section>
      <h2>要項の取り込み</h2>
      {data && !data.extractionEnabled && (
        <p className="notice">この環境では要項の変換を使えません。</p>
      )}
      <div className="extract-form">
        <label>
          対象の大学
          <select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
            {data?.sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        </label>
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
        </div>
      </div>
      {running && <p role="status">変換しています。数分かかることがあります。</p>}
      {error && <pre role="alert" className="error">{error}</pre>}
      {proposal && <Proposal proposal={proposal} />}
    </section>
  );
}
