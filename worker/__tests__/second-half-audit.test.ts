import { describe, expect, it } from "vitest";
import { kamomeCourses } from "../../data/fictional/kamome/courses";
import { goldRules as kamomeRules } from "../../data/fictional/kamome/gold-rules";
import { kamomeStudents } from "../../data/fictional/kamome/students";
import { sakuradaiCourses } from "../../data/fictional/sakuradai/courses";
import { goldRules as sakuradaiRules } from "../../data/fictional/sakuradai/gold-rules";
import { sakuradaiStudents } from "../../data/fictional/sakuradai/students";
import { evaluateStudent } from "../../engine";

// 監査の第2.5回の A25-4 と A25-5。判定は変えず、理由の文と示す単位数だけを直す。

describe("判定に反映できない回答のあとの理由（A25-4）", () => {
  const allAnswered = Object.fromEntries(kamomeRules.ambiguities.map((a) => [a.id, a.options[0]!.id]));
  const student = kamomeStudents.find((s) => s.id === "K0004")!;

  it("全てに答えたあとは「未回答」と言わず、反映できない回答があると言う", () => {
    const stuck = evaluateStudent(kamomeRules, kamomeCourses, student, allAnswered).judgments.filter(
      (j) => j.status === "needs_staff",
    );
    expect(stuck.length).toBeGreaterThan(0);
    for (const judgment of stuck) {
      expect(judgment.reason).not.toContain("未回答");
      expect(judgment.reason).toContain("判定に反映できない回答");
    }
  });

  it("未回答のものが残るあいだは、今までどおり未回答と言う", () => {
    const stuck = evaluateStudent(kamomeRules, kamomeCourses, student, {}).judgments.filter(
      (j) => j.status === "needs_staff",
    );
    expect(stuck.some((j) => j.reason.includes("未回答"))).toBe(true);
  });
});

describe("第6条の単位数の時点（A25-5）", () => {
  const student = sakuradaiStudents.find((s) => s.id === "S0007")!;
  const gate = (option: string) =>
    evaluateStudent(sakuradaiRules, sakuradaiCourses, student, { "seminar-credit-basis": option }).judgments.find(
      (j) => j.ruleId === "gate-seminar",
    )!;

  it("判定の時点で満たさずあとから満たした学生は、判定の時点の単位数を理由に示す", () => {
    const later = gate("countable");
    expect(later.status).toBe("delayed");
    // 判定の時点（2年次の終わり）の算入単位は60に届かない
    expect(later.reason).toMatch(/2年次の終わりの時点では \d+ 単位/);
    const atCheck = Number(/時点では (\d+) 単位/.exec(later.reason)![1]);
    expect(atCheck).toBeLessThan(60);
  });

  it("判定は変えない", () => {
    // H29 で状態の名前だけが「遅れ」（delayed）に変わった。認める年次は変わらない
    expect(gate("countable")).toMatchObject({ status: "delayed", eligibleFromYear: 4 });
    expect(gate("earned")).toMatchObject({ status: "satisfied", actual: 60 });
  });
});

// H29（2026-11-05 作り手の決定）: 第6条の表の「見込み」には、順調な学生と、判定の時点に満たさず次の年度から認める学生が
// 混ざっていた（28人＝20人＋8人、34人＝20人＋14人）。後者を「遅れ」に分け、回答で変わる6人がそこに出る
describe("第6条の読み方ごとの人数で、見込みと遅れを分ける（H29）", () => {
  it("見込みは読み方によらず20人、遅れは8人と14人", async () => {
    const { computeImpacts } = await import("../../engine");
    const card = computeImpacts(sakuradaiRules, sakuradaiCourses, sakuradaiStudents, {}).find(
      ({ ambiguityId }) => ambiguityId === "seminar-credit-basis",
    )!;
    const counts = Object.fromEntries(card.options.map(({ id, counts }) => [id, counts]));
    expect(counts.earned).toMatchObject({ expected: 20, delayed: 8 });
    expect(counts.countable).toMatchObject({ expected: 20, delayed: 14 });
  });
});
