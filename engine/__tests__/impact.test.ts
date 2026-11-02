import { describe, expect, it } from "vitest";
import { exampleCourses } from "../../data/fictional/example/courses";
import { exampleRules } from "../../data/fictional/example/rules";
import { computeImpact, computeImpacts } from "../impact";
import { draftOutreachMessage, listOutreach } from "../outreach";
import { exampleStudents } from "../../data/fictional/example/students";
import { evaluateStudent, type Judgment, type JudgmentStatus } from "../evaluate";
import type { Answers } from "../model";
import { makeStudent, numberedNames, passed } from "./helpers";

const BASIC = ["入門A", "入門B", "基礎C", "基礎D", "基礎E"];
const ID = "ambiguity-seminar-credits";

// 他学部の単位を含めるかどうかで、条件の30単位に届くかが変わる学生
const swing = makeStudent({
  id: "S0001",
  studentYear: 3,
  records: passed([...BASIC, ...numberedNames("他", 6), ...numberedNames("専門", 7)], 2),
});
const steady = makeStudent({
  id: "S0002",
  studentYear: 3,
  records: passed([...BASIC, ...numberedNames("専門", 13)], 2),
});
const excluded = { ...swing, id: "S0003", specialStatuses: ["休学" as const] };
const students = [swing, steady, excluded];

describe("computeImpact", () => {
  it("回答によって判定が変わる学生を返す", () => {
    const impact = computeImpact(exampleRules, exampleCourses, students, {}, ID);
    expect(impact.affectedStudentIds).toEqual(["S0001"]);
    expect(impact.changes).toEqual([
      expect.objectContaining({
        studentId: "S0001",
        ruleId: "gate-seminar",
        statuses: { include: "satisfied", exclude: "short" },
      }),
    ]);
  });

  it("質問と根拠を返す", () => {
    const impact = computeImpact(exampleRules, exampleCourses, students, {}, ID);
    expect(impact.clause).toBe("第3条");
    expect(impact.question).toContain("30単位");
    expect(impact.options.map((option) => option.id)).toEqual(["include", "exclude"]);
    expect(impact.sourceQuote).toBe("見本の第3条の本文");
  });

  it("全判定が職員確認の学生は影響人数に入れない", () => {
    const impact = computeImpact(exampleRules, exampleCourses, [excluded], {}, ID);
    expect(impact.affectedStudentIds).toEqual([]);
  });

  it("回答済みの曖昧箇所でも選択肢ごとの差を計算する", () => {
    const impact = computeImpact(exampleRules, exampleCourses, students, { [ID]: "include" }, ID);
    expect(impact.affectedStudentIds).toEqual(["S0001"]);
  });

  it("影響人数は読み方どうしで全学生を再計算した差と一致する", () => {
    const population = exampleStudents;
    const statusesOf = (optionId: string) =>
      population.map((student) => ({
        id: student.id,
        statuses: evaluateStudent(exampleRules, exampleCourses, student, {
          [ID]: optionId,
        }).judgments.map((j) => `${j.status}:${j.needsContact}`),
      }));
    const included = statusesOf("include");
    const differs = statusesOf("exclude")
      .filter((row, index) => row.statuses.join() !== included[index]!.statuses.join())
      .map((row) => row.id);
    const impact = computeImpact(exampleRules, exampleCourses, population, {}, ID);
    expect(differs.length).toBeGreaterThan(0);
    expect(impact.affectedStudentIds).toEqual(differs);
  });

  it("状態が同じでも、声かけの対象が変わる学生を影響人数に数える", () => {
    const rules = structuredClone(exampleRules);
    rules.ambiguities[0]!.options[0]!.patches = [
      { ruleId: "gate-seminar", field: "checkAtEndOfYear", value: 2 },
    ];
    rules.ambiguities[0]!.options[1]!.patches = [
      { ruleId: "gate-seminar", field: "checkAtEndOfYear", value: 3 },
    ];
    const student = makeStudent({ studentYear: 2, records: passed(BASIC, 1) });
    const impact = computeImpact(rules, exampleCourses, [student], {}, ID);
    expect(impact.affectedStudentIds).toEqual([student.id]);
  });

  it("影響人数に入る学生は、職員確認の人数に重ねて数えない", () => {
    const rules = structuredClone(exampleRules);
    rules.graduation.ambiguityIds = ["ambiguity-other"];
    rules.ambiguities.push({
      id: "ambiguity-other",
      clause: "第1条",
      sourceQuote: "見本の第1条の本文",
      question: "別の確認事項",
      options: [{ id: "only", label: "保留", patches: null }],
    });
    const impact = computeImpact(rules, exampleCourses, [swing], {}, ID);
    expect(impact.affectedStudentIds).toEqual(["S0001"]);
    expect(impact.staffReviewStudentIds).toEqual([]);
  });

  it("存在しない曖昧箇所はエラーにする", () => {
    expect(() => computeImpact(exampleRules, exampleCourses, students, {}, "unknown")).toThrow(
      "unknown",
    );
  });
});

describe("computeImpacts", () => {
  it("未回答の曖昧箇所を影響人数の多い順に返す", () => {
    const rules = structuredClone(exampleRules);
    rules.ambiguities.unshift({
      id: "ambiguity-none",
      clause: "第9条",
      sourceQuote: "見本の第9条の本文",
      question: "影響のない確認事項",
      options: [{ id: "only", label: "一つだけ", patches: [] }],
    });
    const impacts = computeImpacts(rules, exampleCourses, students, {});
    expect(impacts.map((impact) => impact.ambiguityId)).toEqual([ID, "ambiguity-none"]);
  });

  it("回答済みの曖昧箇所は含めない", () => {
    expect(computeImpacts(exampleRules, exampleCourses, students, { [ID]: "include" })).toEqual([]);
  });
});

describe("声かけ", () => {
  const answers: Answers = { [ID]: "exclude" };
  const evaluateAll = (list = students, used = answers) =>
    list.map((student) => evaluateStudent(exampleRules, exampleCourses, student, used));

  it("満たさない判定がある学生を根拠つきで返す", () => {
    const list = listOutreach(evaluateAll(), students);
    expect(list.find((entry) => entry.studentId === "S0001")).toMatchObject({
      kind: "contact",
      reasons: expect.arrayContaining([
        expect.objectContaining({ ruleId: "gate-seminar", clause: "第3条" }),
      ]),
    });
  });

  it("問題のない学生は返さない", () => {
    const list = listOutreach(evaluateAll([steady]), [steady]);
    expect(list).toEqual([]);
  });

  it("危険の印が付いた判定待ちの学生を返す", () => {
    const risky = makeStudent({ id: "S0004", studentYear: 2, records: passed(BASIC, 1) });
    const list = listOutreach(evaluateAll([risky]), [risky]);
    expect(list[0]?.kind).toBe("contact");
  });

  it("職員確認だけの学生は職員確認として返す", () => {
    const list = listOutreach(evaluateAll([excluded]), [excluded]);
    expect(list[0]?.kind).toBe("staff_review");
  });

  it("未回答の曖昧箇所だけに関わる学生は職員確認として返す", () => {
    const list = listOutreach(evaluateAll([steady], {}), [steady]);
    expect(list[0]?.kind).toBe("staff_review");
  });

  it("どの読み方でも対応が要らないと確かめた学生は、未回答でも職員確認に入れない", () => {
    expect(listOutreach(evaluateAll([steady], {}), [steady], new Set([steady.id]))).toEqual([]);
  });

  it("全判定が職員確認の学生は、確かめたものとして渡されても職員確認に入れる", () => {
    const list = listOutreach(evaluateAll([excluded]), [excluded], new Set([excluded.id]));
    expect(list[0]?.kind).toBe("staff_review");
  });

  it("危険度の高い順に並べる", () => {
    const risky = makeStudent({ id: "S0005", studentYear: 2, records: passed(BASIC, 1) });
    const delayed = makeStudent({
      id: "S0006",
      studentYear: 4,
      currentTerm: "前期",
      expectedGraduation: { studentYear: 4, term: "後期" },
      records: passed(BASIC, 1),
    });
    const list = [risky, swing, delayed];
    const order = listOutreach(evaluateAll(list), list).map((entry) => entry.studentId);
    expect(order).toEqual(["S0006", "S0001", "S0005"]);
  });

  it("年次より危険度を優先して並べる", () => {
    const judgment = (status: JudgmentStatus, atRisk = false): Judgment => ({
      ruleId: "rule",
      kind: status === "delay_risk" ? "graduation" : "gate",
      name: "判定",
      clause: "第1条",
      sourceQuote: "本文",
      status,
      reason: "理由",
      ambiguityIds: [],
      needsContact: true,
      atRisk,
    });
    const evaluation = (studentId: string, status: JudgmentStatus, atRisk?: boolean) => ({
      studentId,
      excludedReason: null,
      judgments: [judgment(status, atRisk)],
    });
    const people = [
      makeStudent({ id: "A", studentYear: 4 }),
      makeStudent({ id: "B", studentYear: 2 }),
      makeStudent({ id: "C", studentYear: 3 }),
    ];
    const list = listOutreach(
      [evaluation("A", "short", true), evaluation("B", "delay_risk"), evaluation("C", "short")],
      people,
    );
    expect(list.map((entry) => entry.studentId)).toEqual(["B", "C", "A"]);
  });

  it("声かけ文の下書きに、職員確認の理由を入れない", () => {
    const draft = draftOutreachMessage({
      studentId: "S0001",
      studentYear: 3,
      kind: "contact",
      severity: 2,
      reasons: [
        { ruleId: "a", name: "不足の判定", clause: "第1条", sourceQuote: "", status: "short", detail: "不足" },
        { ruleId: "b", name: "内部の判定", clause: "第2条", sourceQuote: "", status: "needs_staff", detail: "確認" },
      ],
    });
    expect(draft).toContain("不足の判定");
    expect(draft).not.toContain("内部の判定");
  });

  it("声かけ文は下書きとして作り、根拠を含める", () => {
    const [entry] = listOutreach(evaluateAll([swing]), [swing]);
    const draft = draftOutreachMessage(entry!);
    expect(draft).toContain("下書き");
    expect(draft).toContain("第3条");
    expect(draft).not.toContain("大丈夫");
  });
});
