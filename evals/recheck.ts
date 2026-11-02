// 保存した変換の結果を、今のコードで検査し直す。Claude を呼ばないので API キーは要らない。
// 使い方: npm run eval:recheck
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { kamomeCourses } from "../data/fictional/kamome/courses";
import { goldRules as kamomeGold } from "../data/fictional/kamome/gold-rules";
import { kamomeStudents } from "../data/fictional/kamome/students";
import { sakuradaiCourses } from "../data/fictional/sakuradai/courses";
import { goldRules as sakuradaiGold } from "../data/fictional/sakuradai/gold-rules";
import { sakuradaiStudents } from "../data/fictional/sakuradai/students";
import { collectQuotes, validateRuleSet, verifyQuotes, type RuleSet } from "../engine";
import { compareRules } from "../engine/compareRules";
import { compareJudgments } from "./compare";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RESULTS = join(ROOT, "evals/results/extract");

const SOURCES = [
  { id: "sakuradai", gold: sakuradaiGold, courses: sakuradaiCourses, students: sakuradaiStudents },
  { id: "kamome", gold: kamomeGold, courses: kamomeCourses, students: kamomeStudents },
];

type SavedResult = { commit: string; requestedModel: string; outcome: string; rules: RuleSet };

function savedResults(id: string) {
  return readdirSync(RESULTS)
    .filter((name) => name.startsWith(`${id}-`))
    .sort()
    .map((name) => ({ name, saved: JSON.parse(readFileSync(join(RESULTS, name), "utf8")) as SavedResult }));
}

function compareWithGold(gold: RuleSet, rules: RuleSet) {
  const comparison = compareRules(gold, rules);
  // 同じ節というだけの一致は検出に数えない
  const detected = comparison.ambiguities.filter(({ detected: how }) => how === "same_field");
  return { comparison, detected };
}

for (const { id, gold, courses, students } of SOURCES) {
  const results = savedResults(id);
  console.log(`${id}: 全${results.length}回`);
  for (const { name, saved } of results) {
    if (saved.outcome !== "ok") {
      console.log(`  ${name} ${saved.commit.slice(0, 7)} 失敗`);
      continue;
    }
    const { comparison, detected } = compareWithGold(gold, saved.rules);
    const items = `${comparison.matched}/${comparison.total}`;
    console.log(`  ${name} ${saved.commit.slice(0, 7)} 項目 ${items}、検出 ${detected.length}/${gold.ambiguities.length}`);
  }

  const latest = results.findLast(({ saved }) => saved.outcome === "ok");
  if (!latest) throw new Error(`変換の結果がありません: ${id}`);
  const { name, saved } = latest;
  const { rules } = saved;
  const handbook = readFileSync(join(ROOT, "data/fictional", id, "handbook.md"), "utf8");
  const quotes = collectQuotes(rules);
  const { comparison, detected } = compareWithGold(gold, rules);

  console.log(`最新: ${name}（${saved.commit.slice(0, 7)}、${saved.requestedModel}）`);
  // 曖昧箇所が変える値は項目の数に入れず、見逃しは検出と案にない項目で見る
  console.log(`  項目の一致: ${comparison.matched}/${comparison.total}`);
  console.log(`  案にない項目: ${comparison.missing.length}件 ${comparison.missing.join("、")}`);
  console.log(`  曖昧箇所の検出: ${detected.length}/${gold.ambiguities.length} ${detected.map(({ id: ambiguity }) => ambiguity).join("、")}`);
  console.log(`  根拠の文の実在: ${quotes.length - verifyQuotes(quotes, handbook).length}/${quotes.length}`);
  console.log(`  ルールの検査の問題: ${validateRuleSet(rules, courses).length}件`);
  for (const { scenario, matched, total, differences } of compareJudgments(gold, rules, courses, students)) {
    console.log(`  判定の一致（${scenario}）: ${matched}/${total} ${JSON.stringify(differences)}`);
  }
}
