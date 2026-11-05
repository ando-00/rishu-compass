// 追加の監査（2026-11-05）の R-1。前期の学生の案は同じ年度の登録なので、履修条件が未確定か未達で
// 記録から外した履修中の科目も、今年度の登録としては残っている。先修の前提にはしないが、
// 上限、時間割、科目数、重複の検査では数える。期待値はテストのルールと科目から手で求めた。
import { describe, expect, it } from "vitest";
import type { Answers, Course, Student } from "../model";
import { checkPlan, heldRegistrations, lockedEnrollments, planningStudent, unresolvedEnrollments, type PlanEntry } from "../plan";
import type { RuleSet } from "../rules";
import { enrolled, makeStudent, passed } from "./helpers";

const base = { clause: "第1条", sourceQuote: "本文" };
const course = (name: string, credits: number, offeredIn: Course["offeredIn"], day: string, period: number, groups = ["科目"]): Course => ({
  name,
  credits,
  assignedYear: 1,
  groups,
  offeredIn,
  slots: [{ day, period }],
});

// ゼミ（通年4単位、月曜1限、演習）は、1年次の終わりに修得10単位が条件。学期の上限は8単位、演習は学期に1科目まで
const courses: Course[] = [
  course("基礎", 2, "前期", "木", 2),
  course("ゼミ", 4, "通年", "月", 1, ["科目", "演習"]),
  course("A", 2, "後期", "火", 1),
  course("B", 2, "後期", "水", 1),
  course("C", 2, "後期", "木", 1),
  course("D", 2, "後期", "金", 1),
  course("月曜", 2, "後期", "月", 1),
  course("実習", 2, "後期", "火", 2, ["科目", "演習"]),
  course("発展", 2, "後期", "水", 2),
];

const rules: RuleSet = {
  id: "mini",
  name: "mini",
  admissionYears: [2024],
  graduation: { id: "graduation", ...base, minYears: 4, totalCredits: 0 },
  categories: [{ id: "all", ...base, name: "科目", groups: ["科目"], minCredits: 0, requireAll: false, overflowTo: null }],
  gates: [
    {
      id: "gate",
      ...base,
      name: "ゼミの条件",
      target: { kind: "course", courses: ["ゼミ"] },
      checkAtEndOfYear: 1,
      minCredits: 10,
      creditBasis: "earned",
      requiredCourses: [],
      retryAfterMet: true,
      ambiguityIds: ["basis"],
    },
  ],
  loadLimits: [{ id: "load", ...base, maxPerTerm: 8, retakeExclusion: "none" }],
  courseCountLimits: [{ id: "count", ...base, group: "演習", maxPerTerm: 1 }],
  prerequisites: [{ id: "pre", ...base, course: "発展", conditions: [["ゼミ"]], allowSameTerm: true }],
  ambiguities: [
    {
      id: "basis",
      clause: "第2条",
      sourceQuote: "本文",
      question: "必要な単位",
      options: [
        { id: "two", label: "2単位", patches: [{ ruleId: "gate", field: "minCredits", value: 2 }] },
        { id: "ten", label: "10単位", patches: [{ ruleId: "gate", field: "minCredits", value: 10 }] },
      ],
    },
  ],
};

// 2年次前期。修得は2単位で、ゼミを今年度に履修中。「10単位」ならゼミの条件は未達、「2単位」なら充足、未回答なら未確定
const spring: Student = makeStudent({
  major: undefined,
  studentYear: 2,
  yearsEnrolled: 2,
  currentTerm: "前期",
  records: [...passed(["基礎"], 1), ...enrolled(["ゼミ"], 2, "通年")],
});

// worker の planningTarget と同じ組み立て
function check(student: Student, plan: PlanEntry[], answers: Answers) {
  const locked = lockedEnrollments(rules, courses, student, answers);
  return checkPlan(rules, courses, planningStudent(student, locked), plan, answers, {
    pendingCourses: unresolvedEnrollments(rules, courses, student, answers),
    heldRegistrations: heldRegistrations(student, locked),
  });
}

const codes = (student: Student, plan: PlanEntry[], answers: Answers) =>
  check(student, plan, answers).issues.map(({ code }) => code);
const later = (names: string[]): PlanEntry[] => names.map((name) => ({ course: name, term: "後期" }));

const READINGS: [string, Answers][] = [
  ["未回答", {}],
  ["条件を満たす読み方", { basis: "two" }],
  ["条件を満たさない読み方", { basis: "ten" }],
];

describe("前期の学生の、記録から外した今年度の登録（R-1）", () => {
  it("前提: 未回答と満たさない読み方ではゼミを記録から外し、満たす読み方では外さない", () => {
    expect(lockedEnrollments(rules, courses, spring, {})).toEqual(["ゼミ"]);
    expect(lockedEnrollments(rules, courses, spring, { basis: "ten" })).toEqual(["ゼミ"]);
    expect(lockedEnrollments(rules, courses, spring, { basis: "two" })).toEqual([]);
  });

  it("外した科目の今年度の登録を、科目と学期で返す", () => {
    expect(heldRegistrations(spring, ["ゼミ"])).toEqual([{ course: "ゼミ", term: "通年" }]);
    expect(heldRegistrations(spring, [])).toEqual([]);
  });

  it("後期の学生の案は翌年度の登録なので、今年度の登録を持ち越さない", () => {
    expect(heldRegistrations({ ...spring, currentTerm: "後期" }, ["ゼミ"])).toEqual([]);
  });

  it("前の年度の履修中の記録は、今年度の登録に数えない", () => {
    const stale = { ...spring, records: [...passed(["基礎"], 1), ...enrolled(["ゼミ"], 1, "通年")] };
    expect(heldRegistrations(stale, ["ゼミ"])).toEqual([]);
  });

  it.each(READINGS)("%s: 後期8単位の案は、ゼミの半分の2単位を足して10単位になり、上限8単位を超える", (_, answers) => {
    const result = check(spring, later(["A", "B", "C", "D"]), answers);
    expect(result.status).toBe("failed");
    expect(result.issues.find(({ code }) => code === "OVER_LIMIT")?.message).toContain("後期の履修単位 10");
  });

  it.each(READINGS)("%s: 後期6単位の案は、ゼミの半分を足して8単位ちょうどで通る", (_, answers) => {
    expect(check(spring, later(["A", "B", "C"]), answers).status).toBe("passed");
  });

  it.each(READINGS)("%s: ゼミと同じ月曜1限の科目は、時限が重なる", (_, answers) => {
    expect(codes(spring, later(["月曜"]), answers)).toContain("TIME_CONFLICT");
  });

  it.each(READINGS)("%s: 演習はゼミで学期の1科目を使っているので、実習を足すと科目数の上限を超える", (_, answers) => {
    expect(codes(spring, later(["実習"]), answers)).toContain("CATEGORY_LIMIT");
  });

  it.each(READINGS)("%s: 登録が残っているゼミを案に入れると、履修中として止める", (_, answers) => {
    const result = check(spring, [{ course: "ゼミ", term: "通年" }], answers);
    expect(result.issues.some(({ code, message }) => code === "ALREADY_EARNED" && message.includes("履修中"))).toBe(true);
  });

  it("外した科目は、登録が残っていても先修の前提にしない", () => {
    // 満たさない読み方ではゼミの履修が認められないので、ゼミが前提の発展は不合格
    expect(codes(spring, later(["発展"]), { basis: "ten" })).toContain("PREREQUISITE_NOT_MET");
    // 未回答では決まらないので、不合格と言い切らず職員確認
    const open = check(spring, later(["発展"]), {});
    expect(open.status).toBe("needs_staff");
    expect(open.issues.map(({ code }) => code)).not.toContain("PREREQUISITE_NOT_MET");
    // 満たす読み方なら、同じ学期に履修中のゼミを前提にできる
    expect(check(spring, later(["発展"]), { basis: "two" }).status).toBe("passed");
  });

  it("前提を渡さなければ、今までどおり外した科目を数えない", () => {
    const locked = lockedEnrollments(rules, courses, spring, {});
    const result = checkPlan(rules, courses, planningStudent(spring, locked), later(["A", "B", "C", "D"]), {});
    expect(result.issues.map(({ code }) => code)).not.toContain("OVER_LIMIT");
  });
});
