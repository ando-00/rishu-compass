import { describe, expect, it } from "vitest";
import { exampleCourses } from "../../data/fictional/example/courses";
import { exampleRules } from "../../data/fictional/example/rules";
import { evaluateStudent } from "../evaluate";
import type { Answers, Student } from "../model";
import type { RuleSet } from "../rules";
import { enrolled, failed, makeStudent, numberedNames, passed } from "./helpers";

const ANSWERED: Answers = { "ambiguity-seminar-credits": "include" };
const BASIC = ["入門A", "入門B", "基礎C", "基礎D", "基礎E"];
const MAJOR = [...numberedNames("専門", 20)];

function evaluate(student: Student, rules: RuleSet = exampleRules, answers: Answers = ANSWERED) {
  return evaluateStudent(rules, exampleCourses, student, answers);
}

function judgment(student: Student, ruleId: string, rules?: RuleSet, answers?: Answers) {
  const found = evaluate(student, rules, answers).judgments.find((j) => j.ruleId === ruleId);
  if (!found) throw new Error(ruleId);
  return found;
}

const graduate = makeStudent({
  records: [...passed(BASIC), ...passed(MAJOR, 2), ...passed(["応用B", "応用C", "集中"], 3)],
});

describe("区分と卒業の判定", () => {
  it("全区分と合計を満たせば卒業要件を満たす", () => {
    expect(judgment(graduate, "major-a-no-minor").status).toBe("met");
    expect(judgment(graduate, "free").status).toBe("met");
    expect(judgment(graduate, "graduation")).toMatchObject({
      status: "met",
      actual: 52,
      required: 50,
    });
  });

  it("最終年次で区分が不足していれば満たさない", () => {
    const student = makeStudent({ records: passed(BASIC.slice(1)) });
    expect(judgment(student, "basic-required")).toMatchObject({
      status: "unmet",
      missingCourses: ["入門A"],
    });
    expect(judgment(student, "graduation").status).toBe("unmet");
  });

  it("合計が足りていても区分に不足があれば卒業できない", () => {
    const student = makeStudent({
      records: [...passed(BASIC.slice(1)), ...passed(MAJOR, 2), ...passed(["応用B", "応用C"], 3)],
    });
    expect(judgment(student, "graduation").status).toBe("unmet");
  });

  it("最終年次より前の不足は判定待ちにする", () => {
    const student = makeStudent({ studentYear: 2, records: passed(BASIC) });
    expect(judgment(student, "major-a-no-minor").status).toBe("pending");
    expect(judgment(student, "graduation").status).toBe("pending");
  });

  it("履修中の科目を修得すれば足りるなら判定待ちにする", () => {
    const student = makeStudent({
      records: [...passed(BASIC.slice(1)), ...enrolled(["入門A"], 4)],
    });
    expect(judgment(student, "basic-required").status).toBe("pending");
  });

  it("不合格の科目は修得に数えない", () => {
    const student = makeStudent({ records: [...passed(BASIC.slice(1)), ...failed(["入門A"])] });
    expect(judgment(student, "basic-required").status).toBe("unmet");
  });

  it("根拠の条文を返す", () => {
    expect(judgment(graduate, "free").clause).toBe("第2条");
  });
});

describe("履修条件と進級条件の判定", () => {
  const ready = [...BASIC, ...numberedNames("専門", 13)];

  it("進級先の年次にいる学生の進級条件は満たす", () => {
    const student = makeStudent({ studentYear: 3, records: passed(BASIC, 2) });
    expect(judgment(student, "gate-promotion").status).toBe("met");
  });

  it("判定時点で条件を満たせば満たす", () => {
    const student = makeStudent({ studentYear: 3, records: passed(ready, 2) });
    expect(judgment(student, "gate-seminar").status).toBe("met");
  });

  it("判定時点が過ぎて条件を欠き、やり直せないなら満たさない", () => {
    const rules = structuredClone(exampleRules);
    rules.gates[0]!.retryAfterMet = false;
    const student = makeStudent({
      studentYear: 3,
      records: [...passed(ready.slice(1), 2), ...passed(["入門A"], 3)],
    });
    expect(judgment(student, "gate-seminar", rules)).toMatchObject({
      status: "unmet",
      missingCourses: ["入門A"],
    });
  });

  it("判定時点より後の修得は判定時点の単位に数えない", () => {
    const student = makeStudent({
      studentYear: 3,
      records: [...passed(BASIC, 2), ...passed(numberedNames("専門", 13), 3)],
    });
    expect(judgment(student, "gate-seminar").status).toBe("pending");
  });

  it("後から条件を満たせば次の年度から認める", () => {
    const student = makeStudent({
      studentYear: 3,
      records: [...passed(BASIC, 2), ...passed(numberedNames("専門", 13), 3)],
    });
    expect(judgment(student, "gate-seminar").eligibleFromYear).toBe(4);
    expect(judgment({ ...student, studentYear: 4 }, "gate-seminar")).toMatchObject({
      status: "met",
      eligibleFromYear: 4,
    });
  });

  it("後からも満たさなければ満たさない", () => {
    const student = makeStudent({ studentYear: 3, records: passed(BASIC, 2) });
    expect(judgment(student, "gate-seminar").status).toBe("unmet");
  });

  it("判定時点の前で条件を欠いていれば判定待ちにする", () => {
    const student = makeStudent({ studentYear: 2, records: passed(BASIC, 1) });
    expect(judgment(student, "gate-seminar")).toMatchObject({
      status: "pending",
      required: 30,
      actual: 10,
    });
  });

  it("判定年次に履修中を含めても足りなければ危険として印を付ける", () => {
    const student = makeStudent({
      studentYear: 2,
      records: [...passed(BASIC, 1), ...enrolled(["専門01"], 2)],
    });
    expect(judgment(student, "gate-seminar").atRisk).toBe(true);
  });

  it("判定年次に履修中を含めて足りるなら危険の印を付けない", () => {
    const student = makeStudent({
      studentYear: 2,
      records: [...passed(BASIC, 1), ...enrolled(numberedNames("専門", 13), 2)],
    });
    expect(judgment(student, "gate-seminar").atRisk).toBe(false);
  });

  it("卒業に算入される単位で数える条件は算入外の単位を除く", () => {
    const student = makeStudent({
      studentYear: 3,
      records: passed([...BASIC, ...numberedNames("他", 6), ...numberedNames("専門", 7)], 2),
    });
    const answers = { "ambiguity-seminar-credits": "exclude" };
    expect(judgment(student, "gate-seminar", exampleRules, answers)).toMatchObject({
      status: "unmet",
      actual: 28,
    });
  });
});

describe("未確定のルール", () => {
  const student = makeStudent({ studentYear: 3, records: passed(BASIC, 2) });

  it("未回答の曖昧箇所に関わる判定は職員確認を返す", () => {
    expect(judgment(student, "gate-seminar", exampleRules, {})).toMatchObject({
      status: "needs_staff",
      ambiguityIds: ["ambiguity-seminar-credits"],
    });
  });

  it("回答すると通常の判定に戻る", () => {
    expect(judgment(student, "gate-seminar", exampleRules, ANSWERED).status).toBe("unmet");
  });

  it("未確定の区分から超過分を受ける区分も職員確認を返す", () => {
    const rules = structuredClone(exampleRules);
    rules.categories.find((c) => c.id === "major-a-no-minor")!.ambiguityIds = [
      "ambiguity-seminar-credits",
    ];
    expect(judgment(graduate, "free", rules, {}).status).toBe("needs_staff");
    expect(judgment(graduate, "graduation", rules, {}).status).toBe("needs_staff");
  });

  it("未確定の区分があっても確定の区分に不足があれば卒業要件は満たさない", () => {
    const rules = structuredClone(exampleRules);
    rules.categories.find((c) => c.id === "major-a-no-minor")!.ambiguityIds = [
      "ambiguity-seminar-credits",
    ];
    const short = makeStudent({ records: passed(MAJOR, 2) });
    expect(judgment(short, "graduation", rules, {}).status).toBe("unmet");
  });

  it("算入単位で数える条件は未確定の区分があれば職員確認を返す", () => {
    const rules = structuredClone(exampleRules);
    rules.gates[0]!.creditBasis = "countable";
    rules.gates[0]!.ambiguityIds = [];
    rules.categories.find((c) => c.id === "free")!.ambiguityIds = ["ambiguity-seminar-credits"];
    expect(judgment(student, "gate-seminar", rules, {}).status).toBe("needs_staff");
  });
});

describe("全判定を職員確認にする学生", () => {
  it.each(["編入", "休学", "留学", "読替", "既修得認定"] as const)("%s", (status) => {
    const student = { ...graduate, specialStatuses: [status] };
    const result = evaluate(student);
    expect(result.excludedReason).toContain(status);
    expect(result.judgments.length).toBeGreaterThan(0);
    expect(result.judgments.every((j) => j.status === "needs_staff")).toBe(true);
  });

  it("適用外の入学年度", () => {
    const result = evaluate({ ...graduate, admissionYear: 2020 });
    expect(result.excludedReason).toContain("2020");
    expect(result.judgments.every((j) => j.status === "needs_staff")).toBe(true);
  });
});
