import { resolveRules } from "./answers";
import {
  allocateCredits,
  applicableCategories,
  sortByOverflow,
  type CategoryAllocation,
  type CreditAllocation,
} from "./credits";
import {
  indexCourses,
  matchesCondition,
  passedCourses,
  termIndex,
  type Answers,
  type Course,
  type CourseIndex,
  type Student,
} from "./model";
import type { Category, Gate, RuleSet } from "./rules";

export type JudgmentStatus = "satisfied" | "expected" | "short" | "delay_risk" | "needs_staff";

export type Judgment = {
  ruleId: string;
  kind: "graduation" | "category" | "gate";
  name: string;
  clause: string;
  sourceQuote: string;
  status: JudgmentStatus;
  reason: string;
  ambiguityIds: string[];
  // 職員が声をかける対象か。在学中の不足は今後の履修で埋まるので含めない。
  needsContact: boolean;
  required?: number;
  actual?: number;
  enrolled?: number;
  earned?: number;
  missingCourses?: string[];
  shortCategories?: string[];
  uncountedCourses?: string[];
  atRisk?: boolean;
  eligibleFromYear?: number;
};

export type StudentEvaluation = {
  studentId: string;
  excludedReason: string | null;
  judgments: Judgment[];
};

export type PreparedRules = {
  baseRules: RuleSet;
  rules: RuleSet;
  catalog: CourseIndex;
  unresolved: Set<string>;
  problem: string | null;
};

export type EvaluationContext = PreparedRules & {
  student: Student;
  uncertainCategories: Map<string, string[]>;
};

type Pending = { ambiguityIds?: string[]; status?: "confirmed" | "needs_review"; id: string };

const UNRESOLVED_REASON = "未回答の確認事項があるため、職員が確認します。";

export function prepareRules(baseRules: RuleSet, courses: Course[], answers: Answers): PreparedRules {
  const catalog = indexCourses(courses);
  try {
    return { baseRules, catalog, problem: null, ...resolveRules(baseRules, answers) };
  } catch (cause) {
    const problem = cause instanceof Error ? cause.message : "ルールを適用できません";
    return { baseRules, rules: baseRules, catalog, unresolved: new Set(), problem };
  }
}

export function exclusionReason(prepared: PreparedRules, student: Student) {
  const { rules, catalog, problem } = prepared;
  if (problem) return `ルールに問題があるため、職員が確認します（${problem}）。`;
  if (student.specialStatuses.length > 0) {
    return `${student.specialStatuses.join("、")}に該当するため、職員が確認します。`;
  }
  if (!rules.admissionYears.includes(student.admissionYear)) {
    return `入学年度 ${student.admissionYear} はこの要項の適用外のため、職員が確認します。`;
  }
  const majors = new Set(rules.categories.flatMap(({ when }) => (when?.major ? [when.major] : [])));
  if (majors.size > 0 && !(student.major && majors.has(student.major))) {
    return "所属の専攻がこの要項の対象外のため、職員が確認します。";
  }
  const unknown = [...new Set(student.records.map((record) => record.course))].filter(
    (name) => !catalog.has(name),
  );
  if (unknown.length > 0) {
    return `科目データにない科目（${unknown.join("、")}）があるため、職員が確認します。`;
  }
  return null;
}

export function pendingIds(rule: Pending, unresolved: Set<string>) {
  const ids = (rule.ambiguityIds ?? []).filter((id) => unresolved.has(id));
  return rule.status === "needs_review" ? [...ids, `review:${rule.id}`] : ids;
}

// 超過分を受け取る区分は、送り元の区分が未確定なら同じく未確定になる。
function findUncertainCategories(categories: Category[], unresolved: Set<string>) {
  const uncertain = new Map<string, string[]>();
  for (const category of sortByOverflow(categories)) {
    const ids = [
      ...new Set([...pendingIds(category, unresolved), ...(uncertain.get(category.id) ?? [])]),
    ];
    if (ids.length === 0) continue;
    uncertain.set(category.id, ids);
    if (category.overflowTo !== null) {
      const inherited = uncertain.get(category.overflowTo) ?? [];
      uncertain.set(category.overflowTo, [...new Set([...inherited, ...ids])]);
    }
  }
  return uncertain;
}

export function createContext(prepared: PreparedRules, student: Student): EvaluationContext {
  const categories = applicableCategories(prepared.rules, student);
  return {
    ...prepared,
    student,
    uncertainCategories: findUncertainCategories(categories, prepared.unresolved),
  };
}

function isCategoryMet(category: Category, allocation: CategoryAllocation) {
  return allocation.total >= category.minCredits && allocation.missingCourses.length === 0;
}

function allocationOf(result: CreditAllocation, category: Category) {
  const allocation = result.categories.find((c) => c.categoryId === category.id);
  if (!allocation) throw new Error(`区分の集計がありません: ${category.id}`);
  return allocation;
}

function judgeCategory(
  category: Category,
  context: EvaluationContext,
  current: CreditAllocation,
  projected: CreditAllocation,
): Judgment {
  const { student, rules, uncertainCategories } = context;
  const allocation = allocationOf(current, category);
  const base = {
    ruleId: category.id,
    kind: "category" as const,
    name: category.name,
    clause: category.clause,
    sourceQuote: category.sourceQuote,
    required: category.minCredits,
    actual: allocation.total,
    enrolled: allocationOf(projected, category).total - allocation.total,
    missingCourses: allocation.missingCourses,
    ambiguityIds: uncertainCategories.get(category.id) ?? [],
    needsContact: false,
  };

  if (base.ambiguityIds.length > 0) {
    return { ...base, status: "needs_staff", reason: UNRESOLVED_REASON };
  }
  if (isCategoryMet(category, allocation)) {
    return { ...base, status: "satisfied", reason: "必要な単位を満たしています。" };
  }
  if (isCategoryMet(category, allocationOf(projected, category))) {
    return { ...base, status: "expected", reason: "履修中の科目を修得すれば満たします。" };
  }
  return {
    ...base,
    status: "short",
    reason: "必要な単位または科目が不足しています。",
    needsContact: student.studentYear >= rules.graduation.minYears,
  };
}

function gateProgress(gate: Gate, context: EvaluationContext, passed: Set<string>, projected: Set<string>) {
  const { rules, catalog, student } = context;
  const allocation = allocateCredits(rules, catalog, student, passed);
  const actual = gate.creditBasis === "countable" ? allocation.counted : allocation.earned;
  const required = gate.requiredMayBeEnrolled ? projected : passed;
  const missingCourses = gate.requiredCourses.filter((name) => !required.has(name)).sort();
  const satisfied = actual >= (gate.minCredits ?? 0) && missingCourses.length === 0;
  return { actual, missingCourses, satisfied };
}

type GateOutcome = Pick<Judgment, "status" | "reason" | "actual" | "missingCourses"> & {
  atRisk?: boolean;
  eligibleFromYear?: number;
};

function gateOutcome(gate: Gate, context: EvaluationContext): GateOutcome {
  const { student } = context;
  const check = gate.checkAtEndOfYear;
  const projectedNames = passedCourses(student, { includeEnrolled: true });
  const at = (throughYear?: number) =>
    gateProgress(
      gate,
      context,
      passedCourses(student, throughYear === undefined ? {} : { throughYear }),
      projectedNames,
    );
  const present = at();
  const projected = gateProgress(gate, context, projectedNames, projectedNames);
  const progress = ({ actual, missingCourses }: typeof present) => ({ actual, missingCourses });

  if (gate.target.kind === "promotion" && student.studentYear >= gate.target.toYear) {
    return { ...progress(present), status: "satisfied", reason: "進級済みです。" };
  }

  if (student.studentYear <= check) {
    if (present.satisfied) {
      return { ...progress(present), status: "satisfied", reason: "条件を満たしています。" };
    }
    if (projected.satisfied) {
      const reason = "履修中の科目を修得すれば条件を満たします。";
      return { ...progress(present), status: "expected", reason };
    }
    const atRisk = student.studentYear === check;
    const reason = atRisk
      ? `${check}年次の終わりまでに条件を満たせない見込みです。`
      : `${check}年次の終わりに判定します。`;
    return { ...progress(present), status: "short", reason, atRisk };
  }

  const atCheck = at(check);
  if (atCheck.satisfied) {
    return { ...progress(atCheck), status: "satisfied", reason: "条件を満たしています。" };
  }
  if (!gate.retryAfterMet) {
    const reason = `${check}年次の終わりの時点で条件を満たしていません。`;
    return { ...progress(atCheck), status: "short", reason };
  }

  for (let year = check + 1; year < student.studentYear; year += 1) {
    const later = at(year);
    if (later.satisfied) {
      const reason = `${year}年次に条件を満たしたため、${year + 1}年次から認められます。`;
      return { ...progress(later), status: "satisfied", reason, eligibleFromYear: year + 1 };
    }
  }
  if (present.satisfied || projected.satisfied) {
    const reason = `条件を満たせば、${student.studentYear + 1}年次から認められます。`;
    const eligibleFromYear = student.studentYear + 1;
    return { ...progress(present), status: "expected", reason, eligibleFromYear };
  }
  const reason = `${check}年次の終わりの時点で条件を満たしておらず、その後も満たしていません。`;
  return { ...progress(present), status: "short", reason };
}

export function judgeGate(gate: Gate, context: EvaluationContext): Judgment {
  const { student, unresolved, uncertainCategories } = context;
  const inherited = gate.creditBasis === "countable" ? [...uncertainCategories.values()].flat() : [];
  const outcome = gateOutcome(gate, context);
  const promoted = gate.target.kind === "promotion" && student.studentYear >= gate.target.toYear;
  const ambiguityIds = promoted
    ? []
    : [...new Set([...pendingIds(gate, unresolved), ...inherited])];
  const base = {
    ruleId: gate.id,
    kind: "gate" as const,
    name: gate.name,
    clause: gate.clause,
    sourceQuote: gate.sourceQuote,
    required: gate.minCredits,
    ambiguityIds,
  };

  if (ambiguityIds.length > 0) {
    return {
      ...base,
      actual: outcome.actual,
      missingCourses: outcome.missingCourses,
      status: "needs_staff",
      reason: UNRESOLVED_REASON,
      needsContact: false,
    };
  }
  const passedCheck = student.studentYear > gate.checkAtEndOfYear;
  return {
    ...base,
    ...outcome,
    needsContact: outcome.atRisk === true || (outcome.status === "short" && passedCheck),
  };
}

// 未解決の曖昧箇所の候補ごとに、履修条件を書き換えた形を作る。差分で表せない候補があれば complete を落とす。
function gateVariants(gate: Gate, context: EvaluationContext) {
  const { rules, unresolved } = context;
  let variants = [gate];
  let complete = gate.status !== "needs_review";
  for (const id of gate.ambiguityIds ?? []) {
    if (!unresolved.has(id)) continue;
    const ambiguity = rules.ambiguities.find((a) => a.id === id);
    const expanded: Gate[] = [];
    for (const option of ambiguity?.options ?? []) {
      if (option.patches === null) {
        complete = false;
        continue;
      }
      const fields = option.patches.filter((patch) => patch.ruleId === gate.id);
      for (const variant of variants) {
        const changed = Object.fromEntries(fields.map((patch) => [patch.field, patch.value]));
        expanded.push({ ...variant, ...changed });
      }
    }
    if (expanded.length > 0) variants = expanded;
  }
  return { variants, complete };
}

function yearStart(year: number) {
  return termIndex({ studentYear: year, term: "前期" });
}

// 履修条件のある科目を、早くていつの学期から履修できるか。
function gateStartTerm(gate: Gate, context: EvaluationContext, pessimistic: boolean) {
  const { student } = context;
  const { variants, complete } = gateVariants(gate, context);
  const starts = variants.map((variant) => {
    const outcome = gateOutcome(variant, context);
    if (outcome.eligibleFromYear !== undefined) return yearStart(outcome.eligibleFromYear);
    if (outcome.status === "satisfied") return 0;
    if (student.studentYear <= variant.checkAtEndOfYear) {
      return yearStart(variant.checkAtEndOfYear + 1);
    }
    return variant.retryAfterMet ? yearStart(student.studentYear + 1) : Number.POSITIVE_INFINITY;
  });
  if (!pessimistic) return Math.min(...starts);
  return complete ? Math.max(...starts) : Number.POSITIVE_INFINITY;
}

// 不足の必修が、先修と開講学期のつながりを含めて卒業予定に間に合うかを見る。
function requiredCoursesTooLate(context: EvaluationContext, deadline: number, pessimistic: boolean) {
  const { rules, catalog, student } = context;
  const now = termIndex({ studentYear: student.studentYear, term: student.currentTerm });
  const passed = passedCourses(student);
  const gates = rules.gates.filter((gate) => matchesCondition(gate.when, student));
  const prerequisites = rules.prerequisites.filter((rule) => matchesCondition(rule.when, student));
  const finished = new Map<string, number>();

  function earliestStart(name: string) {
    let start = 0;
    for (const gate of gates) {
      if (gate.target.kind === "course" && gate.target.courses.includes(name)) {
        start = Math.max(start, gateStartTerm(gate, context, pessimistic));
      }
    }
    return start;
  }

  function finishTerm(name: string, visiting: Set<string>): number {
    if (passed.has(name)) return -1;
    const known = finished.get(name);
    if (known !== undefined) return known;
    if (visiting.has(name)) return Number.POSITIVE_INFINITY;
    const course = catalog.get(name);
    if (!course) return Number.POSITIVE_INFINITY;

    const gateStart = earliestStart(name);
    const record = student.records.find(
      (r) => r.course === name && r.result === "enrolled" && r.studentYear === student.studentYear,
    );
    if (record && gateStart <= yearStart(student.studentYear)) {
      const end =
        record.term === "通年"
          ? yearStart(student.studentYear) + 1
          : termIndex({ studentYear: student.studentYear, term: record.term });
      finished.set(name, end);
      return end;
    }

    const nested = new Set(visiting).add(name);
    let start = Math.max(now + 1, gateStart);
    if (rules.enrollment?.forbidBeforeAssignedYear) {
      start = Math.max(start, yearStart(course.assignedYear));
    }
    for (const rule of prerequisites.filter((p) => p.course === name)) {
      const gap = rule.allowSameTerm ? 0 : 1;
      const options = rule.conditions.map((names) =>
        Math.max(...names.map((prerequisite) => finishTerm(prerequisite, nested) + gap)),
      );
      start = Math.max(start, Math.min(...options));
    }
    if (course.offeredIn === "通年" || course.offeredIn === "前期") {
      if (start % 2 === 1) start += 1;
    } else if (course.offeredIn === "後期" && start % 2 === 0) start += 1;

    const end = course.offeredIn === "通年" ? start + 1 : start;
    finished.set(name, end);
    return end;
  }

  const required = applicableCategories(rules, student)
    .filter((category) => category.requireAll)
    .flatMap((category) =>
      [...catalog.values()].filter((course) =>
        course.groups.some((group) => category.groups.includes(group)),
      ),
    );
  return required.some((course) => finishTerm(course.name, new Set()) > deadline);
}

function maxRemainingCredits(context: EvaluationContext, deadline: number, maxPerTerm: number, maxPerYear?: number) {
  const { student } = context;
  const now = termIndex({ studentYear: student.studentYear, term: student.currentTerm });
  const registered = student.records.filter((r) => r.studentYear === student.studentYear);
  const used = registered.reduce((sum, r) => sum + (context.catalog.get(r.course)?.credits ?? 0), 0);
  const perYear = new Map<number, number>();
  for (let term = now + 1; term <= deadline; term += 1) {
    const year = Math.floor(term / 2) + 1;
    perYear.set(year, (perYear.get(year) ?? 0) + maxPerTerm);
  }
  let total = 0;
  for (const [year, credits] of perYear) {
    const room = maxPerYear === undefined ? credits : maxPerYear - (year === student.studentYear ? used : 0);
    total += Math.max(0, Math.min(credits, room));
  }
  return total;
}

function shortfallCredits(rules: RuleSet, student: Student, projected: CreditAllocation) {
  const categoryShort = applicableCategories(rules, student).reduce((sum, category) => {
    const { total } = allocationOf(projected, category);
    return sum + Math.max(0, category.minCredits - total);
  }, 0);
  return Math.max(rules.graduation.totalCredits - projected.counted, categoryShort);
}

// 判定に使えない情報があるときは、延期見込みにせず unknown を返す。
function judgeDelay(context: EvaluationContext, projected: CreditAllocation) {
  const { rules, student, unresolved } = context;
  if (!student.expectedGraduation) return "none";
  const deadline = termIndex(student.expectedGraduation);

  const lateIfOpen = requiredCoursesTooLate(context, deadline, false);
  const lateIfClosed = requiredCoursesTooLate(context, deadline, true);
  if (lateIfOpen) return "delay";
  if (lateIfClosed) return "unknown";

  const shortfall = shortfallCredits(rules, student, projected);
  if (shortfall === 0) return "none";
  const applicable = rules.loadLimits.filter((limit) => matchesCondition(limit.when, student));
  const limit = applicable.at(-1);
  if (!limit) return "unknown";
  const capacity = maxRemainingCredits(context, deadline, limit.maxPerTerm, limit.maxPerYear);
  if (shortfall <= capacity) return "none";
  const usable = applicable.every((l) => pendingIds(l, unresolved).length === 0);
  return usable && limit.retakeExclusion === "none" ? "delay" : "unknown";
}

function judgeGraduation(
  context: EvaluationContext,
  categories: Judgment[],
  current: CreditAllocation,
  projected: CreditAllocation,
): Judgment {
  const { rules, student, unresolved } = context;
  const { graduation } = rules;
  const uncertainIds = [...new Set(categories.flatMap((category) => category.ambiguityIds))];
  const ownIds = pendingIds(graduation, unresolved);
  const finalYear = student.studentYear >= graduation.minYears;
  const shortCategories = categories.filter((c) => c.status === "short").map((c) => c.name);
  const base = {
    ruleId: graduation.id,
    kind: "graduation" as const,
    name: "卒業要件",
    clause: graduation.clause,
    sourceQuote: graduation.sourceQuote,
    required: graduation.totalCredits,
    actual: current.counted,
    enrolled: projected.counted - current.counted,
    earned: current.earned,
    shortCategories,
    uncountedCourses: current.uncategorized,
    ambiguityIds: [...new Set([...ownIds, ...uncertainIds])],
    needsContact: false,
  };

  if (ownIds.length > 0) {
    return { ...base, status: "needs_staff", reason: UNRESOLVED_REASON };
  }
  if (uncertainIds.length > 0) {
    if (shortCategories.length === 0) {
      return { ...base, status: "needs_staff", reason: UNRESOLVED_REASON };
    }
    const reason = `${shortCategories.join("、")}に不足があります。`;
    return { ...base, status: "short", reason, needsContact: finalYear };
  }

  const yearsMet = student.yearsEnrolled >= graduation.minYears;
  const creditsMet = current.counted >= graduation.totalCredits;
  if (yearsMet && creditsMet && categories.every((c) => c.status === "satisfied")) {
    return { ...base, status: "satisfied", reason: "卒業に必要な要件を満たしています。" };
  }

  const delay = judgeDelay(context, projected);
  if (delay === "delay") {
    const reason = "卒業予定までの履修機会では足りない見込みです。職員と確認してください。";
    return { ...base, status: "delay_risk", reason, needsContact: true };
  }
  if (delay === "unknown") {
    return { ...base, status: "needs_staff", reason: "卒業の見込みを判定できないため、職員が確認します。" };
  }

  if (shortCategories.length > 0) {
    const reason = `${shortCategories.join("、")}に不足があります。`;
    return { ...base, status: "short", reason, needsContact: finalYear };
  }
  if (projected.counted < graduation.totalCredits) {
    return { ...base, status: "short", reason: "合計単位が不足しています。", needsContact: finalYear };
  }
  if (!yearsMet) {
    return { ...base, status: "short", reason: "在学年数が不足しています。" };
  }
  return { ...base, status: "expected", reason: "履修中の科目を修得すれば満たします。" };
}

function excludedJudgments(rules: RuleSet, student: Student, reason: string): Judgment[] {
  const base = { status: "needs_staff" as const, reason, ambiguityIds: [], needsContact: false };
  const toJudgment = (
    kind: Judgment["kind"],
    rule: { id: string; clause: string; sourceQuote: string },
    name: string,
  ) => ({ ...base, ruleId: rule.id, kind, name, clause: rule.clause, sourceQuote: rule.sourceQuote });

  return [
    ...applicableCategories(rules, student).map((c) => toJudgment("category", c, c.name)),
    toJudgment("graduation", rules.graduation, "卒業要件"),
    ...rules.gates
      .filter((gate) => matchesCondition(gate.when, student))
      .map((gate) => toJudgment("gate", gate, gate.name)),
  ];
}

function judgeAll(context: EvaluationContext): Judgment[] {
  const { rules, catalog, student } = context;
  const current = allocateCredits(rules, catalog, student, passedCourses(student));
  const projected = allocateCredits(
    rules,
    catalog,
    student,
    passedCourses(student, { includeEnrolled: true }),
  );
  const categories = applicableCategories(rules, student).map((category) =>
    judgeCategory(category, context, current, projected),
  );
  const gates = rules.gates
    .filter((gate) => matchesCondition(gate.when, student))
    .map((gate) => judgeGate(gate, context));
  return [...categories, judgeGraduation(context, categories, current, projected), ...gates];
}

export function evaluatePrepared(prepared: PreparedRules, student: Student): StudentEvaluation {
  const reason = exclusionReason(prepared, student);
  if (reason) {
    return {
      studentId: student.id,
      excludedReason: reason,
      judgments: excludedJudgments(prepared.rules, student, reason),
    };
  }
  // エラーは例外で止めず、その学生を職員確認にして全体の処理を続ける。
  try {
    return {
      studentId: student.id,
      excludedReason: null,
      judgments: judgeAll(createContext(prepared, student)),
    };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "判定できません";
    const message = `ルールに問題があるため、職員が確認します（${detail}）。`;
    return {
      studentId: student.id,
      excludedReason: message,
      judgments: excludedJudgments(prepared.rules, student, message),
    };
  }
}

export function evaluateStudent(
  rules: RuleSet,
  courses: Course[],
  student: Student,
  answers: Answers,
): StudentEvaluation {
  return evaluatePrepared(prepareRules(rules, courses, answers), student);
}
