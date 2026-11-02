// evals/results/extract/ の最新の変換の記録から、API キーなしで読み込める案を作る。
// 使い方: npm run record:proposal -- sakuradai kamome
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { storedProposalSchema } from "../shared/api";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RESULTS = join(ROOT, "evals", "results", "extract");

function latestRecord(id: string) {
  const name = readdirSync(RESULTS)
    .filter((file) => file.startsWith(`${id}-`) && file.endsWith(".json"))
    .sort()
    .at(-1);
  if (!name) throw new Error(`変換の記録がありません: ${id}`);
  return { name, record: JSON.parse(readFileSync(join(RESULTS, name), "utf8")) as Record<string, unknown> };
}

function recordedAt(name: string) {
  const match = /-(\d{4})(\d{2})(\d{2})-\d{6}\.json$/.exec(name);
  if (!match) throw new Error(`ファイル名から日付を読めません: ${name}`);
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function record(id: string) {
  const { name, record: result } = latestRecord(id);
  if (result.outcome !== "ok") throw new Error(`${name}: 変換に失敗した記録です`);

  const proposal = storedProposalSchema.parse(result);
  if (proposal.problems.length > 0) throw new Error(`${name}: 検査の問題が残っています`);
  const failed = proposal.caseResults.filter(({ outcome }) => outcome === "failed");
  if (failed.length > 0) throw new Error(`${name}: 検査用ケースが ${failed.length}件一致しません`);

  const model = proposal.attempts.at(-1)?.model;
  if (!model) throw new Error(`${name}: 呼び出しの記録がありません`);
  const recording = { model, recordedAt: recordedAt(name) };
  const path = join(ROOT, "data", "fictional", id, "recorded-proposal.json");
  writeFileSync(path, `${JSON.stringify({ ...proposal, recording }, null, 2)}\n`);
  console.log(`${id}: ${name} から作成しました`);
}

const ids = process.argv.slice(2);
if (ids.length === 0) throw new Error("対象を指定してください: sakuradai kamome");
for (const id of ids) record(id);
