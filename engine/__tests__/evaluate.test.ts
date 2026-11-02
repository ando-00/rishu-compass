import { describe, expect, it } from "vitest";
import { exampleCourses } from "../../data/fictional/example/courses";
import { exampleRules } from "../../data/fictional/example/rules";
import { evaluateStudent } from "../evaluate";
import type { Answers, Student } from "../model";
import type { RuleSet } from "../rules";
import { enrolled, failed, makeStudent, numberedNames, passed } from "./helpers";

const ID = "ambiguity-seminar-credits";
const ANSWERED: Answers = { [ID]: "include" };
const BASIC = ["入門A", "入門B", "基礎C", "基礎D", "基礎E"];
const MAJOR = numberedNames("専門", 20);

function judgment(student: Student, ruleId: string, rules = exampleRules, answers = ANSWERED) {
  const result = evaluateStudent(rules, exampleCourses, student, answers);
  const found = result.judgments.find((j) => j.ruleId === ruleId);
  if (!found) throw new Error(ruleId);
  return found;
}

const graduate = makeStudent({
  records: [...passed(BASIC), ...passed(MAJOR, 2), ...passed(["応用B", "応用C", "集中"], 3)],
});

function withCategoryAmbiguity(rules: RuleSet, categoryId: string) {
  const changed = structuredClone(rules);
  changed.categories.find((c) => c.id === categoryId)!.ambiguityIds = [ID];
  return changed;
}

describe("区分と卒業の判定", () => {
  it("全区分と合計を満たせば卒業要件は充足", () => {
    expect(judgment(graduate, "major-a-no-minor").status).toBe("satisfied");
    expect(judgment(graduate, "free").status).toBe("satisfied");
    expect(judgment(graduate, "graduation")).toMatchObject({
      status: "satisfied",
      actual: 52,
      required: 50,
    });
  });

  it("最終年次で区分が不足していれば不足で、声かけの対象にする", () => {
    const student = makeStudent({ records: passed(BASIC.slice(1)) });
    expect(judgment(student, "basic-required")).toMatchObject({
      status: "short",
      missingCourses: ["入門A"],
      needsContact: true,
    });
    expect(judgment(student, "graduation")).toMatchObject({ status: "short", needsContact: true });
  });

  it("合計が足りていても区分に不足があれば卒業は不足", () => {
    const student = makeStudent({
      records: [...passed(BASIC.slice(1)), ...passed(MAJOR, 2), ...passed(["応用B", "応用C"], 3)],
    });
    expect(judgment(student, "graduation").status).toBe("short");
  });

  it("全区分を満たしていても合計が足りなければ卒業は不足", () => {
    const rules = structuredClone(exampleRules);
    rules.graduation.totalCredits = 53;
    expect(judgment(graduate, "graduation", rules).status).toBe("short");
  });

  it("在学中の不足は声かけの対象にしない", () => {
    const student = makeStudent({ studentYear: 2, records: passed(BASIC) });
    expect(judgment(student, "major-a-no-minor")).toMatchObject({ status: "short", needsContact: false });
    expect(judgment(student, "graduation")).toMatchObject({ status: "short", needsContact: false });
  });

  it("履修中の科目を修得すれば足りるなら見込み", () => {
    const student = makeStudent({
      records: [...passed(BASIC.slice(1)), ...enrolled(["入門A"], 4)],
    });
    expect(judgment(student, "basic-required")).toMatchObject({
      status: "expected",
      actual: 8,
      enrolled: 2,
    });
  });

  it("不合格の科目は修得に数えない", () => {
    const student = makeStudent({ records: [...passed(BASIC.slice(1)), ...failed(["入門A"])] });
    expect(judgment(student, "basic-required").status).toBe("short");
  });

  it("根拠の条文と文を返す", () => {
    expect(judgment(graduate, "free")).toMatchObject({
      clause: "第2条",
      sourceQuote: "見本の第2条の本文",
    });
  });

  it("どの区分にも入らない修得科目を根拠に示す", () => {
    const student = makeStudent({ records: [...graduate.records, ...passed(["乙01"], 3)] });
    expect(judgment(student, "graduation").uncountedCourses).toEqual(["乙01"]);
  });
});

describe("履修条件と進級条件の判定", () => {
  const ready = [...BASIC, ...numberedNames("専門", 13)];

  it("進級先の年次にいる学生の進級条件は充足", () => {
    const student = makeStudent({ studentYear: 3, records: passed(BASIC, 2) });
    expect(judgment(student, "gate-promotion").status).toBe("satisfied");
  });

  it("判定時点で条件を満たせば充足", () => {
    const student = makeStudent({ studentYear: 3, records: passed(ready, 2) });
    expect(judgment(student, "gate-seminar").status).toBe("satisfied");
  });

  it("判定時点が過ぎて条件を欠き、やり直せないなら不足", () => {
    const rules = structuredClone(exampleRules);
    rules.gates[0]!.retryAfterMet = false;
    const student = makeStudent({
      studentYear: 3,
      records: [...passed(ready.slice(1), 2), ...passed(["入門A"], 3)],
    });
    expect(judgment(student, "gate-seminar", rules)).toMatchObject({
      status: "short",
      missingCourses: ["入門A"],
      needsContact: true,
    });
  });

  it("判定時点より後の修得は判定時点の単位に数えない", () => {
    const student = makeStudent({
      studentYear: 3,
      records: [...passed(BASIC, 2), ...passed(numberedNames("専門", 13), 3)],
    });
    expect(judgment(student, "gate-seminar").status).toBe("expected");
  });

  it("後から条件を満たせば次の年度から認める", () => {
    const student = makeStudent({
      studentYear: 3,
      records: [...passed(BASIC, 2), ...passed(numberedNames("専門", 13), 3)],
    });
    expect(judgment(student, "gate-seminar").eligibleFromYear).toBe(4);
    expect(judgment({ ...student, studentYear: 4 }, "gate-seminar")).toMatchObject({
      status: "satisfied",
      eligibleFromYear: 4,
    });
  });

  it("後からも満たさなければ不足で、声かけの対象にする", () => {
    const student = makeStudent({ studentYear: 3, records: passed(BASIC, 2) });
    expect(judgment(student, "gate-seminar")).toMatchObject({ status: "short", needsContact: true });
  });

  it("判定年次に足りなければ危険の印を付け、声かけの対象にする", () => {
    const student = makeStudent({ studentYear: 2, records: passed(BASIC, 1) });
    expect(judgment(student, "gate-seminar")).toMatchObject({
      status: "short",
      required: 30,
      actual: 10,
      atRisk: true,
      needsContact: true,
    });
  });

  it("判定年次より前の不足は声かけの対象にしない", () => {
    const student = makeStudent({ studentYear: 1, records: passed(BASIC, 1) });
    expect(judgment(student, "gate-seminar")).toMatchObject({
      status: "short",
      atRisk: false,
      needsContact: false,
    });
  });

  it("判定年次に履修中を含めて足りるなら見込み", () => {
    const student = makeStudent({
      studentYear: 2,
      records: [...passed(BASIC, 1), ...enrolled(numberedNames("専門", 13), 2)],
    });
    expect(judgment(student, "gate-seminar").status).toBe("expected");
  });

  it("卒業に数える単位で数える条件は算入外の単位を除く", () => {
    const student = makeStudent({
      studentYear: 3,
      records: passed([...BASIC, ...numberedNames("他", 6), ...numberedNames("専門", 7)], 2),
    });
    expect(judgment(student, "gate-seminar", exampleRules, { [ID]: "exclude" })).toMatchObject({
      status: "short",
      actual: 28,
    });
  });

  it("修得が必要な科目に履修中を認める条件を扱える", () => {
    const rules = structuredClone(exampleRules);
    rules.gates[0]!.requiredMayBeEnrolled = true;
    const student = makeStudent({
      studentYear: 3,
      records: [...passed(ready.slice(1), 2), ...enrolled(["入門A"], 3)],
    });
    expect(judgment(student, "gate-seminar", rules).status).toBe("satisfied");
  });

  it("条件に合わない学生には履修条件を返さない", () => {
    const rules = structuredClone(exampleRules);
    rules.gates[0]!.when = { hasMinor: true };
    const { judgments } = evaluateStudent(rules, exampleCourses, graduate, ANSWERED);
    expect(judgments.map((j) => j.ruleId)).not.toContain("gate-seminar");
  });

  it("条件に合わない学生には進級条件を返さない", () => {
    const rules = structuredClone(exampleRules);
    rules.gates[1]!.when = { minStudentYear: 5 };
    const { judgments } = evaluateStudent(rules, exampleCourses, graduate, ANSWERED);
    expect(judgments.map((j) => j.ruleId)).not.toContain("gate-promotion");
  });
});

describe("未確定のルール", () => {
  const student = makeStudent({ studentYear: 3, records: passed(BASIC, 2) });

  it("未回答の曖昧箇所に関わる判定は職員確認を返す", () => {
    expect(judgment(student, "gate-seminar", exampleRules, {})).toMatchObject({
      status: "needs_staff",
      ambiguityIds: [ID],
      needsContact: false,
    });
  });

  it("数値上満たしていても、未回答なら充足にしない", () => {
    const ready = makeStudent({
      studentYear: 3,
      records: passed([...BASIC, ...numberedNames("専門", 13)], 2),
    });
    expect(judgment(ready, "gate-seminar", exampleRules, {}).status).toBe("needs_staff");
  });

  it("回答すると通常の判定に戻る", () => {
    expect(judgment(student, "gate-seminar").status).toBe("short");
  });

  it("要確認のルールは職員確認を返す", () => {
    const rules = structuredClone(exampleRules);
    rules.categories[0]!.status = "needs_review";
    expect(judgment(graduate, "basic-required", rules).status).toBe("needs_staff");
    expect(judgment(graduate, "graduation", rules).status).toBe("needs_staff");
  });

  it("卒業要件そのものが未確定なら職員確認を返す", () => {
    const rules = structuredClone(exampleRules);
    rules.graduation.ambiguityIds = [ID];
    expect(judgment(graduate, "graduation", rules, {}).status).toBe("needs_staff");
  });

  it("未確定の区分から超過分を受ける区分も職員確認を返す", () => {
    const rules = withCategoryAmbiguity(exampleRules, "major-a-no-minor");
    expect(judgment(graduate, "free", rules, {}).status).toBe("needs_staff");
    expect(judgment(graduate, "graduation", rules, {}).status).toBe("needs_staff");
  });

  it("未確定の区分があっても確定の区分に不足があれば卒業は不足", () => {
    const rules = withCategoryAmbiguity(exampleRules, "major-a-no-minor");
    const short = makeStudent({ records: passed(MAJOR, 2) });
    expect(judgment(short, "graduation", rules, {}).status).toBe("short");
  });

  it("卒業に数える単位で数える条件は、未確定の区分があれば職員確認を返す", () => {
    const rules = withCategoryAmbiguity(exampleRules, "free");
    rules.gates[0]!.creditBasis = "countable";
    rules.gates[0]!.ambiguityIds = [];
    rules.ambiguities[0]!.options = [{ id: "only", label: "保留", patches: null }];
    expect(judgment(student, "gate-seminar", rules, {}).status).toBe("needs_staff");
  });
});

describe("延期見込み", () => {
  const fourth = (overrides: Partial<Student> = {}) =>
    makeStudent({
      currentTerm: "前期",
      expectedGraduation: { studentYear: 4, term: "後期" },
      ...overrides,
    });

  it("卒業予定がなければ延期見込みを判定しない", () => {
    const student = makeStudent({ currentTerm: "前期", records: passed(BASIC) });
    expect(judgment(student, "graduation").status).toBe("short");
  });

  it("不足が残りの上限ちょうどなら延期見込みにしない", () => {
    const student = fourth({ records: passed([...BASIC, ...numberedNames("専門", 10)]) });
    expect(judgment(student, "graduation").status).toBe("short");
  });

  it("不足が残りの上限を超えれば延期見込みで、声かけの対象にする", () => {
    const student = fourth({ records: passed(BASIC) });
    expect(judgment(student, "graduation")).toMatchObject({
      status: "delay_risk",
      needsContact: true,
    });
  });

  it("再履修を上限から除く大学では、単位数だけでは延期見込みにせず職員確認にする", () => {
    const rules = structuredClone(exampleRules);
    rules.loadLimits[0]!.retakeExclusion = "failed";
    rules.loadLimits[1]!.retakeExclusion = "failed";
    const student = fourth({ records: passed(BASIC) });
    expect(judgment(student, "graduation", rules).status).toBe("needs_staff");
  });

  it("不足の必修が残りの開講学期に履修できなければ延期見込み", () => {
    const courses = exampleCourses.map((course) =>
      course.name === "実習" ? { ...course, groups: ["基礎/必修"] } : course,
    );
    const student = makeStudent({
      currentTerm: "後期",
      expectedGraduation: { studentYear: 5, term: "前期" },
      records: passed([...BASIC, ...numberedNames("専門", 20)]),
    });
    const graduationOf = (target: Student) =>
      evaluateStudent(exampleRules, courses, target, ANSWERED).judgments.find(
        (j) => j.ruleId === "graduation",
      );
    expect(graduationOf(student)?.status).toBe("short");
    const lastTerm = { ...student, expectedGraduation: { studentYear: 4, term: "後期" as const } };
    expect(graduationOf(lastTerm)?.status).toBe("delay_risk");
  });
});

describe("延期見込みの学期の数え方", () => {
  it("開講学期が残っていなければ、学期が残っていても延期見込み", () => {
    const courses = exampleCourses.map((course) =>
      course.name === "実習" ? { ...course, groups: ["基礎/必修"] } : course,
    );
    const student = makeStudent({
      currentTerm: "前期",
      expectedGraduation: { studentYear: 4, term: "後期" },
      records: passed([...BASIC, ...numberedNames("専門", 20)]),
    });
    const result = evaluateStudent(exampleRules, courses, student, ANSWERED);
    expect(result.judgments.find((j) => j.ruleId === "graduation")?.status).toBe("delay_risk");
  });

  it("先修科目と同じ学期に履修できない必修は、次の学期までかかる", () => {
    const courses = exampleCourses.map((course) =>
      course.name === "応用B" ? { ...course, groups: ["基礎/必修"] } : course,
    );
    const rules = structuredClone(exampleRules);
    rules.categories[0]!.minCredits = 8;
    const student = makeStudent({
      currentTerm: "前期",
      expectedGraduation: { studentYear: 4, term: "後期" },
      records: passed([...BASIC.filter((name) => name !== "入門B"), ...numberedNames("専門", 20)]),
    });
    const graduationOf = (target: typeof rules) =>
      evaluateStudent(target, courses, student, ANSWERED).judgments.find(
        (j) => j.ruleId === "graduation",
      );
    expect(graduationOf(rules)?.status).toBe("delay_risk");
    const sameTerm = structuredClone(rules);
    sameTerm.prerequisites[0]!.allowSameTerm = true;
    expect(graduationOf(sameTerm)?.status).toBe("short");
  });
});

describe("ルールに問題があるとき", () => {
  it("学生に適用されない算入先があれば、その学生を職員確認にして処理を止めない", () => {
    const rules = structuredClone(exampleRules);
    rules.categories.find((c) => c.id === "major-a-no-minor")!.overflowTo = "minor-a";
    const result = evaluateStudent(rules, exampleCourses, graduate, ANSWERED);
    expect(result.excludedReason).toContain("minor-a");
    expect(result.judgments.every((j) => j.status === "needs_staff")).toBe(true);
  });

  it("適用できない回答があれば、全判定を職員確認にする", () => {
    const rules = structuredClone(exampleRules);
    rules.ambiguities[0]!.options[0]!.patches = [
      { ruleId: "load-normal", field: "maxPerTerm", value: "24" },
    ];
    const result = evaluateStudent(rules, exampleCourses, graduate, ANSWERED);
    expect(result.judgments.every((j) => j.status === "needs_staff")).toBe(true);
  });

  it("ルールが想定していない専攻の学生は職員確認にする", () => {
    const result = evaluateStudent(exampleRules, exampleCourses, { ...graduate, major: "丙専攻" }, ANSWERED);
    expect(result.excludedReason).toContain("専攻");
  });
});
