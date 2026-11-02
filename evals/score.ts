// 評価用の10名を、作り手が書いた正解と比べて採点し、結果を evals/results/score/ に保存する。
// Claude を呼ばない。履修案は evals/results/advise/ の10名そろった最新の記録を読む。
// 使い方: npm run eval:score
// 正解は data/fictional/sakuradai/gold-eval.json に置く。ない間は、正解のいらない項目だけを出す。
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sakuradaiCourses } from "../data/fictional/sakuradai/courses";
import { sakuradaiEvalStudents } from "../data/fictional/sakuradai/eval-students";
import { goldRules } from "../data/fictional/sakuradai/gold-rules";
import { evaluateStudent } from "../engine";
import { adviseResponseSchema, type AdviseResponse } from "../shared/advise";
import { reviewPlan } from "../worker/advisor/advise";
import { evalGoldSchema, scoreStudent, summarizeChecks, unresolvedShown, type Danger } from "./scoring";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ADVISE_DIR = join(ROOT, "evals/results/advise");
const GOLD_PATH = join(ROOT, "data/fictional/sakuradai/gold-eval.json");

type AdviseRecord = {
  commit: string;
  model: string;
  option: string;
  results: { studentId: string; calls?: { tool: string; output: string }[]; result: AdviseResponse }[];
};

function latestFullRecord() {
  const names = readdirSync(ADVISE_DIR).filter((name) => name.endsWith(".json")).sort().reverse();
  for (const name of names) {
    const record = JSON.parse(readFileSync(join(ADVISE_DIR, name), "utf8")) as AdviseRecord;
    if (record.results.length === sakuradaiEvalStudents.length) return { name, record };
  }
  throw new Error("10名そろった履修案の記録がありません。npm run eval:advise を実行してください");
}

function readGold() {
  if (!existsSync(GOLD_PATH)) return null;
  return evalGoldSchema.parse(JSON.parse(readFileSync(GOLD_PATH, "utf8")));
}

function score(record: AdviseRecord) {
  const gold = readGold();
  if (!gold) return null;
  const advice = new Map(record.results.map(({ studentId, result }) => [studentId, adviseResponseSchema.parse(result)]));
  const missing = sakuradaiEvalStudents.filter(({ student }) => !gold.students[student.id]);
  if (missing.length > 0) {
    throw new Error(`正解がない学生がいます: ${missing.map(({ student }) => student.id).join("、")}`);
  }
  const perStudent = sakuradaiEvalStudents.map(({ student }) => {
    const { judgments } = evaluateStudent(goldRules, sakuradaiCourses, student, gold.answers);
    const entry = gold.students[student.id]!;
    return { studentId: student.id, ...scoreStudent(student.id, entry, judgments, advice.get(student.id) ?? null) };
  });
  return {
    credits: {
      matched: perStudent.reduce((sum, { credits }) => sum + credits.matched, 0),
      total: perStudent.reduce((sum, { credits }) => sum + credits.total, 0),
      differences: perStudent.flatMap(({ studentId, credits }) =>
        credits.differences.map((difference) => ({ studentId, ...difference })),
      ),
    },
    dangerous: perStudent.flatMap(({ dangerous }) => dangerous),
    overEscalated: perStudent.filter(({ overEscalated }) => overEscalated).map(({ studentId }) => studentId),
    adviceMissing: perStudent.filter(({ adviceMissing }) => adviceMissing).map(({ studentId }) => studentId),
  };
}

// 記録のあとでルールや検査が変わっても案が有効かを、今のコードで検査し直す。
function recheckPlans(record: AdviseRecord) {
  const answers = { "seminar-credit-basis": record.option };
  const plans = sakuradaiEvalStudents.flatMap(({ student }) => {
    const found = record.results.find(({ studentId }) => studentId === student.id);
    const advice = found && adviseResponseSchema.parse(found.result);
    return advice?.status === "passed" ? [{ student, advice }] : [];
  });
  const passed = plans.filter(({ student, advice }) => {
    const plan = advice.plan.map(({ course, term }) => ({ course, term }));
    const input = { rules: goldRules, courses: sakuradaiCourses, student, answers };
    return reviewPlan(input, plan, advice.draft, advice.iterations, advice.corrections) !== null;
  });
  return { plans: plans.length, passed: passed.length };
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, "").slice(0, 15).replace("T", "-");
}

function main() {
  const { name, record } = latestFullRecord();
  const checks = summarizeChecks(record.results.map(({ calls, result }) => ({ calls: calls ?? [], result })));
  const rechecked = recheckPlans(record);
  const unresolved: Danger[] = sakuradaiEvalStudents.flatMap(({ student }) =>
    unresolvedShown(goldRules, sakuradaiCourses, student).map((rule) => ({
      studentId: student.id,
      kind: "unresolved_shown" as const,
      detail: rule,
    })),
  );
  const scored = score(record);
  const dangerous = [...unresolved, ...(scored?.dangerous ?? [])];

  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  const result = {
    commit,
    advice: { file: name, commit: record.commit, model: record.model, option: record.option },
    checks,
    rechecked,
    gold: scored ? "あり" : "なし",
    credits: scored?.credits ?? null,
    dangerous,
    overEscalated: scored?.overEscalated ?? null,
    adviceMissing: scored?.adviceMissing ?? null,
  };

  const dir = join(ROOT, "evals/results/score");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `sakuradai-${stamp()}.json`);
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);

  console.log(`履修案の記録: ${name}（${record.commit}、${record.model}、読み方 ${record.option}）`);
  console.log(`検査の通過: 検査まで進んだ ${checks.attempted}名のうち、最初の検査で ${checks.firstPassed}名、最後に ${checks.finalPassed}名`);
  console.log(`今のコードで検査し直して通る案: ${rechecked.passed}/${rechecked.plans}`);
  console.log(`未確定を確定として示した判定: ${unresolved.length}件`);
  if (scored) {
    console.log(`区分別の不足単位の一致: ${scored.credits.matched}/${scored.credits.total}`);
    console.log(`危険な誤り: ${dangerous.length}件 ${JSON.stringify(dangerous)}`);
    console.log(`回さなくてよい学生を職員に回した: ${scored.overEscalated.length}名`);
  } else {
    console.log("正解がないので、不足単位、卒業の見込み、職員に回す判断は採点していません");
  }
  console.log(file);
}

main();
