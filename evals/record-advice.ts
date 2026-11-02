// 実際に Claude を呼び、表示用の学生の履修案を、API キーなしで読み込める記録として保存する。
// 使い方: npm run record:advice -- countable S0007 S0051 S0095
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sakuradaiCourses } from "../data/fictional/sakuradai/courses";
import { goldRules } from "../data/fictional/sakuradai/gold-rules";
import { sakuradaiStudents } from "../data/fictional/sakuradai/students";
import type { RuleSet } from "../engine";
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

const [option, ...ids] = process.argv.slice(2);
if ((option !== "earned" && option !== "countable") || ids.length === 0) {
  throw new Error("第6条の読み方（earned か countable）と学生を指定してください");
}

// 審査員が確定する記録のルール案では、同じ読み方でも曖昧箇所の ID が違う。
function proposalAnswers(reading: string) {
  const { rules } = JSON.parse(
    readFileSync(join(ROOT, "data/fictional/sakuradai/recorded-proposal.json"), "utf8"),
  ) as { rules: RuleSet };
  for (const { id, options } of rules.ambiguities) {
    const found = options.find(({ patches }) => patches?.some(({ value }) => value === reading));
    if (found) return { [id]: found.id };
  }
  throw new Error(`記録のルール案に読み方がありません: ${reading}`);
}

const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
const adviceRules = readFileSync(join(ROOT, "data/fictional/advice-rules.md"), "utf8");
const loop = createAdvisorLoop(readApiKey());
const answers = { [QUESTION]: option };
const answerForms = [answers, proposalAnswers(option)];
const recordedAt = new Date().toISOString().slice(0, 10);
const records = [];

// 評価は並列にせず直列で回す（設計書 v4 第6節）
for (const id of ids) {
  const student = sakuradaiStudents.find((candidate) => candidate.id === id);
  if (!student) throw new Error(`学生がいません: ${id}`);

  let run: LoopResult | null = null;
  const measured: AdvisorLoop = async (request) => {
    run = await loop(request);
    return run;
  };
  const advice = await adviseStudent(measured, {
    rules: goldRules,
    courses: sakuradaiCourses,
    student,
    answers,
    adviceRules,
  });
  const cost = run ? costOf(run) : 0;
  const corrections = advice.status === "passed" ? advice.corrections.length : 0;
  console.log(id, advice.status, `${advice.iterations}周`, `修正 ${corrections}回`, `$${cost}`);
  if (advice.status === "passed") records.push({ studentId: id, answers: answerForms, advice });
}

const path = join(ROOT, "data/fictional/sakuradai/recorded-advice.json");
const recording = { model: MODEL_ID, recordedAt, commit };
writeFileSync(path, `${JSON.stringify({ recording, records }, null, 2)}\n`);
console.log(`${records.length}件を保存しました: ${path}`);
