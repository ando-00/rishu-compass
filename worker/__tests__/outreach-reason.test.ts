import { describe, expect, it } from "vitest";
import { sakuradaiCourses } from "../../data/fictional/sakuradai/courses";
import { goldRules } from "../../data/fictional/sakuradai/gold-rules";
import { sakuradaiStudents } from "../../data/fictional/sakuradai/students";
import { draftOutreachMessage, evaluateStudent, listOutreach } from "../../engine";

const answers = { "seminar-credit-basis": "countable" };
const student = sakuradaiStudents.find(({ id }) => id === "S0095")!;

function outreach() {
  const evaluation = evaluateStudent(goldRules, sakuradaiCourses, student, answers);
  return listOutreach([evaluation], [student], new Set([student.id]))[0]!;
}

describe("声かけの理由に発端の条文を示す（A2-7）", () => {
  it("間に合わない科目を理由に書く", () => {
    const delay = outreach().reasons.find(({ status }) => status === "delay_risk")!;
    expect(delay.detail).toContain("演習Ⅱ");
    expect(delay.detail).toContain("間に合わない");
  });

  it("履修条件と先修の条文を根拠に含める", () => {
    const delay = outreach().reasons.find(({ status }) => status === "delay_risk")!;
    const clauses = delay.grounds?.map(({ clause }) => clause) ?? [];
    expect(clauses).toContain("第6条、第7条");
    expect(clauses).toContain("第11条");
  });

  it("根拠の文は要項の本文のままである", () => {
    const delay = outreach().reasons.find(({ status }) => status === "delay_risk")!;
    for (const { sourceQuote } of delay.grounds ?? []) expect(sourceQuote.length).toBeGreaterThan(0);
  });

  it("声かけ文の下書きにも間に合わない科目が出る", () => {
    expect(draftOutreachMessage(outreach())).toContain("演習Ⅱ");
  });
});
