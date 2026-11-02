// 実際に Claude を呼び、評価用の学生の履修案を作って結果を evals/results/advise/ に保存する。
// 使い方: npm run eval:advise -- countable E0004 E0005（学生を省くと10名すべて）
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sakuradaiCourses } from "../data/fictional/sakuradai/courses";
import { sakuradaiEvalStudents } from "../data/fictional/sakuradai/eval-students";
import { goldRules } from "../data/fictional/sakuradai/gold-rules";
import { adviseStudent, type AdvisorLoop, type LoopResult } from "../worker/advisor/advise";
import { createAdvisorLoop } from "../worker/advisor/claude";
import { MODEL_ID } from "../worker/rule-extraction/claude";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const QUESTION = "seminar-credit-basis";

// Opus 5.5 の 100万トークンあたりの価格（ドル）
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

function readApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const vars = readFileSync(join(ROOT, ".dev.vars"), "utf8");
  const key = /^ANTHROPIC_API_KEY=(.+)$/m.exec(vars)?.[1]?.trim();
  if (!key) throw new Error(".dev.vars に ANTHROPIC_API_KEY がありません");
  return key;
}

function costOf({ usage }: LoopResult) {
  const cost =
    usage.inputTokens * PRICE.input +
    usage.outputTokens * PRICE.output +
    usage.cacheReadTokens * PRICE.cacheRead +
    usage.cacheWriteTokens * PRICE.cacheWrite;
  return Number((cost / 1_000_000).toFixed(4));
}

async function main() {
  const [option, ...ids] = process.argv.slice(2);
  if (option !== "earned" && option !== "countable") {
    throw new Error("第6条の読み方に earned か countable を指定してください");
  }
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  const targets = sakuradaiEvalStudents.filter(
    ({ student }) => ids.length === 0 || ids.includes(student.id),
  );
  const adviceRules = readFileSync(join(ROOT, "data/fictional/advice-rules.md"), "utf8");
  const loop = createAdvisorLoop(readApiKey());
  const results = [];

  // 評価は並列にせず直列で回す（設計書 v4 第6節）
  for (const { type, student } of targets) {
    let run: LoopResult | null = null;
    const calls: { tool: string; input: unknown; output: string }[] = [];
    const measured: AdvisorLoop = async (request) => {
      const tools = request.tools.map((tool) => ({
        ...tool,
        run: (input: unknown) => {
          const output = tool.run(input);
          calls.push({ tool: tool.name, input, output: output.slice(0, 400) });
          return output;
        },
      }));
      run = await loop({ ...request, tools });
      return run;
    };
    const startedAt = Date.now();
    const result = await adviseStudent(measured, {
      rules: goldRules,
      courses: sakuradaiCourses,
      student,
      answers: { [QUESTION]: option },
      adviceRules,
    });
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    const cost = run ? costOf(run) : 0;
    console.log(student.id, result.status, `${result.iterations}周`, `${seconds}秒`, `$${cost}`);
    results.push({ studentId: student.id, type, seconds, cost, usage: (run as LoopResult | null)?.usage ?? null, calls, result });
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15).replace("T", "-");
  const dir = join(ROOT, "evals/results/advise");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `sakuradai-${stamp}.json`);
  writeFileSync(file, `${JSON.stringify({ commit, model: MODEL_ID, option, results }, null, 2)}\n`);
  console.log(file);
}

await main();
