// 作業用コピーの engine を1か所ずつ壊し、テストが落ちるかを記録する。
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
if (!root || existsSync(join(root, ".git"))) {
  console.error("repo の外の作業用コピーを指定してください");
  process.exit(1);
}
const log = join(root, "mutants.out");
writeFileSync(log, "");

const M = [
  ["evaluate", "student.specialStatuses.length > 0", "false", "特別な状態の除外"],
  ["evaluate", "!rules.admissionYears.includes(student.admissionYear)", "false", "適用外年度の除外"],
  ["evaluate", "if (unknown.length > 0)", "if (false)", "科目データにない科目の除外"],
  ["evaluate", "uncertain.set(category.overflowTo, [...new Set([...inherited, ...ids])]);", "", "未確定の超過分の継承"],
  ["evaluate", "allocation.total >= category.minCredits && allocation.missingCourses.length === 0", "allocation.total >= category.minCredits", "区分: 必修の未修得を見ない"],
  ["evaluate", "allocation.total >= category.minCredits &&", "allocation.total > category.minCredits &&", "区分: 最低単位の境界"],
  ["evaluate", "if (base.ambiguityIds.length > 0) {", "if (false) {", "区分: 未確定を職員確認に"],
  ["evaluate", "needsContact: student.studentYear >= rules.graduation.minYears,", "needsContact: student.studentYear > rules.graduation.minYears,", "区分: 最終年次の境界"],
  ["evaluate", "if (isCategoryMet(category, allocationOf(projected, category))) {", "if (false) {", "区分: 履修中で足りるなら待つ"],
  ["evaluate", "if (ownIds.length > 0) {", "if (false) {", "卒業: 自身の未確定"],
  ["evaluate", "if (shortCategories.length === 0) {", "if (true) {", "卒業: 確定の不足を優先"],
  ["evaluate", "if (uncertainIds.length > 0) {", "if (false) {", "卒業: 区分の未確定"],
  ["evaluate", "const creditsMet = current.counted >= graduation.totalCredits;", "const creditsMet = current.counted > graduation.totalCredits;", "卒業: 合計の境界"],
  ["evaluate", " && categories.every((c) => c.status === \"satisfied\")", "", "卒業: 全区分の充足を見ない"],
  ["evaluate", "const finalYear = student.studentYear >= graduation.minYears;", "const finalYear = student.studentYear > graduation.minYears;", "卒業: 最終年次の境界"],
  ["evaluate", "if (projected.counted < graduation.totalCredits) {", "if (current.counted < graduation.totalCredits) {", "卒業: 履修中で足りるなら待つ"],
  ["evaluate", "gate.creditBasis === \"countable\" ? allocation.counted : allocation.earned", "allocation.earned", "条件: 算入単位で数える"],
  ["evaluate", "actual >= (gate.minCredits ?? 0) && missingCourses.length === 0", "actual >= (gate.minCredits ?? 0)", "条件: 必要科目を見ない"],
  ["evaluate", "const satisfied = actual >= (gate.minCredits ?? 0)", "const satisfied = actual > (gate.minCredits ?? 0)", "条件: 単位の境界"],
  ["evaluate", "gate.creditBasis === \"countable\" ? [...uncertainCategories.values()].flat() : []", "[]", "条件: 算入単位の未確定の継承"],
  ["evaluate", "student.studentYear >= gate.target.toYear", "student.studentYear > gate.target.toYear", "進級: 境界"],
  ["evaluate", "if (ambiguityIds.length > 0) {", "if (false) {", "条件: 未確定を職員確認に"],
  ["evaluate", "if (student.studentYear <= check) {", "if (student.studentYear < check) {", "条件: 判定年次の境界"],
  ["evaluate", "const atRisk = student.studentYear === check;", "const atRisk = true;", "条件: 危険の印の年次"],
  ["evaluate", "const atCheck = at(check);", "const atCheck = at();", "条件: 判定時点より後を数えない"],
  ["evaluate", "if (!gate.retryAfterMet) {", "if (false) {", "条件: やり直し不可"],
  ["evaluate", "year < student.studentYear; year += 1", "year <= student.studentYear; year += 1", "条件: やり直しの年次の範囲"],
  ["evaluate", "eligibleFromYear: year + 1", "eligibleFromYear: year", "条件: 認められる年次"],
  ["evaluate", "present.satisfied || projected.satisfied", "present.satisfied", "条件: 履修中のやり直し"],
  ["evaluate", ".filter((gate) => matchesCondition(gate.when, student))\n    .map((gate) => judgeGate(gate, context));", ".map((gate) => judgeGate(gate, context));", "条件: when を見ない"],
  ["plan", "return check.status === \"passed\";", "return check.status !== \"failed\";", "表示: 職員確認の案を出す"],
  ["plan", "return a === b || a === \"通年\" || b === \"通年\";", "return a === b;", "通年の重なり"],
  ["plan", "a.quarter === undefined || b.quarter === undefined || a.quarter === b.quarter", "a.quarter === b.quarter", "時間割: クォーター未指定"],
  ["plan", "record.result === \"enrolled\" && record.studentYear === student.studentYear", "record.result === \"enrolled\"", "履修中: 今年度に限る"],
  ["plan", "if (seen.has(course)) {", "if (false) {", "重複: 案の中"],
  ["plan", "if (inProgress) {", "if (false) {", "重複: 履修中"],
  ["plan", "offeredIn !== undefined && offeredIn !== term", "false", "開講学期"],
  ["plan", "if (!rule || this.deferIfUnresolved(rule)) return;", "if (!rule) return;", "履修の基本: 未確定"],
  ["plan", "rule.forbidBeforeAssignedYear && student.studentYear < assignedYear", "rule.forbidBeforeAssignedYear && student.studentYear <= assignedYear", "配当年次の境界"],
  ["plan", "rule.forbidBeforeAssignedYear && student.studentYear", "student.studentYear", "配当年次の設定を見ない"],
  ["plan", "rule.forbidRetakeOfPassed && passed.has(course)", "passed.has(course)", "再履修禁止の設定を見ない"],
  ["plan", "rule.course !== entry.course || !matchesCondition(rule.when, student)", "rule.course !== entry.course", "先修: when を見ない"],
  ["plan", "if (this.deferIfUnresolved(rule, entry.course)) continue;", "", "先修: 未確定"],
  ["plan", "passed.has(name) || earlier(name) || together(name)", "earlier(name) || together(name)", "先修: 修得済みを見ない"],
  ["plan", "rule.allowSameTerm && others(name)", "others(name)", "先修: 同じ学期の設定を見ない"],
  ["plan", "passed.has(name) || earlier(name) || together(name)", "passed.has(name) || together(name)", "先修: 前の学期を見ない"],
  ["plan", "gate.target.kind !== \"course\" || !matchesCondition(gate.when, student)", "gate.target.kind !== \"course\"", "履修条件: when を見ない"],
  ["plan", "if (judgment.status === \"needs_staff\") {\n          this.issues.push({", "if (false) {\n          this.issues.push({", "履修条件: 職員確認を違反にする"],
  ["plan", "if (judgment.status === \"satisfied\") continue;", "if (judgment.status !== \"short\" && judgment.status !== \"needs_staff\") continue;", "履修条件: 判定待ちを通す"],
  ["plan", "record.studentYear >= before", "record.studentYear > before", "再履修: 登録済みの判定"],
  ["plan", "(entry) => !this.isExcludedRetake(limit, entry.course, student.studentYear + 1),", "() => true,", "再履修: 案の科目"],
  ["plan", ".filter((record) => !this.isExcludedRetake(limit, record.course, record.studentYear))", "", "再履修: 登録済みの科目"],
  ["plan", "if (limit.retakeExclusion === \"none\") return false;", "", "再履修を上限から除く"],
  ["plan", "return record.result === \"disqualified\" && limit.retakeExclusion === \"failed_or_disqualified\";", "return record.result === \"disqualified\";", "再履修: 失格を除く設定を見ない"],
  ["plan", "const limit = applicable.at(-1);", "const limit = applicable[0];", "上限: 最後のものを使う"],
  ["plan", "if (deferred) return;", "", "上限: 未確定"],
  ["plan", "load.後期 += credits / 2;", "load.後期 += credits;", "通年: 後期の半分"],
  ["plan", "} else load[term] += credits;", "} else load.後期 += credits;", "通年: 分けない場合"],
  ["plan", "if (load[term] > limit.maxPerTerm) {", "if (load[term] >= limit.maxPerTerm) {", "学期上限の境界"],
  ["plan", "limit.maxPerYear !== undefined && year > limit.maxPerYear", "limit.maxPerYear !== undefined && year >= limit.maxPerYear", "年間上限の境界"],
  ["plan", "if (!matchesCondition(rule.when, student)) continue;\n      const inGroup", "const inGroup", "科目数: when を見ない"],
  ["plan", "inGroup.length === 0 || this.deferIfUnresolved(rule)", "inGroup.length === 0", "科目数: 未確定"],
  ["plan", "if (count > rule.maxPerTerm) {", "if (count >= rule.maxPerTerm) {", "科目数の境界"],
  ["plan", "inGroup.filter((entry) => overlaps(entry.term, term)).length", "inGroup.filter((entry) => entry.term === term).length", "科目数: 通年を両学期に数える"],
  ["plan", "of this.scheduled.slice(index + 1)", "of this.plan.slice(index + 1)", "時間割: 履修中の科目と比べる"],
  ["plan", "!overlaps(entry.term, other.term)", "false", "時間割: 別学期を除く"],
  ["plan", "if (issues.some((issue) => issue.code !== \"PENDING_RULE\")) {\n    return { status: \"failed\", issues, warnings };\n  }", "", "違反を不可にする"],
  ["plan", "if (issues.length > 0) return { status: \"needs_staff\", issues, warnings };", "", "職員確認を返す"],
  ["credits", "category.overflowTo === null ? Number.POSITIVE_INFINITY : category.minCredits", "category.minCredits", "上限なしの区分の扱い"],
  ["credits", "limitExcess + (category.overflowTo === null ? excess : 0)", "limitExcess", "算入されない単位の集計"],
  ["credits", "category.requireAll ? missingCourses(category, passed, catalog) : []", "[]", "必修の未修得"],
  ["credits", "Math.max(0, sum(limited) - limit.maxCredits)", "sum(limited) - limit.maxCredits", "部分上限の下限"],
  ["credits", "earned += course.credits;", "", "修得単位の集計"],
  ["credits", "(received.get(category.overflowTo) ?? 0) + excess", "excess", "複数の送り元の合算"],
  ["impact", "if (status === \"needs_staff\") needsStaff.add(student.id);", "", "職員確認の人数"],
  ["impact", "[...needsStaff].filter((id) => !affected.has(id))", "[...needsStaff]", "影響と職員確認の重複を除く"],
  ["impact", "(shown.get(change.ruleId)?.size ?? 0) > 1", "(shown.get(change.ruleId)?.size ?? 0) > 0", "変化なしを除く"],
  ["impact", ".sort((a, b) => b.affectedStudentIds.length - a.affectedStudentIds.length)", "", "影響人数の順"],
  ["impact", ".filter((ambiguity) => !(ambiguity.id in answers))", "", "回答済みを除く"],
  ["evaluate", "needsContact: outcome.atRisk === true || (outcome.status === \"short\" && passedCheck),", "needsContact: outcome.status === \"short\" && passedCheck,", "危険の印を声かけに"],
  ["evaluate", "needsContact: outcome.atRisk === true || (outcome.status === \"short\" && passedCheck),", "needsContact: outcome.status === \"short\", ","判定待ち全員を声かけにする"],
  ["outreach", "kind: contact.length > 0 ? \"contact\" : \"staff_review\"", "kind: \"contact\"", "職員確認の区別"],
  ["outreach", "if (a.kind !== b.kind) return a.kind === \"contact\" ? -1 : 1;", "", "声かけを先に並べる"],
  ["outreach", "return b.studentYear - a.studentYear || a.studentId.localeCompare(b.studentId);", "return a.studentId.localeCompare(b.studentId);", "高年次を先に並べる"],
  ["outreach", "reasons: [...contact, ...review].map(toReason)", "reasons: contact.map(toReason)", "根拠に職員確認を含める"],
  ["answers", "unresolved.delete(ambiguityId);", "", "回答で解決する"],
  ["answers", "const rules = structuredClone(base);", "const rules = base;", "元のルールを守る"],
  ["model", "(student.hasMinor ?? false) !== hasMinor", "student.hasMinor !== hasMinor", "副専攻の既定値"],
  ["model", "student.studentYear < minStudentYear", "student.studentYear <= minStudentYear", "年次条件の境界"],
  ["model", "gpaHundredths(student.previousGpa) < gpaHundredths(minPreviousGpa)", "gpaHundredths(student.previousGpa) <= gpaHundredths(minPreviousGpa)", "GPA 条件の境界"],
  ["model", "if (student.previousGpa === undefined) return false;", "", "GPA がない学生"],
  ["model", "if (record.studentYear > throughYear) continue;", "if (record.studentYear >= throughYear) continue;", "throughYear の境界"],
  ["validate", "if (ruleIds.has(rule.id))", "if (false)", "検証: id の重複"],
  ["validate", "category.subLimits?.forEach((limit) => limit.groups.forEach((group) => checkGroup(id, group)));", "", "検証: subLimits の群"],
  ["validate", "checkCourse(prerequisite.id, prerequisite.course);", "", "検証: 先修の科目"],
  ["validate", "gate.requiredCourses.forEach((name) => checkCourse(gate.id, name));", "", "検証: 条件の必要科目"],
];

function runTests() {
  const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--bail=1", "--reporter=dot"], {
    cwd: root,
    encoding: "utf8",
    timeout: 60000,
  });
  return result.status;
}

const baseline = runTests();
appendFileSync(log, `BASELINE ${baseline}\n`);
if (baseline !== 0) process.exit(1);

let killed = 0;
const survivors = [];
const skipped = [];
for (const [file, search, replace, label] of M) {
  const path = join(root, "engine", `${file}.ts`);
  const original = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  if (!original.includes(search)) {
    skipped.push(label);
    appendFileSync(log, `SKIP ${file} ${label}\n`);
    continue;
  }
  writeFileSync(path, original.replace(search, replace));
  const status = runTests();
  writeFileSync(path, original);
  if (status === 0) {
    survivors.push(`${file}: ${label}`);
    appendFileSync(log, `SURVIVED ${file}: ${label}\n`);
  } else {
    killed += 1;
    appendFileSync(log, `killed ${file}: ${label}\n`);
  }
}
appendFileSync(log, `DONE total=${M.length} killed=${killed} survived=${survivors.length} skipped=${skipped.length}\n`);
