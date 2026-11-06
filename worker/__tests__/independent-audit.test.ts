import { describe, expect, it } from "vitest";
import { sakuradaiCourses } from "../../data/fictional/sakuradai/courses";
import { goldRules } from "../../data/fictional/sakuradai/gold-rules";
import { sakuradaiStudents } from "../../data/fictional/sakuradai/students";
import { evaluateStudent, type Answers, type Judgment } from "../../engine";
import app from "../index";
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
