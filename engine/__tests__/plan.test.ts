import { describe, expect, it } from "vitest";
import { exampleCourses } from "../../data/fictional/example/courses";
import { exampleRules } from "../../data/fictional/example/rules";
import type { Answers, Course, OfferedTerm, Student } from "../model";
import { checkPlan, isDisplayablePlan, type PlanEntry } from "../plan";
import type { RuleSet } from "../rules";
import { enrolled, failed, makeStudent, numberedNames, passed } from "./helpers";

const ANSWERED: Answers = { "ambiguity-seminar-credits": "include" };
const BASIC = ["入門A", "入門B", "基礎C", "基礎D", "基礎E"];
const sophomore = makeStudent({ studentYear: 2, records: passed(["入門A", "入門B"]) });

function entries(names: string[], term: OfferedTerm = "前期"): PlanEntry[] {
  return names.map((course) => ({ course, term }));
}

function check(
  plan: PlanEntry[],
  student: Student = sophomore,
  options: { rules?: RuleSet; answers?: Answers; courses?: Course[] } = {},
) {
  const { rules = exampleRules, answers = ANSWERED, courses = exampleCourses } = options;
  return checkPlan(rules, courses, student, plan, answers);
}

function ruleIds(result: ReturnType<typeof check>) {
  return result.issues.map((issue) => issue.ruleId);
}

function codes(result: ReturnType<typeof check>) {
  return result.issues.map((issue) => issue.code);
}

describe("履修案の検査", () => {
  it("問題がなければ通す", () => {
    const result = check(entries(["応用B", "専門01"]));
    expect(result).toMatchObject({ status: "passed", issues: [] });
    expect(isDisplayablePlan(result)).toBe(true);
  });

  it("通らない履修案は表示しない", () => {
    const result = check(entries(["存在しない科目"]));
    expect(result.status).toBe("failed");
    expect(isDisplayablePlan(result)).toBe(false);
  });

  it("職員確認の履修案も表示しない", () => {
    const student = { ...sophomore, specialStatuses: ["留学" as const] };
    const result = check(entries(["専門01"]), student);
    expect(result.status).toBe("needs_staff");
    expect(isDisplayablePlan(result)).toBe(false);
  });

  it("同じ科目を二重に入れると通さない", () => {
    expect(check(entries(["専門01", "専門01"])).status).toBe("failed");
  });

  it("履修中の科目を入れると通さない", () => {
    const student = { ...sophomore, records: [...sophomore.records, ...enrolled(["専門01"], 2)] };
    expect(check(entries(["専門01"]), student).status).toBe("failed");
  });
});

describe("学生の条件", () => {
  const novice = makeStudent({ studentYear: 2 });

  it("条件に合わない学生には先修条件を適用しない", () => {
    const rules = structuredClone(exampleRules);
    rules.prerequisites[0]!.when = { major: "乙専攻" };
    expect(check(entries(["応用B"]), novice, { rules }).status).toBe("passed");
  });

  it("条件に合わない学生には科目数の上限を適用しない", () => {
    const rules = structuredClone(exampleRules);
    rules.courseCountLimits[0]!.when = { hasMinor: true };
    rules.courseCountLimits[0]!.maxPerTerm = 0;
    expect(check(entries(["実習"]), sophomore, { rules }).status).toBe("passed");
  });

  it("条件に合わない学生には履修条件を適用しない", () => {
    const rules = structuredClone(exampleRules);
    rules.gates[0]!.when = { hasMinor: true };
    const student = makeStudent({ studentYear: 3, records: passed(["入門A"], 2) });
    expect(ruleIds(check(entries(["ゼミ"], "通年"), student, { rules }))).not.toContain("gate-seminar");
  });
});

describe("履修の基本", () => {
  it("配当年次より前の科目は通さない", () => {
    expect(ruleIds(check(entries(["ゼミ"], "通年")))).toContain("enrollment");
  });

  it("修得済みの科目は通さない", () => {
    expect(ruleIds(check(entries(["入門A"])))).toContain("enrollment");
  });

  it("不合格の科目は再履修できる", () => {
    const student = { ...sophomore, records: failed(["基礎C"]) };
    expect(check(entries(["基礎C"]), student).status).toBe("passed");
  });

  it("開講学期が違う科目は通さない", () => {
    expect(codes(check(entries(["実習"], "後期")))).toContain("NOT_OFFERED");
    expect(codes(check(entries(["実習"], "通年")))).toContain("NOT_OFFERED");
  });
});

describe("先修条件", () => {
  const novice = makeStudent({ studentYear: 2 });

  it("先修科目が未修得なら通さない", () => {
    expect(ruleIds(check(entries(["応用B"]), novice))).toContain("prereq-b");
  });

  it("同じ学期を認めない条件は同じ学期に履修すると通さない", () => {
    const plan = entries(["応用B", "入門B"]);
    expect(ruleIds(check(plan, novice))).toContain("prereq-b");
  });

  it("前の学期に計画した先修科目は認める", () => {
    const plan = [...entries(["入門B"], "前期"), ...entries(["応用B"], "後期")];
    expect(check(plan, novice).status).toBe("passed");
  });

  it("前の学期に履修中の先修科目は認める", () => {
    const student = { ...novice, records: enrolled(["入門B"], 2, "前期") };
    expect(check(entries(["応用B"], "後期"), student).status).toBe("passed");
  });

  it("同じ学期を認める条件は同じ学期に履修してよい", () => {
    expect(check(entries(["応用C", "入門A"]), novice).status).toBe("passed");
  });

  it("かつの組は、すべての修得が必要", () => {
    const rules = structuredClone(exampleRules);
    rules.prerequisites[0]!.conditions = [["入門A", "入門B"]];
    const student = { ...novice, records: passed(["入門A"]) };
    expect(ruleIds(check(entries(["応用B"]), student, { rules }))).toContain("prereq-b");
    const both = { ...novice, records: passed(["入門A", "入門B"]) };
    expect(check(entries(["応用B"]), both, { rules }).status).toBe("passed");
  });

  it("「A または（B かつ C）」のうち、後の組だけを満たしても通す", () => {
    const rules = structuredClone(exampleRules);
    rules.prerequisites[0]!.conditions = [["基礎C"], ["入門A", "入門B"]];
    const student = { ...novice, records: passed(["入門A", "入門B"]) };
    expect(check(entries(["応用B"]), student, { rules }).status).toBe("passed");
  });

  it("どれか1つの修得で足りる条件を扱える", () => {
    const student = { ...novice, records: passed(["入門B"]) };
    expect(check(entries(["応用C"]), student).status).toBe("passed");
  });
});

describe("履修上限", () => {
  const names = numberedNames("専門", 11);

  it("学期の上限を超えると通さない", () => {
    expect(ruleIds(check(entries(names)))).toContain("load-normal");
  });

  it("学期の上限ちょうどなら通す", () => {
    expect(check(entries(names.slice(0, 10))).status).toBe("passed");
  });

  it("年間の上限を超えると通さない", () => {
    const rules = structuredClone(exampleRules);
    rules.loadLimits[0]!.maxPerYear = 26;
    const plan = [...entries(names.slice(0, 8), "前期"), ...entries(numberedNames("他", 6), "後期")];
    expect(ruleIds(check(plan, sophomore, { rules }))).toContain("load-normal");
  });

  it("緩和の条件に合えば緩和後の上限を使う", () => {
    const student = { ...sophomore, previousGpa: 3.5 };
    expect(check(entries(names), student).status).toBe("passed");
    expect(check(entries(names), { ...student, previousGpa: 3.4 }).status).toBe("failed");
  });

  it("同じ年次に登録済みの科目も上限に数える", () => {
    const student = {
      ...sophomore,
      records: [...sophomore.records, ...enrolled(numberedNames("乙", 8), 2)],
    };
    expect(ruleIds(check(entries(names.slice(0, 3)), student))).toContain("load-normal");
  });

  it("通年の科目は単位の半分を各学期に数える", () => {
    const student = makeStudent({
      studentYear: 3,
      records: passed(["入門A", "入門B", "基礎C", "基礎D", "基礎E", ...numberedNames("他", 3)], 2).concat(
        passed(numberedNames("乙", 8), 2),
      ),
    });
    const plan = [...entries(["ゼミ"], "通年"), ...entries(names.slice(0, 9))];
    expect(check(plan, student).status).toBe("passed");
    expect(check([...plan, ...entries(["専門10"])], student).status).toBe("failed");
  });

  it("再履修を数えない上限は再履修科目を除く", () => {
    const rules = structuredClone(exampleRules);
    rules.loadLimits[0]!.retakeExclusion = "failed";
    const student = { ...sophomore, records: failed(["専門11"]) };
    expect(check(entries(names), student, { rules }).status).toBe("passed");
    expect(check(entries(names), student).status).toBe("failed");
  });

  it("年間の上限ちょうどなら通す", () => {
    const rules = structuredClone(exampleRules);
    rules.loadLimits[0]!.maxPerYear = 28;
    const plan = [...entries(names.slice(0, 8), "前期"), ...entries(numberedNames("他", 6), "後期")];
    expect(check(plan, sophomore, { rules }).status).toBe("passed");
  });

  it("通年の科目は後期にも半分を数える", () => {
    const student = makeStudent({
      studentYear: 3,
      records: passed([...BASIC, ...numberedNames("他", 3), ...numberedNames("乙", 8)], 2),
    });
    const plan = [...entries(["ゼミ"], "通年"), ...entries(names.slice(0, 10), "後期")];
    expect(ruleIds(check(plan, student))).toContain("load-normal");
  });

  it("適用する上限がない学生は職員確認にする", () => {
    const rules = structuredClone(exampleRules);
    rules.loadLimits = rules.loadLimits.slice(1);
    const result = check(entries(["専門01"]), sophomore, { rules });
    expect(result.status).toBe("needs_staff");
    expect(codes(result)).toEqual(["PENDING_RULE"]);
  });
});

describe("科目数の上限と時間割", () => {
  it("同じ学期の科目数の上限を超えると通さない", () => {
    const student = makeStudent({
      studentYear: 3,
      records: passed(["入門A", "入門B", "基礎C", "基礎D", "基礎E", ...numberedNames("他", 3)], 2).concat(
        passed(numberedNames("乙", 8), 2),
      ),
    });
    const plan = [...entries(["ゼミ"], "通年"), ...entries(["実習"], "前期")];
    expect(ruleIds(check(plan, student))).toContain("count-seminar");
  });

  it("同じ時限の科目は通さない", () => {
    expect(ruleIds(check(entries(["実習", "講読"])))).toContain("timetable");
  });

  it("集中講義は、履修案のどの位置にあっても時間割の重なりを判定しない", () => {
    const courses = exampleCourses.map((course) =>
      course.name === "集中" ? { ...course, slots: [{ day: "月", period: 1 }] } : course,
    );
    expect(ruleIds(check(entries(["集中", "実習"]), sophomore, { courses }))).not.toContain("timetable");
    expect(ruleIds(check(entries(["実習", "集中"]), sophomore, { courses }))).not.toContain("timetable");
  });

  it("別の学期なら同じ時限でも通す", () => {
    const courses = exampleCourses.map((course) =>
      course.name === "講読" ? { ...course, offeredIn: "後期" as const } : course,
    );
    const plan = [...entries(["実習"], "前期"), ...entries(["講読"], "後期")];
    expect(check(plan, sophomore, { courses }).status).toBe("passed");
  });

  it("別のクォーターなら同じ時限でも通す", () => {
    const courses: Course[] = [
      ...exampleCourses,
      { name: "第一", credits: 1, assignedYear: 1, groups: [], slots: [{ day: "火", period: 2, quarter: 1 }] },
      { name: "第二", credits: 1, assignedYear: 1, groups: [], slots: [{ day: "火", period: 2, quarter: 2 }] },
    ];
    expect(check(entries(["第一", "第二"]), sophomore, { courses }).status).toBe("passed");
  });
});

describe("履修条件", () => {
  const unready = makeStudent({ studentYear: 3, records: passed(["入門A", "入門B"], 2) });
  const ready = makeStudent({
    studentYear: 3,
    records: passed(["入門A", "入門B", "基礎C", "基礎D", "基礎E", ...numberedNames("乙", 8), ...numberedNames("他", 3)], 2),
  });

  it("条件を満たさない学生の科目は通さない", () => {
    expect(ruleIds(check(entries(["ゼミ"], "通年"), unready))).toContain("gate-seminar");
  });

  it("条件を満たす学生の科目は通す", () => {
    expect(check(entries(["ゼミ"], "通年"), ready).status).toBe("passed");
  });

  it("未回答の曖昧箇所に関わる科目は職員確認を返す", () => {
    const result = check(entries(["ゼミ"], "通年"), ready, { answers: {} });
    expect(result.status).toBe("needs_staff");
    expect(result.issues[0]).toMatchObject({
      ruleId: "gate-seminar",
      code: "PENDING_RULE",
      ambiguityIds: ["ambiguity-seminar-credits"],
    });
  });

  it("未回答でも関係しない科目は確定の検査を返す", () => {
    expect(check(entries(["専門01"]), ready, { answers: {} }).status).toBe("passed");
  });
});

describe("未確定のルール", () => {
  it("未確定の先修条件に関わる科目は職員確認を返す", () => {
    const rules = structuredClone(exampleRules);
    rules.prerequisites[0]!.ambiguityIds = ["ambiguity-seminar-credits"];
    expect(check(entries(["応用B"]), sophomore, { rules, answers: {} }).status).toBe("needs_staff");
  });

  it("未確定の履修上限が適用されると職員確認を返す", () => {
    const rules = structuredClone(exampleRules);
    rules.loadLimits[0]!.ambiguityIds = ["ambiguity-seminar-credits"];
    expect(check(entries(["専門01"]), sophomore, { rules, answers: {} }).status).toBe("needs_staff");
  });

  it("未確定の履修の基本は職員確認を返す", () => {
    const rules = structuredClone(exampleRules);
    rules.enrollment!.ambiguityIds = ["ambiguity-seminar-credits"];
    expect(check(entries(["専門01"]), sophomore, { rules, answers: {} }).status).toBe("needs_staff");
  });

  it("未確定の科目数の上限は、その科目群を入れたときに職員確認を返す", () => {
    const rules = structuredClone(exampleRules);
    rules.courseCountLimits[0]!.ambiguityIds = ["ambiguity-seminar-credits"];
    expect(check(entries(["実習"]), sophomore, { rules, answers: {} }).status).toBe("needs_staff");
    expect(check(entries(["専門01"]), sophomore, { rules, answers: {} }).status).toBe("passed");
  });

  it("要確認のルールは職員確認を返す", () => {
    const rules = structuredClone(exampleRules);
    rules.prerequisites[0]!.status = "needs_review";
    expect(check(entries(["応用B"]), sophomore, { rules }).status).toBe("needs_staff");
  });

  it("確定の違反があれば職員確認より不可を優先する", () => {
    const plan = [...entries(["ゼミ"], "通年"), ...entries(["入門A"])];
    expect(check(plan, sophomore, { answers: {} }).status).toBe("failed");
  });
});
