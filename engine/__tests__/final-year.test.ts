import { describe, expect, it } from "vitest";
import { exampleCourses } from "../../data/fictional/example/courses";
import { exampleRules } from "../../data/fictional/example/rules";
import { evaluateStudent } from "../evaluate";
import { summarizeFinalYear } from "../finalYear";
import type { Student } from "../model";
import { makeStudent } from "./helpers";

const answers = { "ambiguity-seminar-credits": "include" };

function summarize(students: Student[]) {
  const evaluations = students.map((student) => evaluateStudent(exampleRules, exampleCourses, student, answers));
  return summarizeFinalYear(exampleRules, students, evaluations);
}

const total = (counts: Record<string, number>) => Object.values(counts).reduce((sum, n) => sum + n, 0);

describe("summarizeFinalYear（4年次の卒業要件の内訳。B33）", () => {
  it("卒業に必要な在学年数（minYears）以上の年次の学生だけを数える", () => {
    const summary = summarize([
      makeStudent({ id: "S0001", studentYear: 4 }),
      makeStudent({ id: "S0002", studentYear: 3 }),
      makeStudent({ id: "S0003", studentYear: 5, yearsEnrolled: 5 }),
    ]);
    expect(summary.minYears).toBe(4);
    expect(summary.studentCount).toBe(2);
  });

  it("卒業要件の行は、判定の5状態の人数の合計が最終年次の人数と一致する", () => {
    const summary = summarize([
      makeStudent({ id: "S0001" }),
      makeStudent({ id: "S0002", specialStatuses: ["編入"] }),
      makeStudent({ id: "S0003", hasMinor: true }),
    ]);
    const graduation = summary.rows.find((row) => row.kind === "graduation");
    expect(graduation?.ruleId).toBe("graduation");
    expect(total(graduation!.counts)).toBe(summary.studentCount);
    expect(graduation!.notApplicable).toBe(0);
  });

  it("区分の行は、5状態の人数と当てはまらない人数の合計が最終年次の人数と一致する", () => {
    const summary = summarize([makeStudent({ id: "S0001" }), makeStudent({ id: "S0002", hasMinor: true })]);
    for (const row of summary.rows) {
      expect(total(row.counts) + row.notApplicable).toBe(summary.studentCount);
    }
    const noMinor = summary.rows.find((row) => row.ruleId === "major-a-no-minor");
    expect(noMinor?.notApplicable).toBe(1);
    expect(total(noMinor!.counts)).toBe(1);
  });

  it("特別な学生（全判定が職員確認）は、どの行でも職員確認に数える", () => {
    const summary = summarize([makeStudent({ id: "S0001", specialStatuses: ["休学"] })]);
    expect(summary.rows.length).toBeGreaterThan(0);
    for (const row of summary.rows) {
      expect(row.counts.needs_staff + row.notApplicable).toBe(1);
    }
  });

  it("修得がない学生は、卒業要件を不足に数える", () => {
    const summary = summarize([makeStudent({ id: "S0001", records: [] })]);
    const graduation = summary.rows.find((row) => row.kind === "graduation");
    expect(graduation?.counts.short).toBe(1);
  });

  it("行は卒業要件のあとに、ルールの区分の順で並ぶ。履修条件（gate）は含めない", () => {
    const summary = summarize([makeStudent({ id: "S0001" })]);
    expect(summary.rows.map((row) => row.ruleId)).toEqual([
      "graduation",
      ...exampleRules.categories.map((category) => category.id),
    ]);
    expect(summary.rows.every((row) => row.kind !== ("gate" as string))).toBe(true);
  });

  it("区分の条件（専攻、副専攻の有無）を添え、条件のない区分には付けない", () => {
    const summary = summarize([makeStudent({ id: "S0001" })]);
    const condition = (id: string) => summary.rows.find((row) => row.ruleId === id)?.condition;
    expect(condition("major-a-no-minor")).toBe("甲専攻・副専攻なし");
    expect(condition("major-a-with-minor")).toBe("甲専攻・副専攻あり");
    expect(condition("basic-required")).toBeUndefined();
    expect(condition("graduation")).toBeUndefined();
  });

  it("判定の並びが学生の並びと違っても、学生 ID で対応させる", () => {
    const students = [makeStudent({ id: "S0001" }), makeStudent({ id: "S0002", specialStatuses: ["留学"] })];
    const evaluations = students.map((student) => evaluateStudent(exampleRules, exampleCourses, student, answers));
    const forward = summarizeFinalYear(exampleRules, students, evaluations);
    const reversed = summarizeFinalYear(exampleRules, students, [...evaluations].reverse());
    expect(reversed).toEqual(forward);
  });

  it("最終年次の学生がいなければ、人数はすべて0", () => {
    const summary = summarize([makeStudent({ id: "S0001", studentYear: 2, yearsEnrolled: 2 })]);
    expect(summary.studentCount).toBe(0);
    for (const row of summary.rows) {
      expect(total(row.counts) + row.notApplicable).toBe(0);
    }
  });
});
