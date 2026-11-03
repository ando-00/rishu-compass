import { describe, expect, it } from "vitest";
import type { Impact, OverviewResponse } from "../../shared/api";
import { buildMeetingSheet } from "../meetingSheet";

const impact: Impact = {
  ambiguityId: "ambiguity-a",
  clause: "第6条",
  sourceQuote: "修得単位が合計60単位以上であること",
  question: "卒業に数えない単位も数えますか。",
  computable: true,
  judged: true,
  options: [
    { id: "include", label: "数える", counts: { short: 3, satisfied: 7 }, reflected: true },
    { id: "exclude", label: "数えない", counts: { short: 5, satisfied: 5 }, reflected: true },
  ],
  affectedStudentIds: ["S0007", "S0095"],
  staffReviewStudentIds: ["S0042"],
  changes: [
    { studentId: "S0007", ruleId: "gate", name: "演習Ⅰ", clause: "第6条", statuses: { include: "satisfied", exclude: "short" } },
    { studentId: "S0095", ruleId: "gate", name: "演習Ⅰ", clause: "第6条", statuses: { include: "satisfied", exclude: "short" } },
  ],
};

const overview: OverviewResponse = {
  summary: { total: 10, contact: 2, staffReview: 1, clear: 7 },
  unanswered: [impact],
  answered: [{ ...impact, ambiguityId: "ambiguity-b", optionId: "include" }],
  outreach: [],
  students: [{ id: "S0007", studentYear: 3, state: "contact" }],
  finalYear: { minYears: 4, studentCount: 0, rows: [] },
};

describe("buildMeetingSheet（確認事項の会議資料。B31）", () => {
  it("未回答の確認事項ごとに、条文、質問、原文、読み方ごとの人数を出す", () => {
    const [item] = buildMeetingSheet(overview).items;
    expect(item).toMatchObject({
      clause: "第6条",
      question: impact.question,
      sourceQuote: impact.sourceQuote,
      affected: 2,
      staffReview: 1,
    });
    expect(item?.options).toEqual([
      { label: "数える", counts: { short: 3, satisfied: 7 }, reflected: true },
      { label: "数えない", counts: { short: 5, satisfied: 5 }, reflected: true },
    ]);
  });

  it("影響の人数は学生の人数で、関わる判定の数ではない", () => {
    const change = impact.changes[0]!;
    const twoRules: Impact = { ...impact, changes: [...impact.changes, { ...change, ruleId: "graduation", name: "卒業要件" }] };
    const [item] = buildMeetingSheet({ ...overview, unanswered: [twoRules] }).items;
    expect(twoRules.changes).toHaveLength(3);
    expect(item?.affected).toBe(2);
  });

  it("学生 ID を含まない", () => {
    const text = JSON.stringify(buildMeetingSheet(overview));
    for (const id of ["S0007", "S0095", "S0042"]) expect(text).not.toContain(id);
  });

  it("全体の人数を添え、回答済みの確認事項は載せない", () => {
    const sheet = buildMeetingSheet(overview);
    expect(sheet.summary).toEqual(overview.summary);
    expect(sheet.items.map((item) => item.ambiguityId)).toEqual(["ambiguity-a"]);
  });
});
