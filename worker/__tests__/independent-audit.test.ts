import { describe, expect, it } from "vitest";
import { sakuradaiCourses } from "../../data/fictional/sakuradai/courses";
import { goldRules } from "../../data/fictional/sakuradai/gold-rules";
import { sakuradaiStudents } from "../../data/fictional/sakuradai/students";
import { kamomeCourses } from "../../data/fictional/kamome/courses";
import { goldRules as kamomeGold } from "../../data/fictional/kamome/gold-rules";
import { kamomeStudents } from "../../data/fictional/kamome/students";
import {
  checkPlan,
  computeImpact,
  describeAmounts,
  evaluatePrepared,
  evaluateStudent,
  listOutreach,
  prepareRules,
  settledStudentIds,
  type Answers,
  type Course,
  type Judgment,
  type RuleSet,
  type Student,
  type StudentState,
} from "../../engine";
import { findRecordedProposal } from "../datasets";
import app from "../index";
import { acceptRules, needsReviewIds } from "../ruleSets";
import { createTestDb } from "./testDb";

// 独立の全体監査（2026-11-06）で見つけた誤りの再現。

const EXCLUDE = { "retake-disqualified-scope": "exclude" };
const INCLUDE = { "retake-disqualified-scope": "include" };
// 第13条に「含まない」と答えると声かけになる、失格の必修が残る7人
const SEVEN = ["S0074", "S0129", "S0159", "S0161", "S0186", "S0241", "S0285"];

function judgments(studentId: string, answers: Answers) {
  const student = sakuradaiStudents.find(({ id }) => id === studentId);
  if (!student) throw new Error(studentId);
  return evaluateStudent(goldRules, sakuradaiCourses, student, answers).judgments;
}

function find(list: Judgment[], name: string) {
  const judgment = list.find((j) => j.name === name);
  if (!judgment) throw new Error(name);
  return judgment;
}

async function summary(answers: Answers) {
  const { db } = createTestDb();
  const response = await app.request(
    "/api/datasets/sakuradai/overview",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers }) },
    { DB: db } as never,
  );
  return ((await response.json()) as { summary: unknown }).summary;
}

describe("失格の再履修を認めない読み方の判定（V-1）", () => {
  it("失格の必修を履修中でも、再び履修できないので「見込み」にしない", () => {
    const required = find(judgments("S0074", EXCLUDE), "基礎教育 必修");
    expect(required.status).toBe("short");
    expect(required.reason).toContain("英語Ⅱ は失格のため再び履修できません（第13条）");
  });

  it("卒業要件の理由と根拠に第13条を出し、関係のない履修の順を挙げない", () => {
    const graduation = find(judgments("S0074", EXCLUDE), "卒業要件");
    expect(graduation.status).toBe("delay_risk");
    expect(graduation.reason).toContain("英語Ⅱ は失格のため再び履修できません（第13条）");
    expect(graduation.reason).not.toContain("履修の順");
    expect(graduation.grounds?.map(({ clause }) => clause)).toEqual(["第13条"]);
  });

  it("失格の科目につながる科目は、第13条と履修の順の両方を根拠にする", () => {
    const graduation = find(judgments("S0129", EXCLUDE), "卒業要件");
    expect(graduation.reason).toContain("ミクロ経済学Ⅰ は失格のため再び履修できません（第13条）");
    expect(graduation.reason).toContain("履修の順は第11条で決まります");
    expect(graduation.grounds?.map(({ clause }) => clause).sort()).toEqual(["第11条", "第13条"]);
  });

  it.each(SEVEN)("%s: 声かけのままで、理由に第13条が出る", (id) => {
    const graduation = find(judgments(id, EXCLUDE), "卒業要件");
    expect([graduation.status, graduation.needsContact]).toEqual(["delay_risk", true]);
    expect(graduation.reason).toContain("第13条");
  });

  it("認める読み方では、今までどおり履修中を修得すれば満たす", () => {
    const required = find(judgments("S0074", INCLUDE), "基礎教育 必修");
    expect(required.status).toBe("expected");
    expect(required.reason).toBe("履修中の科目を修得すれば満たします。");
  });

  it("未回答なら読み方で変わる区分を職員確認にし、確定の扱いをしない", () => {
    const required = find(judgments("S0074", {}), "基礎教育 必修");
    expect(required.status).toBe("needs_staff");
    expect(required.ambiguityIds).toContain("retake-disqualified-scope");
    expect(find(judgments("S0074", {}), "卒業要件").status).toBe("needs_staff");
  });

  it("全体の人数は未回答と各読み方で変わらない", async () => {
    expect(await summary({})).toEqual({ total: 300, contact: 28, staffReview: 29, clear: 243 });
    expect(await summary(EXCLUDE)).toEqual({ total: 300, contact: 35, staffReview: 22, clear: 243 });
    expect(await summary(INCLUDE)).toEqual({ total: 300, contact: 28, staffReview: 22, clear: 250 });
  });
});

describe("全問に答えたあと「未回答」と言わない（V-7）", () => {
  const allAnswered: Answers = Object.fromEntries(kamomeGold.ambiguities.map((a) => [a.id, a.options[0]!.id]));
  const reflectable: Answers = Object.fromEntries(
    kamomeGold.ambiguities.filter((a) => a.options[0]!.patches !== null).map((a) => [a.id, a.options[0]!.id]),
  );
  const list = (answers: Answers) => {
    const prepared = prepareRules(kamomeGold, kamomeCourses, answers);
    return listOutreach(
      kamomeStudents.map((student) => evaluatePrepared(prepared, student)),
      kamomeStudents,
    );
  };
  const notes = (answers: Answers) =>
    list(answers)
      .flatMap((entry) => entry.reasons)
      .filter((reason) => reason.mayChange)
      .map((reason) => describeAmounts(reason));

  // 科目数の上限は、演習の科目群の読み方（seminar-courses。差分で表せない）で止まる
  const gateIssues = (answers: Answers) => {
    const student = kamomeStudents.find(({ id }) => id === "K0001")!;
    const { issues } = checkPlan(kamomeGold, kamomeCourses, student, [{ course: "人間科学入門", term: "前期" }], answers);
    return issues.filter((issue) => issue.code === "PENDING_RULE" && issue.ruleId === "seminar-count");
  };

  it("声かけの量の注記: 全問に答えたあとは、反映できない回答があると言う", () => {
    const shown = notes(allAnswered);
    expect(shown.length).toBeGreaterThan(0);
    for (const note of shown) {
      expect(note).not.toContain("未回答");
      expect(note).toContain("判定に反映できない回答があり、変わることがあります");
    }
  });

  it("声かけの量の注記: 未回答が残っていれば、今までの文のまま", () => {
    const shown = notes(reflectable);
    expect(shown.some((note) => note.includes("未回答の確認事項があり、変わることがあります"))).toBe(true);
  });

  it("履修案の検査: 反映できない回答で止まった検査は、回答を促さない", () => {
    const pending = gateIssues(allAnswered);
    expect(pending.length).toBeGreaterThan(0);
    for (const issue of pending) {
      expect(issue.message).not.toContain("未回答");
      expect(issue.hint).not.toContain("回答すると検査できます");
    }
  });

  it("履修案の検査: 未回答があれば、今までどおり回答を促す", () => {
    const pending = gateIssues({});
    expect(pending.length).toBeGreaterThan(0);
    for (const issue of pending) expect(issue.hint).toBe("曖昧箇所に回答すると検査できます。");
  });
});

describe("影響人数は、一覧で実際に動く学生を全て含む（V-5）", () => {
  function states(rules: RuleSet, courses: Course[], students: Student[], answers: Answers) {
    const prepared = prepareRules(rules, courses, answers);
    const evaluations = students.map((student) => evaluatePrepared(prepared, student));
    const candidates = students.filter((_, i) => evaluations[i]!.judgments.some((j) => j.status === "needs_staff"));
    const outreach = listOutreach(evaluations, students, settledStudentIds(rules, courses, candidates, answers));
    const result = new Map<string, StudentState>(outreach.map((entry) => [entry.studentId, entry.kind]));
    for (const { id } of students) if (!result.has(id)) result.set(id, "clear");
    return result;
  }

  const recordedKamome = () => {
    const { rules } = findRecordedProposal("kamome")!;
    return acceptRules(rules, needsReviewIds(rules));
  };

  it("かもめ大学の記録の案: どちらに答えても対応なしへ動く7人を数える", () => {
    const rules = recordedKamome();
    const before = states(rules, kamomeCourses, kamomeStudents, {});
    for (const ambiguityId of ["thesis-retry", "run1-amb-credit-basis"]) {
      const card = computeImpact(rules, kamomeCourses, kamomeStudents, {}, ambiguityId, before);
      expect([ambiguityId, card.affectedStudentIds]).toEqual([
        ambiguityId,
        expect.arrayContaining(["K0012", "K0016", "K0080", "K0112", "K0116", "K0120", "K0148"]),
      ]);
      // 動く学生を「別途、職員確認」に重ねて数えない
      expect(card.staffReviewStudentIds).not.toContain("K0012");
    }
  });

  it("同梱の全ての対象で、回答の前後で一覧の状態が変わる学生は全て数える", () => {
    const targets: [RuleSet, Course[], Student[]][] = [
      [goldRules, sakuradaiCourses, sakuradaiStudents],
      [kamomeGold, kamomeCourses, kamomeStudents],
      [recordedKamome(), kamomeCourses, kamomeStudents],
    ];
    for (const [rules, courses, students] of targets) {
      const before = states(rules, courses, students, {});
      for (const ambiguity of rules.ambiguities) {
        if (ambiguity.options.some((option) => option.patches === null)) continue;
        const card = computeImpact(rules, courses, students, {}, ambiguity.id, before);
        for (const option of ambiguity.options) {
          const after = states(rules, courses, students, { [ambiguity.id]: option.id });
          const moved = students.filter(({ id }) => before.get(id) !== after.get(id)).map(({ id }) => id);
          expect([ambiguity.id, option.id, moved.filter((id) => !card.affectedStudentIds.includes(id))]).toEqual([
            ambiguity.id,
            option.id,
            [],
          ]);
        }
      }
    }
  }, 120000);
});

describe("差分で表せない未回答の先修からは延期見込みを言い切らない（V-3）", () => {
  const ANSWERED = { "seminar-credit-basis": "countable", "retake-disqualified-scope": "include" };

  function withOpenPrerequisites(): RuleSet {
    const rules = structuredClone(goldRules);
    rules.ambiguities.push({
      id: "prerequisite-reading",
      clause: "第11条",
      sourceQuote: rules.prerequisites[0]!.sourceQuote,
      question: "先修の条件は修得を必須としますか。",
      options: [
        { id: "required", label: "必須", patches: null },
        { id: "recommended", label: "推奨にとどめる", patches: null },
      ],
    });
    for (const rule of rules.prerequisites) rule.ambiguityIds = ["prerequisite-reading"];
    return rules;
  }

  function withoutPrerequisites(): RuleSet {
    return { ...structuredClone(goldRules), prerequisites: [] };
  }

  const graduation = (rules: RuleSet, student: Student, answers: Answers = ANSWERED) =>
    find(evaluateStudent(rules, sakuradaiCourses, student, answers).judgments, "卒業要件");

  it("先修がなければ延期見込みにならない学生は、未回答の間は職員確認にする", () => {
    const open = withOpenPrerequisites();
    const none = withoutPrerequisites();
    const hinged = sakuradaiStudents.filter(
      (student) =>
        graduation(goldRules, student).status === "delay_risk" && graduation(none, student).status !== "delay_risk",
    );
    expect(hinged.length).toBeGreaterThan(0);
    for (const student of hinged) {
      const judgment = graduation(open, student);
      expect([student.id, judgment.status, judgment.needsContact]).toEqual([student.id, "needs_staff", false]);
      expect(judgment.ambiguityIds).toContain("prerequisite-reading");
    }
  });

  it("先修がなくても間に合わない学生は、延期見込みのまま", () => {
    const open = withOpenPrerequisites();
    const none = withoutPrerequisites();
    const certain = sakuradaiStudents.filter((student) => graduation(none, student).status === "delay_risk");
    expect(certain.length).toBeGreaterThan(0);
    for (const student of certain) expect([student.id, graduation(open, student).status]).toEqual([student.id, "delay_risk"]);
  });
});

describe("未回答の在学年数で声かけを決めない（V-4）", () => {
  const base = { clause: "第1条", sourceQuote: "根拠" };
  const courses: Course[] = [
    { name: "必修A", credits: 4, assignedYear: 1, groups: ["必修"], offeredIn: "前期" },
    { name: "選択A", credits: 4, assignedYear: 1, groups: ["選択"], offeredIn: "前期" },
  ];
  const rules = (options: RuleSet["ambiguities"][number]["options"], minYears = 4): RuleSet => ({
    id: "t",
    name: "t",
    admissionYears: [2023],
    graduation: { ...base, id: "graduation", minYears, totalCredits: 8, ambiguityIds: ["years"] },
    categories: [
      { ...base, id: "required", name: "必修", groups: ["必修"], minCredits: 4, requireAll: false, overflowTo: null },
      { ...base, id: "elective", name: "選択", groups: ["選択"], minCredits: 0, requireAll: false, overflowTo: null },
    ],
    gates: [],
    loadLimits: [{ ...base, id: "load", maxPerTerm: 30, retakeExclusion: "none" }],
    courseCountLimits: [],
    prerequisites: [],
    ambiguities: [{ id: "years", ...base, question: "何年ですか。", options }],
  });
  const threeOrFour = [
    { id: "three", label: "3年", patches: [{ ruleId: "graduation", field: "minYears", value: 3 }] },
    { id: "four", label: "4年", patches: [{ ruleId: "graduation", field: "minYears", value: 4 }] },
  ];
  const student = (studentYear: number): Student => ({
    id: "T",
    admissionYear: 2023,
    studentYear,
    currentTerm: "後期",
    yearsEnrolled: studentYear,
    specialStatuses: [],
    records: [],
  });
  const judge = (target: RuleSet, year: number, answers: Answers = {}) =>
    evaluateStudent(target, courses, student(year), answers).judgments;
  const kinds = (target: RuleSet, year: number, answers: Answers = {}) =>
    listOutreach([evaluateStudent(target, courses, student(year), answers)], [student(year)]).map(({ kind }) => kind);

  it.each([4, 3])("今の値が %i 年でも、読み方で最終年次かどうかが変わる3年次は職員確認にする", (minYears) => {
    const target = rules(threeOrFour, minYears);
    const category = find(judge(target, 3), "必修");
    expect([category.status, category.needsContact]).toEqual(["needs_staff", false]);
    expect(category.ambiguityIds).toEqual(["years"]);
    expect(kinds(target, 3)).toEqual(["staff_review"]);
  });

  it("確定の区分の不足は、卒業要件を「不足」のままにする（H30）。読み方で変わる声かけは付けない", () => {
    const graduation = find(judge(rules(threeOrFour), 3), "卒業要件");
    expect([graduation.status, graduation.needsContact]).toEqual(["short", false]);
    expect(graduation.reason).toBe("必修に不足があります。");
  });

  it("どの読み方でも最終年次の4年次は、未回答でも声かけにする", () => {
    const list = judge(rules(threeOrFour), 4);
    expect([find(list, "必修").status, find(list, "必修").needsContact]).toEqual(["short", true]);
    expect([find(list, "卒業要件").status, find(list, "卒業要件").needsContact]).toEqual(["short", true]);
  });

  it("どの読み方でも最終年次でない2年次は、未回答でも声かけにしない", () => {
    const list = judge(rules(threeOrFour), 2);
    expect([find(list, "必修").status, find(list, "必修").needsContact]).toEqual(["short", false]);
    expect(kinds(rules(threeOrFour), 2)).toEqual([]);
  });

  it("答えれば読み方どおりになる", () => {
    const target = rules(threeOrFour);
    expect(kinds(target, 3, { years: "three" })).toEqual(["contact"]);
    expect(kinds(target, 3, { years: "four" })).toEqual([]);
  });

  it("差分で表せない読み方があれば、最終年次か分からないので職員確認にする", () => {
    const target = rules([{ id: "other", label: "別の読み方", patches: null }, threeOrFour[1]!]);
    expect(find(judge(target, 2), "必修").status).toBe("needs_staff");
    expect(kinds(target, 2)).toEqual(["staff_review"]);
  });

  it("関係のない項目の曖昧箇所なら、今の値で決める", () => {
    const target = rules([
      { id: "a", label: "8単位", patches: [{ ruleId: "graduation", field: "totalCredits", value: 8 }] },
      { id: "b", label: "12単位", patches: [{ ruleId: "graduation", field: "totalCredits", value: 12 }] },
    ]);
    expect(find(judge(target, 3), "必修").needsContact).toBe(false);
    expect(find(judge(target, 3), "必修").status).toBe("short");
    expect(find(judge(target, 4), "必修").needsContact).toBe(true);
  });
});
