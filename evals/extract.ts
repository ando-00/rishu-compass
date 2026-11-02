// 実際に Claude を呼び、要項からルール案を作って結果を evals/results/extract/ に保存する。
// 使い方: npm run eval:extract -- sakuradai kamome
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { kamomeCourses } from "../data/fictional/kamome/courses";
import { kamomeStudents } from "../data/fictional/kamome/students";
import { sakuradaiCourses } from "../data/fictional/sakuradai/courses";
import { sakuradaiStudents } from "../data/fictional/sakuradai/students";
import { ADMISSION_YEARS } from "../data/fictional/students";
import { computeImpacts, type Course, type RuleSet, type Student } from "../engine";
import { createClaudeModel, MODEL_ID } from "../worker/rule-extraction/claude";
import { extractRules, type Attempt } from "../worker/rule-extraction/extract";
import { compareRules } from "./compare";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const SOURCES: Record<string, { name: string; courses: Course[]; students: Student[] }> = {
  sakuradai: { name: "さくら台大学（架空）", courses: sakuradaiCourses, students: sakuradaiStudents },
  kamome: { name: "かもめ大学（架空）", courses: kamomeCourses, students: kamomeStudents },
};

// Opus 5.5 の 100万トークンあたりの価格（ドル）
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

function readApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const vars = readFileSync(join(ROOT, ".dev.vars"), "utf8");
  const key = /^ANTHROPIC_API_KEY=(.+)$/m.exec(vars)?.[1]?.trim();
  if (!key) throw new Error(".dev.vars に ANTHROPIC_API_KEY がありません");
  return key;
}

function costOf(attempts: Attempt[]) {
  const cost = attempts.reduce(
    (sum, { usage }) =>
      sum +
      (usage.inputTokens * PRICE.input +
        usage.outputTokens * PRICE.output +
        usage.cacheReadTokens * PRICE.cacheRead +
        usage.cacheWriteTokens * PRICE.cacheWrite) /
        1_000_000,
    0,
  );
  return Math.round(cost * 10000) / 10000;
}

async function loadGold(id: string): Promise<RuleSet | null> {
  const path = join(ROOT, "data", "fictional", id, "gold-rules.ts");
  if (!existsSync(path)) return null;
  const module = (await import(`../data/fictional/${id}/gold-rules.ts`)) as { goldRules: RuleSet };
  return module.goldRules;
}

function stamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join("");
  const time = [pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join("");
  return `${date}-${time}`;
}

async function run(id: string, apiKey: string) {
  const source = SOURCES[id];
  if (!source) throw new Error(`対象がありません: ${id}`);
  const input = {
    ...source,
    id,
    admissionYears: ADMISSION_YEARS,
    handbook: readFileSync(join(ROOT, "data", "fictional", id, "handbook.md"), "utf8"),
  };

  const proposals: RuleSet[] = [];
  const started = Date.now();
  const result = await extractRules(createClaudeModel(apiKey), input, ({ rules }) => {
    proposals.push(rules);
  });
  const seconds = Math.round((Date.now() - started) / 1000);

  const gold = await loadGold(id);
  const compare = (rules: RuleSet | undefined) => (gold && rules ? compareRules(gold, rules) : null);
  const record = {
    source: id,
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    requestedModel: MODEL_ID,
    seconds,
    costUsd: costOf(result.attempts),
    attempts: result.attempts,
    comparison: { first: compare(proposals[0]), final: compare(proposals.at(-1)) },
    ...(result.ok
      ? {
          outcome: "ok",
          problems: result.problems,
          notes: result.notes,
          impacts:
            result.problems.length === 0
              ? computeImpacts(result.rules, source.courses, source.students, {}).map(
                  ({ ambiguityId, question, computable, options, affectedStudentIds }) => ({
                    ambiguityId,
                    question,
                    computable,
                    options: options.map(({ id: optionId, label, counts }) => ({ optionId, label, counts })),
                    affected: affectedStudentIds.length,
                  }),
                )
              : null,
          rules: result.rules,
        }
      : { outcome: "failed", failure: result.failure }),
  };

  const dir = join(ROOT, "evals", "results", "extract");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${id}-${stamp()}.json`);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);

  const { first, final } = record.comparison;
  console.log(`${id}: ${record.outcome}、${seconds}秒、$${record.costUsd}、${result.attempts.length}回`);
  console.log(`  回ごとの問題: ${result.attempts.map((attempt) => attempt.problems).join(" → ")}`);
  if (first && final) {
    console.log(`  一致率: 初回 ${first.matched}/${first.total}、最終 ${final.matched}/${final.total}`);
  }
  console.log(`  保存先: ${path}`);
}

const ids = process.argv.slice(2);
if (ids.length === 0) throw new Error("対象を指定してください: sakuradai kamome");
const apiKey = readApiKey();
// 評価は並列にせず直列で回す
for (const id of ids) await run(id, apiKey);
