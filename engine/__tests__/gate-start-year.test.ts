// 追加の監査（2026-11-05）の R-2。判定の年次を過ぎて履修条件を満たしていない学生が、いつから履修できるか。
// 後期の学生は、履修中を足しても満たせなければ今年度中には満たせない。翌年次に満たして、認められるのは翌々年次。
// 前期の学生は、後期の登録で満たせる余地があるので翌年次。期待値はテストのルールから手で求めた。
import { describe, expect, it } from "vitest";
import { evaluateStudent } from "../evaluate";
import type { Course, Student } from "../model";
import type { RuleSet } from "../rules";
import { enrolled, makeStudent, passed } from "./helpers";

const base = { clause: "第1条", sourceQuote: "本文" };

// 必修の Y（前期、2単位）は、2年次の終わりに修得10単位が条件。後から満たせば、その次の年度から履修できる
function rulesWith(retryAfterMet: boolean): RuleSet {
  return {
    id: "mini",
    name: "mini",
    admissionYears: [2024],
    graduation: { id: "graduation", ...base, minYears: 4, totalCredits: 2 },
    categories: [
      { id: "req", ...base, name: "必修", groups: ["必修"], minCredits: 2, requireAll: true, overflowTo: null },
      { id: "opt", ...base, name: "選択", groups: ["選択"], minCredits: 0, requireAll: false, overflowTo: null },
    ],
    gates: [
      {
        id: "gate",
        clause: "第2条",
        sourceQuote: "本文",
        name: "Y の条件",
        target: { kind: "course", courses: ["Y"] },
        checkAtEndOfYear: 2,
        minCredits: 10,
        creditBasis: "earned",
        requiredCourses: [],
        retryAfterMet,
      },
    ],
    loadLimits: [{ id: "load", ...base, maxPerTerm: 24, retakeExclusion: "none" }],
    courseCountLimits: [],
    prerequisites: [],
    ambiguities: [],
  };
}

const courses: Course[] = [
  { name: "Y", credits: 2, assignedYear: 1, groups: ["必修"], offeredIn: "前期" },
  ...["F1", "F2", "F3", "F4", "F5", "F6"].map((name) => ({ name, credits: 2, assignedYear: 1, groups: ["選択"] })),
];

// 修得は F1 の2単位だけで、卒業予定は4年次後期
function student(overrides: Partial<Student>): Student {
  return makeStudent({
    major: undefined,
    studentYear: 3,
    yearsEnrolled: 3,
    expectedGraduation: { studentYear: 4, term: "後期" },
    records: passed(["F1"], 1),
    ...overrides,
  });
}

function judge(target: Student, retryAfterMet = true) {
  const { judgments } = evaluateStudent(rulesWith(retryAfterMet), courses, target, {});
  return {
    graduation: judgments.find(({ kind }) => kind === "graduation")!,
    gate: judgments.find(({ kind }) => kind === "gate")!,
  };
}

describe("判定の年次を過ぎて履修条件を満たしていない学生の、履修できる年次（R-2）", () => {
  it("3年次後期で履修中がない学生は、4年次に満たしても Y は5年次からなので、延期見込みにする", () => {
    const { graduation, gate } = judge(student({}));
    expect(gate).toMatchObject({ status: "short", needsContact: true });
    expect(graduation).toMatchObject({ status: "delay_risk", needsContact: true });
    expect(graduation.reason).toContain("Y");
    expect(graduation.grounds?.map(({ ruleId }) => ruleId)).toContain("gate");
  });

  it("3年次前期の学生は、後期の登録で満たせば4年次前期に Y を履修できるので、延期見込みにしない", () => {
    const { graduation, gate } = judge(student({ currentTerm: "前期" }));
    expect(gate.status).toBe("short");
    expect(graduation).toMatchObject({ status: "short", needsContact: false });
  });

  it("3年次後期でも、履修中を修得すれば満たす学生は、4年次から履修できるので延期見込みにしない", () => {
    const records = [...passed(["F1"], 1), ...enrolled(["F2", "F3", "F4", "F5"], 3, "後期")];
    const { graduation, gate } = judge(student({ records }));
    expect(gate).toMatchObject({ status: "delayed", eligibleFromYear: 4 });
    expect(graduation.status).toBe("short");
  });

  it("判定の年次（2年次）の後期で満たせない学生は、3年次に満たして4年次から履修できるので延期見込みにしない", () => {
    const { graduation, gate } = judge(student({ studentYear: 2, yearsEnrolled: 2 }));
    expect(gate).toMatchObject({ status: "short", atRisk: true });
    expect(graduation.status).toBe("short");
  });

  it("4年次の学生は、前期でも後期でも Y が卒業予定に間に合わない", () => {
    for (const currentTerm of ["前期", "後期"] as const) {
      const { graduation } = judge(student({ studentYear: 4, yearsEnrolled: 4, currentTerm }));
      expect([currentTerm, graduation.status]).toEqual([currentTerm, "delay_risk"]);
    }
  });

  it("判定の年次（2年次）の前期の学生は、後期に満たせる余地があるので、後から認めない条件でも延期見込みにしない", () => {
    const { graduation, gate } = judge(student({ studentYear: 2, yearsEnrolled: 2, currentTerm: "前期" }), false);
    expect(gate).toMatchObject({ status: "short", atRisk: true });
    expect(graduation.status).toBe("short");
  });

  it("後から満たしても認めない条件なら、3年次前期の学生も延期見込みにする", () => {
    const { graduation } = judge(student({ currentTerm: "前期" }), false);
    expect(graduation.status).toBe("delay_risk");
  });
});
