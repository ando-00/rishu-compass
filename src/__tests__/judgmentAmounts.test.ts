import { describe, expect, it } from "vitest";
import type { Judgment } from "../../shared/api";
import { amountCaveat } from "../judgmentAmounts";

const base: Judgment = {
  ruleId: "r1",
  kind: "category",
  name: "自由",
  clause: "第4条",
  sourceQuote: "",
  status: "needs_staff",
  reason: "",
  ambiguityIds: ["a1"],
  needsContact: false,
};

describe("学生別の画面の量に添える文（H36）", () => {
  it("未回答で止まった職員確認に量があれば、変わることがあると添える", () => {
    expect(amountCaveat({ ...base, required: 20, actual: 16 })).toBe("未回答の確認事項があり、変わることがあります");
    expect(amountCaveat({ ...base, missingCourses: ["演習Ⅰ"] })).toBe("未回答の確認事項があり、変わることがあります");
  });

  it("量がなければ添えない", () => {
    expect(amountCaveat(base)).toBeNull();
    expect(amountCaveat({ ...base, missingCourses: [] })).toBeNull();
  });

  it("未回答の確認事項に関わらない職員確認には添えない（編入などの学生）", () => {
    expect(amountCaveat({ ...base, ambiguityIds: [], required: 20, actual: 16 })).toBeNull();
  });

  it("職員確認でない判定には添えない", () => {
    expect(amountCaveat({ ...base, status: "short", required: 20, actual: 16 })).toBeNull();
    expect(amountCaveat({ ...base, status: "satisfied", required: 20, actual: 20 })).toBeNull();
  });
});
