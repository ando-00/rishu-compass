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

// H31（A3-2。2026-11-05 作り手の指示「おすすめの通り修正」）。卒業要件自身の曖昧箇所が未回答で、確定の区分に不足があるとき（H30 の枝）でも、
// 区分がすべて確定していて、必修が卒業予定に間に合わないことが履修の順だけで確かめられる学生は、どう答えても延期見込みなので、延期見込みにする。
describe("卒業要件自身の曖昧箇所が未回答のときの延期見込み（H31、A3-2）", () => {
  const others = { "seminar-credit-basis": "earned", "retake-disqualified-scope": "include" };
  const rules = structuredClone(goldRules);
  rules.graduation.ambiguityIds = ["total"];
  rules.ambiguities.push({
    id: "total",
    clause: "第1条",
    sourceQuote: "合計124単位以上",
    question: "合計単位は124単位ですか。",
    options: [
      { id: "a", label: "124単位", patches: [{ ruleId: rules.graduation.id, field: "totalCredits", value: 124 }] },
      { id: "b", label: "120単位", patches: [{ ruleId: rules.graduation.id, field: "totalCredits", value: 120 }] },
    ],
  });
  const of = (student: Student, answers: Record<string, string>) => {
    const found = evaluateStudent(rules, sakuradaiCourses, student, answers).judgments.find((j) => j.kind === "graduation");
    if (!found) throw new Error(student.id);
    return found;
  };
  const rows = sakuradaiStudents.map((student) => ({
    student,
    open: of(student, others),
    a: of(student, { ...others, total: "a" }),
    b: of(student, { ...others, total: "b" }),
  }));

  it("どちらに答えても延期見込みの学生は、未回答でも声かけにする（対応なしにしない）", () => {
    const both = rows.filter(({ a, b }) => a.status === "delay_risk" && b.status === "delay_risk");
    expect(both.length).toBeGreaterThan(0);
    for (const { student, open } of both) {
      expect([student.id, open.needsContact]).toEqual([student.id, true]);
    }
  });

  it("最終年次より前で、必修が間に合わない学生（S0111、3年次）は、回答のあとと同じ延期見込みにする", () => {
    const { student, open, a, b } = rows.find((row) => row.student.id === "S0111")!;
    expect(student.studentYear).toBe(3);
    expect([open.status, a.status, b.status]).toEqual(["delay_risk", "delay_risk", "delay_risk"]);
    expect(open.reason).toBe(a.reason);
    expect(open.ambiguityIds).toContain("total");
  });

  it("未回答で延期見込みにした学生は、どちらに答えても延期見込みになる（未確定を確定にしない）", () => {
    for (const { student, a, b } of rows.filter(({ open }) => open.status === "delay_risk")) {
      expect([student.id, a.status, b.status]).toEqual([student.id, "delay_risk", "delay_risk"]);
    }
  });

  it("未確定の区分があるときは、不足の必修が決まらないので延期見込みにせず、今までどおり「不足」（H30）", () => {
    const withCategory = structuredClone(rules);
    withCategory.categories.find((c) => c.id === "free")!.ambiguityIds = ["free-min"];
    withCategory.ambiguities.push({
      id: "free-min",
      clause: "第1条",
      sourceQuote: "合計124単位以上",
      question: "自由の区分の最低単位は20単位ですか。",
      options: [
        { id: "a", label: "20単位", patches: [{ ruleId: "free", field: "minCredits", value: 20 }] },
        { id: "b", label: "18単位", patches: [{ ruleId: "free", field: "minCredits", value: 18 }] },
      ],
    });
    const student = sakuradaiStudents.find((s) => s.id === "S0111")!;
    const found = evaluateStudent(withCategory, sakuradaiCourses, student, others).judgments.find((j) => j.kind === "graduation")!;
    expect([found.status, found.needsContact]).toEqual(["short", false]);
  });

  it("単位の不足だけから延期見込みになる最終年次の学生（S0164）は、H30 のとおり「不足」と声かけ", () => {
    const { student, open, a } = rows.find((row) => row.student.id === "S0164")!;
    expect(student.studentYear).toBe(4);
    expect([open.status, open.needsContact, a.status]).toEqual(["short", true, "delay_risk"]);
  });
});

// H33（A3-14。2026-11-05 作り手の指示「おすすめの通り修正」）。履修条件を満たしていない科目を今年度に履修中の学生は、
// 履修条件の理由にその事実を添える。遡って声かけする動き（H4）と人数は変えない。
describe("履修条件を満たさない科目を履修中の学生の理由（H33、A3-14）", () => {
  const gate = (id: string, answers: Record<string, string>) => {
    const student = sakuradaiStudents.find((s) => s.id === id)!;
    return evaluateStudent(goldRules, sakuradaiCourses, student, answers).judgments.find((j) => j.ruleId === "gate-seminar")!;
  };
  const EARNED = { ...ANSWERED, "seminar-credit-basis": "earned" };
  const moved = ["S0007", "S0051", "S0095", "S0183", "S0227", "S0271"];

  it("第6条の回答で声かけに入る6人は、演習Ⅰを今年度に履修中だと理由に出す", () => {
    for (const id of moved) {
      const judgment = gate(id, ANSWERED);
      expect([id, judgment.status]).toEqual([id, "delayed"]);
      expect(judgment.reason).toContain("演習Ⅰ は今年度、履修中です。");
    }
  });

  it("条件を満たす読み方では添えない", () => {
    for (const id of moved) expect(gate(id, EARNED).reason).not.toContain("履修中です");
  });

  it("演習Ⅰを履修していない学生には添えない", () => {
    const without = sakuradaiStudents.filter(
      (s) => !s.records.some((r) => r.course === "演習Ⅰ" && r.result === "enrolled" && r.studentYear === s.studentYear),
    );
    expect(without.length).toBeGreaterThan(0);
    for (const student of without) expect(gate(student.id, ANSWERED).reason).not.toContain("今年度、履修中です");
  });
});
