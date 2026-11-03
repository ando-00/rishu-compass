import { describe, expect, it } from "vitest";
import { exampleCourses } from "../../data/fictional/example/courses";
import { exampleRules } from "../../data/fictional/example/rules";
import { evaluateStudent } from "../evaluate";
import { describeAmounts, draftOutreachMessage, listOutreach } from "../outreach";
import { makeStudent, passed } from "./helpers";

// H14 の A（B23）。声かけの理由と定型の下書きに、不足の量（必要・修得・履修中・未修得の必修）を出す。
// 職員確認の判定には数値を出さない（未確定を確定に見せない）。
const ID = "ambiguity-seminar-credits";

function entryFor(answers: Record<string, string>) {
  const student = makeStudent({ studentYear: 4, yearsEnrolled: 4, records: passed(["入門A", "基礎C"], 1) });
  const evaluation = evaluateStudent(exampleRules, exampleCourses, student, answers);
  const [entry] = listOutreach([evaluation], [student]);
  expect(entry).toBeDefined();
  return entry!;
}

describe("声かけの理由の不足の量", () => {
  it("不足の判定には、必要・修得・履修中の単位と未修得の必修科目を付ける", () => {
    const entry = entryFor({ [ID]: "include" });
    const short = entry.reasons.filter((r) => r.status === "short" && r.required !== undefined);
    expect(short.length).toBeGreaterThan(0);
    for (const reason of short) {
      expect(typeof reason.actual).toBe("number");
      expect(reason.actual!).toBeLessThan(reason.required!);
    }
    expect(entry.reasons.some((r) => (r.missingCourses?.length ?? 0) > 0)).toBe(true);
  });

  it("職員確認の判定には数値を付けない", () => {
    const entry = entryFor({});
    const review = entry.reasons.filter((r) => r.status === "needs_staff");
    expect(review.length).toBeGreaterThan(0);
    for (const reason of review) {
      expect(reason.required).toBeUndefined();
      expect(reason.actual).toBeUndefined();
      expect(reason.enrolled).toBeUndefined();
      expect(reason.missingCourses).toBeUndefined();
    }
  });

  // H19 の決定。区分に未回答の確認事項が残っても、確定の区分に不足があれば卒業要件は「不足」になる（AGENTS.md）。
  // その量は回答で変わりうるので、出したまま注記を添える
  it("区分に未回答が残る卒業要件の不足には、量に「変わることがあります」と添える", () => {
    const rules = {
      ...exampleRules,
      categories: exampleRules.categories.map((category) =>
        category.id === "free" ? { ...category, ambiguityIds: [ID] } : category,
      ),
    };
    const student = makeStudent({ studentYear: 4, yearsEnrolled: 4, records: passed(["入門A", "基礎C"], 1) });
    const [entry] = listOutreach([evaluateStudent(rules, exampleCourses, student, {})], [student]);
    const graduation = entry!.reasons.find((reason) => reason.ruleId === "graduation")!;
    expect(graduation.status).toBe("short");
    expect(graduation.mayChange).toBe(true);
    expect(describeAmounts(graduation)).toContain(`修得 ${graduation.actual} / 必要 ${graduation.required} 単位`);
    expect(describeAmounts(graduation)).toContain("未回答の確認事項があり、変わることがあります");
    expect(draftOutreachMessage(entry!)).toContain("未回答の確認事項があり、変わることがあります");
  });

  it("未回答の確認事項に関わらない判定には添えない", () => {
    const entry = entryFor({ [ID]: "include" });
    for (const reason of entry.reasons) {
      expect(reason.mayChange).toBeUndefined();
      expect(describeAmounts(reason)).not.toContain("変わることがあります");
    }
  });

  it("定型の下書きに不足の量を書く", () => {
    const entry = entryFor({ [ID]: "include" });
    const draft = draftOutreachMessage(entry);
    const short = entry.reasons.find((r) => r.status === "short" && r.required !== undefined)!;
    expect(draft).toContain(`修得 ${short.actual} / 必要 ${short.required} 単位`);
    expect(draft).toMatch(/未修得: /);
  });
});
