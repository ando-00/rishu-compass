import { describe, expect, it } from "vitest";
import { exampleCourses } from "../../data/fictional/example/courses";
import { exampleRules } from "../../data/fictional/example/rules";
import { computeImpact, computeImpacts } from "../impact";
import { draftOutreachMessage, listOutreach } from "../outreach";
import { evaluateStudent } from "../evaluate";
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
        statuses: { include: "met", exclude: "unmet" },
      }),
    ]);
  });

  it("質問と根拠を返す", () => {
    const impact = computeImpact(exampleRules, exampleCourses, students, {}, ID);
    expect(impact.clause).toBe("第3条");
    expect(impact.question).toContain("30単位");
    expect(impact.options.map((option) => option.id)).toEqual(["include", "exclude"]);
  });

  it("全判定が職員確認の学生は影響人数に入れない", () => {
    const impact = computeImpact(exampleRules, exampleCourses, [excluded], {}, ID);
    expect(impact.affectedStudentIds).toEqual([]);
  });

  it("回答済みの曖昧箇所でも選択肢ごとの差を計算する", () => {
    const impact = computeImpact(exampleRules, exampleCourses, students, { [ID]: "include" }, ID);
    expect(impact.affectedStudentIds).toEqual(["S0001"]);
  });

  it("影響人数は回答の前後で全学生を再計算した差と一致する", () => {
    const statusesOf = (optionId: string) =>
      students.map((student) => ({
        id: student.id,
        statuses: evaluateStudent(exampleRules, exampleCourses, student, {
          [ID]: optionId,
        }).judgments.map((j) => j.status),
      }));
    const included = statusesOf("include");
    const differs = statusesOf("exclude")
      .filter((row, index) => row.statuses.join() !== included[index]!.statuses.join())
      .map((row) => row.id);
    const impact = computeImpact(exampleRules, exampleCourses, students, {}, ID);
    expect(impact.affectedStudentIds).toEqual(differs);
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

  it("声かけ文は下書きとして作り、根拠を含める", () => {
    const [entry] = listOutreach(evaluateAll([swing]), [swing]);
    const draft = draftOutreachMessage(entry!);
    expect(draft).toContain("下書き");
    expect(draft).toContain("第3条");
    expect(draft).not.toContain("大丈夫");
  });
});
