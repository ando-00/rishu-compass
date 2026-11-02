import { describe, expect, it } from "vitest";
import { sakuradaiCourses } from "../../data/fictional/sakuradai/courses";
import { goldRules } from "../../data/fictional/sakuradai/gold-rules";
import handbook from "../../data/fictional/sakuradai/handbook.md?raw";
import { sakuradaiStudents } from "../../data/fictional/sakuradai/students";
import {
  collectQuotes,
  evaluateStudent,
  validateRuleSet,
  verifyQuotes,
  type Answers,
} from "../../engine";
import { datasetsResponseSchema, overviewResponseSchema } from "../../shared/api";
import app from "../index";

const QUESTION = "seminar-credit-basis";

function statusOf(student: (typeof sakuradaiStudents)[number], ruleId: string, optionId?: string) {
  const answers: Answers = optionId ? { [QUESTION]: optionId } : {};
  const { judgments } = evaluateStudent(goldRules, sakuradaiCourses, student, answers);
  return judgments.find((judgment) => judgment.ruleId === ruleId)?.status;
}

describe("さくら台大学の正解ルール", () => {
  it("参照がすべて実在する", () => {
    expect(validateRuleSet(goldRules, sakuradaiCourses)).toEqual([]);
  });

  it("根拠の文がすべて要項に実在する", () => {
    expect(verifyQuotes(collectQuotes(goldRules), handbook)).toEqual([]);
  });

  it("区分の最低単位の合計が卒業単位と合う", () => {
    const total = goldRules.categories.reduce((sum, category) => sum + category.minCredits, 0);
    expect(total).toBe(goldRules.graduation.totalCredits);
  });

  it("必修の区分の科目の単位が最低単位と合う", () => {
    for (const category of goldRules.categories.filter((c) => c.requireAll)) {
      const credits = sakuradaiCourses
        .filter((course) => course.groups.some((group) => category.groups.includes(group)))
        .reduce((sum, course) => sum + course.credits, 0);
      expect(credits).toBe(category.minCredits);
    }
  });

  it("画面の対象に入る", async () => {
    const res = await app.request("/api/datasets");
    const { datasets } = datasetsResponseSchema.parse(await res.json());
    expect(datasets.find((dataset) => dataset.id === "sakuradai")).toMatchObject({ problems: [] });
  });
});

describe("第6条の曖昧箇所", () => {
  const inScope = sakuradaiStudents.filter((student) => {
    const { excludedReason } = evaluateStudent(goldRules, sakuradaiCourses, student, {});
    return excludedReason === null;
  });

  it("未回答なら、適用対象の全学生の履修条件が職員確認になる", () => {
    expect(inScope.length).toBeGreaterThan(0);
    for (const student of inScope) {
      expect(statusOf(student, "gate-seminar")).toBe("needs_staff");
    }
  });

  it("読み方で履修条件の判定が変わる学生がいる", () => {
    const changed = inScope.filter(
      (student) =>
        statusOf(student, "gate-seminar", "earned") !== statusOf(student, "gate-seminar", "countable"),
    );
    expect(changed.length).toBeGreaterThan(0);
  });

  it("卒業に数える単位で読むと、延期見込みが増える", () => {
    const delayed = (optionId: string) =>
      inScope.filter((student) => statusOf(student, "graduation", optionId) === "delay_risk").length;
    expect(delayed("countable")).toBeGreaterThan(delayed("earned"));
  });

  it("回答すると全学生の判定に反映される", async () => {
    const overview = async (answers: Record<string, string>) => {
      const res = await app.request("/api/datasets/sakuradai/overview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      expect(res.status).toBe(200);
      return overviewResponseSchema.parse(await res.json());
    };
    const before = await overview({});
    const after = await overview({ [QUESTION]: "countable" });
    expect(before.unanswered).toHaveLength(1);
    expect(after.unanswered).toHaveLength(0);
    expect(after.summary.contact).toBeGreaterThan(before.summary.contact);
    expect(after.summary.staffReview).toBeLessThan(before.summary.staffReview);
  });
});
