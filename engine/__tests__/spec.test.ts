import { describe, expect, it } from "vitest";
import { allocateCredits } from "../credits";
import { evaluateStudent } from "../evaluate";
import { computeImpact } from "../impact";
import { indexCourses, type Answers, type Course, type Student, type Term } from "../model";
import { checkPlan, type PlanEntry } from "../plan";
import { kamomeSpecCourses, kamomeSpecRules } from "./fixtures/spec-kamome";
import { SEMINAR_REQUIRED, specCourses, specRules } from "./fixtures/spec-sakuradai";
import { disqualified, enrolled, failed, makeStudent, passed } from "./helpers";

const EARNED: Answers = { "credit-basis": "earned" };
const COUNTABLE: Answers = { "credit-basis": "countable" };

function names(prefix: string, count: number) {
  return Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);
}

// 全区分を最低単位ちょうどで満たす124単位。自由は他学科10単位と超過分10単位。
const REQUIRED = [...names("基礎必修", 4), ...SEMINAR_REQUIRED, ...names("専門必修", 6), "演習Ⅰ", "演習Ⅱ"];
const EXACT = [
  ...REQUIRED,
  ...names("基礎選必", 3),
  ...names("基礎選択", 5),
  ...names("専選必", 8),
  ...names("専選", 23),
  ...names("他学科", 5),
];

function judgment(student: Student, ruleId: string, answers: Answers = EARNED) {
  const result = evaluateStudent(specRules, specCourses, student, answers);
  const found = result.judgments.find((j) => j.ruleId === ruleId);
  if (!found) throw new Error(ruleId);
  return found;
}

function freeCategory(courses: string[]) {
  const student = makeStudent();
  const { categories } = allocateCredits(
    specRules,
    indexCourses(specCourses),
    student,
    new Set(courses),
  );
  return categories.find((c) => c.categoryId === "free")!;
}

function codes(
  plan: PlanEntry[],
  student: Student = makeStudent({ studentYear: 2 }),
  answers: Answers = EARNED,
) {
  return checkPlan(specRules, specCourses, student, plan, answers).issues.map((i) => i.code);
}

function entries(list: string[], term: PlanEntry["term"] = "前期"): PlanEntry[] {
  return list.map((course) => ({ course, term }));
}

// 指定の単位になる履修案を作る。一単位科目で端数を合わせる。
function planOf(credits: number, term: Term, offset = 0): PlanEntry[] {
  const plan = entries(names("専選", 30).slice(offset, offset + Math.floor(credits / 2)), term);
  return credits % 2 === 1 ? [...plan, { course: "一単位科目", term }] : plan;
}

describe("さくら台大学の卒業判定", () => {
  it("T01 全区分と総単位をちょうど満たすと、卒業は充足", () => {
    expect(judgment(makeStudent({ records: passed(EXACT) }), "graduation")).toMatchObject({
      status: "satisfied",
      actual: 124,
      required: 124,
    });
  });

  it("T02 総単位130で選択必修が2単位不足なら、卒業は不足で区分不足を示す", () => {
    const records = passed([
      ...REQUIRED,
      ...names("基礎選必", 3),
      ...names("基礎選択", 5),
      ...names("専選必", 7),
      ...names("専選", 27),
      ...names("他学科", 5),
    ]);
    const result = judgment(makeStudent({ records }), "graduation");
    expect(result).toMatchObject({ status: "short", earned: 130 });
    expect(result.shortCategories).toEqual(["専門/選択必修"]);
  });

  it("T03 総単位が123なら、卒業は不足", () => {
    const records = passed([...EXACT.filter((name) => name !== "専選23"), "一単位科目"]);
    const result = judgment(makeStudent({ records }), "graduation");
    expect(result).toMatchObject({ status: "short", earned: 123 });
  });

  it("T04 超過分が自由単位の上限20ちょうどなら、20を全部算入", () => {
    expect(freeCategory(names("専選", 28))).toMatchObject({ received: 20, counted: 20, lost: 0 });
  });

  it("T05 超過分が自由単位の上限を超えると、20までを算入し、残りは総単位に入れない", () => {
    expect(freeCategory(names("専選", 30))).toMatchObject({ received: 24, counted: 20, lost: 4 });
  });

  it("T06 他学科科目が10単位なら、10を全部算入", () => {
    expect(freeCategory(names("他学科", 5))).toMatchObject({ direct: 10, counted: 10, lost: 0 });
  });

  it("T07 他学科科目が12単位なら、10までを算入", () => {
    expect(freeCategory(names("他学科", 6))).toMatchObject({ direct: 10, counted: 10, lost: 2 });
  });

  it("T11 履修中を含めて全区分を満たすと、卒業は見込み", () => {
    const records = [...passed(EXACT.filter((n) => n !== "演習Ⅱ")), ...enrolled(["演習Ⅱ"], 4, "通年")];
    expect(judgment(makeStudent({ records }), "graduation").status).toBe("expected");
  });

  it("T18 4年次の不足単位が残りの上限を超えると、卒業は延期見込み", () => {
    const student = makeStudent({
      currentTerm: "前期",
      expectedGraduation: { studentYear: 4, term: "後期" },
      records: passed(EXACT.slice(0, 40)),
    });
    expect(judgment(student, "graduation").status).toBe("delay_risk");
  });

  it("T25 超過分18単位と他学科12単位なら、他学科は10まで、自由へは合計20を算入", () => {
    const free = freeCategory([...names("専選", 27), ...names("他学科", 6)]);
    expect(free).toMatchObject({ direct: 10, received: 18, counted: 20, lost: 10 });
  });

  it("T33 在学3年で単位を満たしても、卒業は充足にしない", () => {
    const student = makeStudent({ studentYear: 3, yearsEnrolled: 3, records: passed(EXACT) });
    const result = judgment(student, "graduation");
    expect(result.status).not.toBe("satisfied");
    expect(result.reason).toContain("在学年数");
  });
});

// 修得60単位。うち4科目は指定必修。
const SIXTY = [
  ...SEMINAR_REQUIRED,
  ...names("基礎必修", 4),
  ...names("基礎選必", 3),
  ...names("基礎選択", 5),
  ...names("専門必修", 2),
  ...names("専選必", 10),
  ...names("専選", 2),
];

const seminarReady = (records: string[], year = 2) =>
  makeStudent({ studentYear: 3, records: passed(records, year) });

// 修得60単位、うち他学科12単位
const SWING = [
  ...SEMINAR_REQUIRED,
  ...names("基礎必修", 4),
  ...names("基礎選必", 3),
  ...names("基礎選択", 5),
  ...names("専門必修", 2),
  ...names("専選必", 6),
  ...names("他学科", 6),
];

describe("演習Ⅰの履修条件", () => {
  it("T08 2年次終了時に60単位で指定必修4科目を修得すると、ゼミ履修可", () => {
    expect(SIXTY.length * 2).toBe(60);
    expect(judgment(seminarReady(SIXTY), "gate-seminar").status).toBe("satisfied");
  });

  it("T09 59単位で指定必修4科目を修得すると、ゼミ履修不可", () => {
    const list = [...SIXTY.filter((n) => n !== "専選必10"), "一単位科目"];
    const result = judgment(seminarReady(list), "gate-seminar");
    expect(result).toMatchObject({ status: "short", actual: 59 });
    expect(codes(entries(["演習Ⅰ"], "通年"), seminarReady(list))).toContain("SEMINAR_LOCKED");
  });

  it("T10 60単位で指定必修が3科目なら、ゼミ履修不可", () => {
    const list = [...SIXTY.filter((n) => n !== "指定D"), "専選3"];
    expect(judgment(seminarReady(list), "gate-seminar")).toMatchObject({
      status: "short",
      actual: 60,
      missingCourses: ["指定D"],
    });
  });

  it("T26 2年次終了時に58単位、3年次終了時に条件を満たすと、3年次は履修できず4年次は履修可", () => {
    const early = SIXTY.slice(0, -1);
    const third = makeStudent({
      studentYear: 3,
      records: [...passed(early, 2), ...passed(["専選2"], 3, "前期")],
    });
    expect(codes(entries(["演習Ⅰ"], "通年"), third)).toContain("SEMINAR_LOCKED");
    expect(codes(entries(["演習Ⅰ"], "通年"), { ...third, studentYear: 4, yearsEnrolled: 4 })).toEqual([]);
  });

  it("判定の年次に58単位で、履修中の2単位を修得すれば満たす学生は「見込み」。修得が決まるまで、演習Ⅰを入れた案は検査に通さない（第3回の監査 A3-6）", () => {
    const second = makeStudent({
      studentYear: 2,
      records: [...passed(SIXTY.slice(0, -1), 1), ...enrolled(SIXTY.slice(-1), 2, "後期")],
    });
    expect(judgment(second, "gate-seminar")).toMatchObject({ status: "expected", actual: 58 });
    expect(codes(entries(["演習Ⅰ"], "通年"), second)).toContain("SEMINAR_LOCKED");
  });

  it("T27 修得60単位のうち他学科12単位で、卒業に数える単位なら58単位でゼミ履修不可", () => {
    const student = seminarReady(SWING);
    expect(SWING.length * 2).toBe(60);
    expect(judgment(student, "gate-seminar", COUNTABLE)).toMatchObject({ status: "short", actual: 58 });
    expect(codes(entries(["演習Ⅰ"], "通年"), student, COUNTABLE)).toContain("SEMINAR_LOCKED");
  });

  it("T28 T27 と同じ学生で、修得した全単位ならゼミ履修可", () => {
    const student = seminarReady(SWING);
    expect(judgment(student, "gate-seminar", EARNED)).toMatchObject({ status: "satisfied", actual: 60 });
    expect(codes(entries(["演習Ⅰ"], "通年"), student, EARNED)).toEqual([]);
  });

  it("T29 T27 と同じ学生で、数え方が未回答なら職員確認", () => {
    const student = seminarReady(SWING);
    expect(judgment(student, "gate-seminar", {}).status).toBe("needs_staff");
    expect(codes(entries(["演習Ⅰ"], "通年"), student, {})).toEqual(["PENDING_RULE"]);
  });

  it("T27 の型の3年生は、条件を満たさなければ演習Ⅱが間に合わず延期見込みになる", () => {
    const student = makeStudent({
      studentYear: 3,
      yearsEnrolled: 3,
      expectedGraduation: { studentYear: 4, term: "後期" },
      records: [
        ...passed(SWING, 2),
        ...passed(names("専選", 14), 3),
        ...enrolled(["演習Ⅰ"], 3, "通年"),
      ],
    });
    expect(judgment(student, "graduation", EARNED).status).not.toBe("delay_risk");
    expect(judgment(student, "graduation", COUNTABLE).status).toBe("delay_risk");
    expect(judgment(student, "graduation", {}).status).toBe("needs_staff");
  });
});

describe("履修案の検査", () => {
  const sophomore = makeStudent({ studentYear: 2 });

  it("T12 前期24単位、年48単位なら OVER_LIMIT なし", () => {
    const plan = [...planOf(24, "前期"), ...planOf(24, "後期", 12)];
    expect(codes(plan, sophomore)).not.toContain("OVER_LIMIT");
  });

  it("T13 前期25単位なら OVER_LIMIT", () => {
    expect(codes(planOf(25, "前期"), sophomore)).toContain("OVER_LIMIT");
  });

  it("T14 前年度 GPA 3.0 で年56単位なら OVER_LIMIT なし", () => {
    const student = { ...sophomore, previousGpa: 3 };
    const extended = [...planOf(28, "前期"), ...planOf(28, "後期", 14)];
    const courses: Course[] = specCourses;
    const result = checkPlan(specRules, courses, student, extended, EARNED);
    expect(result.issues.map((i) => i.code)).not.toContain("OVER_LIMIT");
  });

  it("T15 前年度 GPA 2.99 で年49単位なら OVER_LIMIT", () => {
    const student = { ...sophomore, previousGpa: 2.99 };
    const plan = [...planOf(24, "前期"), ...planOf(25, "後期", 12)];
    expect(codes(plan, student)).toContain("OVER_LIMIT");
  });

  it("T16 同じ曜日・時限の2科目は TIME_CONFLICT", () => {
    expect(codes(entries(["月一A", "月一B"]), sophomore)).toContain("TIME_CONFLICT");
  });

  it("T17 Ⅰ が不可でⅡを履修すると PREREQUISITE_NOT_MET", () => {
    const student = { ...sophomore, records: failed(["統計Ⅰ"]) };
    expect(codes(entries(["統計Ⅱ"]), student)).toContain("PREREQUISITE_NOT_MET");
  });

  it("T34 前期に22単位と通年4単位なら、前期は24単位と数えて OVER_LIMIT なし", () => {
    const student = makeStudent({ studentYear: 3, records: passed(SIXTY, 2) });
    const plan = [...entries(["演習Ⅰ"], "通年"), ...planOf(22, "前期", 2)];
    expect(codes(plan, student)).toEqual([]);
    expect(codes([...plan, { course: "一単位科目", term: "前期" }], student)).toContain("OVER_LIMIT");
  });

  it("集中講義は時間割の重なりを判定しないが、履修上限には含める", () => {
    expect(codes(entries(["月一A", "集中月一"]), sophomore)).not.toContain("TIME_CONFLICT");
    const plan = [...planOf(24, "前期"), { course: "集中月一", term: "前期" as const }];
    expect(codes(plan, sophomore)).toContain("OVER_LIMIT");
  });

  it("違反に対象科目、ルールID、根拠の文、直し方の手がかりを付ける", () => {
    const [issue] = checkPlan(specRules, specCourses, sophomore, entries(["統計Ⅱ"]), EARNED).issues;
    expect(issue).toMatchObject({
      code: "PREREQUISITE_NOT_MET",
      course: "統計Ⅱ",
      ruleId: "prereq-stat",
      sourceQuote: "先修科目を修得していなければならない",
    });
    expect(issue?.hint).toContain("統計Ⅰ");
  });

  it("修得済みは ALREADY_EARNED、配当年次より前は WRONG_YEAR、未知の科目は UNKNOWN_COURSE", () => {
    const student = { ...sophomore, records: passed(["専選1"]) };
    expect(codes(entries(["専選1"]), student)).toContain("ALREADY_EARNED");
    expect(codes(entries(["演習Ⅱ"], "通年"), student)).toContain("WRONG_YEAR");
    expect(codes(entries(["ない科目"]), student)).toEqual(["UNKNOWN_COURSE"]);
  });
});

describe("全学生の判定と解釈の比較", () => {
  const students = [
    { ...seminarReady(SWING), id: "S1" },
    { ...seminarReady(SIXTY), id: "S2" },
    { ...seminarReady(SWING), id: "S3", specialStatuses: ["休学" as const] },
  ];

  it("T30 候補ごとの人数と変わる学生が、それぞれを単独で判定した結果と一致する", () => {
    const impact = computeImpact(specRules, specCourses, students, {}, "credit-basis");
    expect(impact.affectedStudentIds).toEqual(["S1"]);
    for (const option of impact.options) {
      const statuses = students.map((student) => {
        const judged = evaluateStudent(specRules, specCourses, student, {
          "credit-basis": option.id,
        });
        return judged.judgments.find((j) => j.ruleId === "gate-seminar")!.status;
      });
      const total = Object.values(option.counts ?? {}).reduce((sum, count) => sum + count, 0);
      expect(total).toBe(students.length);
      for (const status of new Set(statuses)) {
        expect(option.counts?.[status]).toBe(statuses.filter((s) => s === status).length);
      }
    }
  });

  it("差分で表せない候補は計算できないと返し、人数を推測しない", () => {
    const impact = computeImpact(
      kamomeSpecRules,
      kamomeSpecCourses,
      [makeStudent({ major: "心理" })],
      {},
      "minor-withdrawal",
    );
    expect(impact.computable).toBe(false);
    expect(impact.options.every((option) => option.counts === null)).toBe(true);
    expect(impact.affectedStudentIds).toEqual([]);
  });
});

describe("全判定を職員確認にする学生", () => {
  const graduate = makeStudent({ records: passed(EXACT) });

  it("T31 異動の記録がある学生", () => {
    const result = evaluateStudent(specRules, specCourses, { ...graduate, specialStatuses: ["読替"] }, EARNED);
    expect(result.judgments.every((j) => j.status === "needs_staff")).toBe(true);
  });

  it("T32 適用外の入学年度の学生", () => {
    const result = evaluateStudent(specRules, specCourses, { ...graduate, admissionYear: 2019 }, EARNED);
    expect(result.judgments.every((j) => j.status === "needs_staff")).toBe(true);
  });
});

describe("かもめ大学", () => {
  const psychology = (overrides: Partial<Student> = {}) =>
    makeStudent({ major: "心理", ...overrides });
  const evaluate = (student: Student) =>
    evaluateStudent(kamomeSpecRules, kamomeSpecCourses, student, {
      "retake-scope": "failed",
      "minor-withdrawal": "without",
    });
  const planCodes = (plan: PlanEntry[], student: Student, answers: Answers = { "retake-scope": "failed" }) =>
    checkPlan(kamomeSpecRules, kamomeSpecCourses, student, plan, answers).issues.map((i) => i.code);

  it("T19 副専攻ありなら、減った基準で判定する", () => {
    const records = passed(names("心理", 26));
    const withMinor = evaluate(psychology({ hasMinor: true, records }));
    const withoutMinor = evaluate(psychology({ hasMinor: false, records }));
    expect(withMinor.judgments.find((j) => j.ruleId === "psy-major-minor")?.status).toBe("satisfied");
    expect(withoutMinor.judgments.find((j) => j.ruleId === "psy-major")?.status).toBe("short");
  });

  it("T20 コアの超過分は自由単位へ算入しない", () => {
    const { categories } = allocateCredits(
      kamomeSpecRules,
      indexCourses(kamomeSpecCourses),
      psychology(),
      new Set(names("コア", 22)),
    );
    expect(categories.find((c) => c.categoryId === "core")).toMatchObject({ counted: 40, lost: 4 });
    expect(categories.find((c) => c.categoryId === "free-psy")?.received).toBe(0);
  });

  it("自由科目に上限がなければ、超過分を消さない", () => {
    const { categories } = allocateCredits(
      kamomeSpecRules,
      indexCourses(kamomeSpecCourses),
      psychology(),
      new Set(names("社会", 15)),
    );
    expect(categories.find((c) => c.categoryId === "free-psy")).toMatchObject({ counted: 30, lost: 0 });
  });

  it("T21 学期24単位のうち再履修科目が2単位なら、22単位と数えて OVER_LIMIT なし", () => {
    const student = psychology({ studentYear: 2, records: failed(["心理1"]) });
    const plan = entries(["心理1", ...names("心理", 12).slice(1)]);
    expect(planCodes(plan, student)).not.toContain("OVER_LIMIT");
  });

  it("T21 失格の科目は、不合格だけを除くルールでは上限に数える", () => {
    const student = psychology({ studentYear: 2, records: disqualified(["心理1"]) });
    const plan = entries(["心理1", ...names("心理", 12).slice(1)]);
    expect(planCodes(plan, student)).toContain("OVER_LIMIT");
    expect(planCodes(plan, student, { "retake-scope": "both" })).not.toContain("OVER_LIMIT");
  });

  it("T35 学期23単位で再履修科目なしなら OVER_LIMIT", () => {
    const courses = [...kamomeSpecCourses, { name: "一単位", credits: 1, assignedYear: 1, groups: [] }];
    const plan = entries([...names("心理", 11), "一単位"]);
    const result = checkPlan(kamomeSpecRules, courses, psychology({ studentYear: 2 }), plan, {
      "retake-scope": "failed",
    });
    expect(result.issues.map((i) => i.code)).toContain("OVER_LIMIT");
  });

  it("T22 先修が「A または B」で B だけを修得すれば違反なし", () => {
    const student = psychology({ studentYear: 2, records: passed(["社会統計Ⅰ"]) });
    expect(planCodes(entries(["心理統計Ⅱ"]), student)).toEqual([]);
  });

  it("T23 同時履修が可能な科目を履修案に同時に入れても違反なし", () => {
    const student = psychology({ studentYear: 2 });
    const result = checkPlan(
      kamomeSpecRules,
      kamomeSpecCourses,
      student,
      entries(["心理学実験", "心理統計Ⅰ"]),
      { "retake-scope": "failed" },
    );
    expect(result.issues).toEqual([]);
    expect(result.warnings.join()).toContain("心理統計Ⅰ");
  });

  it("T24 未解決の曖昧箇所に関わる判定は PENDING_RULE", () => {
    const student = psychology({ studentYear: 2 });
    expect(planCodes(entries(["心理1"]), student, {})).toEqual(["PENDING_RULE"]);
  });

  it("別のクォーターの同じ時限は重ならない", () => {
    const plan = entries(["第1クォーター科目", "第2クォーター科目"]);
    expect(planCodes(plan, psychology({ studentYear: 2 }))).toEqual([]);
  });

  it("T36 社会統計Ⅰは、所属により副専攻科目と専攻科目へ割り当てる", () => {
    const catalog = indexCourses(kamomeSpecCourses);
    const taken = new Set(["社会統計Ⅰ"]);
    const minor = allocateCredits(kamomeSpecRules, catalog, psychology({ hasMinor: true }), taken);
    const major = allocateCredits(kamomeSpecRules, catalog, makeStudent({ major: "社会" }), taken);
    expect(minor.categories.find((c) => c.categoryId === "psy-minor")?.direct).toBe(2);
    expect(major.categories.find((c) => c.categoryId === "soc-major")?.direct).toBe(2);
  });
});

describe("追加で確認すること", () => {
  const student = makeStudent({ records: passed(EXACT) });

  it("同じ入力を2回与えて、同じ結果になる", () => {
    const run = () => evaluateStudent(specRules, specCourses, student, EARNED);
    expect(run()).toEqual(run());
  });

  it("科目の順番を変えても、結果が変わらない", () => {
    const reversed = { ...student, records: [...student.records].reverse() };
    const courses = [...specCourses].reverse();
    expect(evaluateStudent(specRules, courses, reversed, EARNED)).toEqual(
      evaluateStudent(specRules, specCourses, student, EARNED),
    );
  });

  it("再履修で修得した科目を二重に数えない", () => {
    const retaken = makeStudent({
      records: [...passed(EXACT), ...failed(["専選1"]), ...passed(["専選1"], 2)],
    });
    expect(judgment(retaken, "graduation").earned).toBe(124);
  });

  it("失格は修得に入れない", () => {
    const records = [...passed(EXACT.filter((n) => n !== "基礎必修1")), ...disqualified(["基礎必修1"])];
    expect(judgment(makeStudent({ records }), "basic-required").status).toBe("short");
  });

  it("すべての判定に使ったルールIDと根拠の文を付ける", () => {
    for (const result of evaluateStudent(specRules, specCourses, student, {}).judgments) {
      expect(result.ruleId).not.toBe("");
      expect(result.sourceQuote).not.toBe("");
    }
  });
});
