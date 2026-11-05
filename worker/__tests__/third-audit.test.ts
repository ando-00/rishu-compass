import { describe, expect, it } from "vitest";
import { sakuradaiCourses } from "../../data/fictional/sakuradai/courses";
import { goldRules } from "../../data/fictional/sakuradai/gold-rules";
import { sakuradaiStudents } from "../../data/fictional/sakuradai/students";
import { evaluateStudent, type RuleSet, type Student } from "../../engine";

// 第3回の監査の A3-1。未確定の履修条件の仮の値だけから、卒業要件の延期見込みと声かけを出さない。
// 履修条件が要確認のとき、または差分で表せない候補だけの未回答の曖昧箇所が掛かるときは、
// 履修条件の中身が決まっていないので、「履修条件がなくても間に合わない」と確かめられた学生だけを延期見込みにする。

const ANSWERED = { "seminar-credit-basis": "countable", "retake-disqualified-scope": "include" };

function graduation(rules: RuleSet, student: Student) {
  const found = evaluateStudent(rules, sakuradaiCourses, student, ANSWERED).judgments.find((j) => j.kind === "graduation");
  if (!found) throw new Error(student.id);
  return found;
}

function gateOf(rules: RuleSet) {
  const gate = rules.gates.find((g) => g.id === "gate-seminar");
  if (!gate) throw new Error("gate-seminar");
  return gate;
}

// 履修条件がいちばん緩い値（単位も科目も求めない）でも延期見込みになる学生
function delayedWithoutGate() {
  const relaxed = structuredClone(goldRules);
  Object.assign(gateOf(relaxed), { minCredits: 0, requiredCourses: [] });
  return new Set(sakuradaiStudents.filter((s) => graduation(relaxed, s).status === "delay_risk").map((s) => s.id));
}

const delayed = sakuradaiStudents.filter((s) => graduation(goldRules, s).status === "delay_risk");

describe("未確定の履修条件と延期見込み（第3回の監査 A3-1）", () => {
  it("前提: 正解ルールでは34人が延期見込みで、そのうち12人は演習Ⅰの履修条件の値だけで決まっている", () => {
    const without = delayedWithoutGate();
    expect(delayed).toHaveLength(34);
    expect(delayed.filter((s) => !without.has(s.id)).map((s) => s.id)).toContain("S0095");
    expect(delayed.filter((s) => !without.has(s.id))).toHaveLength(12);
  });

  const cases: [string, (rules: RuleSet) => void][] = [
    ["要確認（needs_review）の履修条件", (rules) => Object.assign(gateOf(rules), { status: "needs_review" })],
    [
      "差分で表せない候補だけの未回答の曖昧箇所が掛かる履修条件",
      (rules) => {
        rules.ambiguities.push({
          id: "held",
          clause: "第6条",
          sourceQuote: "修得単位が合計60単位以上であること",
          question: "表せない読み方がありますか。",
          options: [
            { id: "a", label: "表せない読み方1", patches: null },
            { id: "b", label: "表せない読み方2", patches: null },
          ],
        });
        gateOf(rules).ambiguityIds = ["seminar-credit-basis", "held"];
      },
    ],
  ];

  it.each(cases)("%s: 履修条件の値だけで決まる12人は、延期見込みにも声かけにもせず職員確認にする", (_, change) => {
    const rules = structuredClone(goldRules);
    change(rules);
    const without = delayedWithoutGate();
    for (const student of delayed.filter((s) => !without.has(s.id))) {
      const judgment = graduation(rules, student);
      expect([student.id, judgment.status, judgment.needsContact]).toEqual([student.id, "needs_staff", false]);
    }
  });

  it.each(cases)("%s: 履修条件がなくても間に合わない22人は、延期見込みのまま", (_, change) => {
    const rules = structuredClone(goldRules);
    change(rules);
    const without = delayedWithoutGate();
    const rest = delayed.filter((s) => without.has(s.id));
    expect(rest).toHaveLength(22);
    for (const student of rest) {
      expect([student.id, graduation(rules, student).status]).toEqual([student.id, "delay_risk"]);
    }
  });
});
