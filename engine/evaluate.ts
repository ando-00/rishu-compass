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
  disqualifiedCourses,
  matchesCondition,
  passedCourses,
  termIndex,
  type Answers,
  type Course,
  type CourseIndex,
  type Student,
} from "./model";
import type { Category, Gate, LoadLimit, Prerequisite, RuleSet } from "./rules";

// expected は履修中の科目を修得すれば満たす。delayed は判定の時点に満たさず、次の年度以降に認める（H29）
export type JudgmentStatus = "satisfied" | "expected" | "delayed" | "short" | "delay_risk" | "needs_staff";

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
  // 延期見込みの発端になった条文。卒業要件の条文とは別に示す
  grounds?: Ground[];
};

export type Ground = { ruleId: string; clause: string; sourceQuote: string };

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
  // 答えたが判定に反映できない曖昧箇所（unresolved の一部）
  unreflected: Set<string>;
  problem: string | null;
};

export type EvaluationContext = PreparedRules & {
  student: Student;
  uncertainCategories: Map<string, string[]>;
};

type Pending = { ambiguityIds?: string[]; status?: "confirmed" | "needs_review"; id: string };

const UNRESOLVED_REASON = "未回答の確認事項があるため、職員が確認します。";
const UNREFLECTED_REASON = "判定に反映できない回答（ルールの形で表せない読み方）があるため、職員が確認します。";

// 止めている曖昧箇所がすべて「答えたが反映できない」ものなら、未回答とは言わない（監査の第2.5回の A25-4）
function unresolvedReason({ unreflected }: { unreflected: Set<string> }, ids: string[]) {
  return ids.length > 0 && ids.every((id) => unreflected.has(id)) ? UNREFLECTED_REASON : UNRESOLVED_REASON;
}

export function prepareRules(baseRules: RuleSet, courses: Course[], answers: Answers): PreparedRules {
  const catalog = indexCourses(courses);
  try {
    return { baseRules, catalog, problem: null, ...resolveRules(baseRules, answers) };
  } catch (cause) {
    const problem = cause instanceof Error ? cause.message : "ルールを適用できません";
    return { baseRules, rules: baseRules, catalog, unresolved: new Set(), unreflected: new Set(), problem };
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
  // 専攻で分かれるルールなら、学生の専攻と副専攻の組み合わせに合う区分がなければ対象外にする。
  const byMajor = rules.categories.filter(({ when }) => when?.major);
  if (byMajor.length > 0 && !byMajor.some(({ when }) => matchesCondition(when, student))) {
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
    return { ...base, status: "needs_staff", reason: unresolvedReason(context, base.ambiguityIds) };
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
      // 「履修中でもよい」を判定の時点までに限るときは、その年次までの履修中だけを数える（A1-16）
      gate.enrolledThroughCheckOnly && throughYear !== undefined
        ? passedCourses(student, { includeEnrolled: true, throughYear })
        : projectedNames,
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
    // 判定の時点の単位数を添える。示す単位数（actual）は今の値なので、読み方で時点が違って見えないようにする（A25-5）
    const missed = atCheck.missingCourses.length > 0 ? `、未修得: ${atCheck.missingCourses.join("、")}` : "";
    const reason = `${check}年次の終わりの時点では ${atCheck.actual} 単位${missed}で条件を満たしていませんでした。条件を満たせば、${student.studentYear + 1}年次から認められます。`;
    const eligibleFromYear = student.studentYear + 1;
    return { ...progress(present), status: "delayed", reason, eligibleFromYear };
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
      reason: unresolvedReason(context, ambiguityIds),
      needsContact: false,
    };
  }
  const passedCheck = student.studentYear > gate.checkAtEndOfYear;
  // 条件を満たしていない科目を今年度に履修中なら、その事実を理由に添える。判定と対応は変えない（H33、第3回の監査 A3-14）
  const unmet = outcome.status === "delayed" || outcome.status === "short";
  const enrolledNow =
    unmet && gate.target.kind === "course"
      ? gate.target.courses.filter((name) =>
          student.records.some(
            (r) => r.course === name && r.result === "enrolled" && r.studentYear === student.studentYear,
          ),
        )
      : [];
  const reason =
    enrolledNow.length > 0 ? `${outcome.reason}${enrolledNow.join("、")} は今年度、履修中です。` : outcome.reason;
  return {
    ...base,
    ...outcome,
    reason,
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
    // 判定年次の後期に満たせないなら判定で落ちる。やり直せる条件は、翌年次に満たしてその次から履修できる。
    const missed = outcome.atRisk === true && student.currentTerm === "後期";
    if (student.studentYear <= variant.checkAtEndOfYear && !missed) {
      return yearStart(variant.checkAtEndOfYear + 1);
    }
    if (outcome.status === "satisfied") return 0;
    if (!variant.retryAfterMet) return Number.POSITIVE_INFINITY;
    return yearStart(student.studentYear + (missed ? 2 : 1));
  });
  // 要確認の条件や、差分で表せない候補がある条件は、中身が決まっていない。今の値を読み方の端として使わず、
  // 楽観側は「条件がない」、悲観側は「履修できない」で計算する（第3回の監査 A3-1）
  if (!pessimistic) return complete ? Math.min(...starts) : 0;
  return complete ? Math.max(...starts) : Number.POSITIVE_INFINITY;
}

// 不足の必修が、先修と開講学期のつながりを含めて卒業予定に間に合うかを見る。
function requiredCoursesTooLate(context: EvaluationContext, deadline: number, pessimistic: boolean) {
  const { rules, catalog, student, unresolved } = context;
  const now = termIndex({ studentYear: student.studentYear, term: student.currentTerm });
  const passed = passedCourses(student);
  const gates = rules.gates.filter((gate) => matchesCondition(gate.when, student));
  const prerequisites = rules.prerequisites.filter((rule) => matchesCondition(rule.when, student));
  const finished = new Map<string, number>();
  // 未回答の項目は今の値を使わず、読み方の両端で計算する。
  const isOpen = (rule: Pending) => pendingIds(rule, unresolved).length > 0;
  const { enrollment } = rules;
  const forbidEarly =
    enrollment && (isOpen(enrollment) ? pessimistic : enrollment.forbidBeforeAssignedYear);
  const disqualified = disqualifiedCourses(student);
  const retakeBarred =
    rules.retake && (isOpen(rules.retake) ? pessimistic : rules.retake.forbidDisqualified);
  let incalculable = false;

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
    if (retakeBarred && disqualified.has(name)) return Number.POSITIVE_INFINITY;
    const known = finished.get(name);
    if (known !== undefined) return known;
    const course = catalog.get(name);
    if (visiting.has(name) || !course) {
      incalculable = true;
      return Number.POSITIVE_INFINITY;
    }

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
    if (forbidEarly) start = Math.max(start, yearStart(course.assignedYear));
    for (const rule of prerequisites.filter((p) => p.course === name)) {
      const sameTerm = isOpen(rule) ? !pessimistic : rule.allowSameTerm;
      const gap = sameTerm ? 0 : 1;
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
  const courses = [
    ...new Set(
      required.filter((course) => finishTerm(course.name, new Set()) > deadline).map(({ name }) => name),
    ),
  ];
  // 循環と未知の科目は計算できないので、延期見込みにせず職員確認に倒す。
  return { tooLate: incalculable ? pessimistic : courses.length > 0, courses };
}

// 間に合わない科目と、その履修の順を決めている条文を返す。
function explainDelay(context: EvaluationContext, deadline: number) {
  const { rules, student } = context;
  const { courses } = requiredCoursesTooLate(context, deadline, false);
  const passed = passedCourses(student);
  const grounds = new Map<string, Ground>();
  const seen = new Set<string>();
  const cite = ({ id, clause, sourceQuote }: Gate | Prerequisite) =>
    grounds.set(id, { ruleId: id, clause, sourceQuote });

  function follow(name: string) {
    if (seen.has(name) || passed.has(name)) return;
    seen.add(name);
    for (const gate of rules.gates) {
      const applies = gate.target.kind === "course" && gate.target.courses.includes(name);
      if (applies && matchesCondition(gate.when, student)) cite(gate);
    }
    for (const rule of rules.prerequisites) {
      if (rule.course !== name || !matchesCondition(rule.when, student)) continue;
      cite(rule);
      rule.conditions.flat().forEach(follow);
    }
  }
  courses.forEach(follow);
  return { courses, grounds: [...grounds.values()] };
}

function maxRemainingCredits(context: EvaluationContext, deadline: number, maxPerTerm: number, maxPerYear?: number) {
  const { student } = context;
  const now = termIndex({ studentYear: student.studentYear, term: student.currentTerm });
  const registered = student.records.filter((r) => r.studentYear === student.studentYear);
  const creditsOf = (name: string) => context.catalog.get(name)?.credits ?? 0;
  const used = registered.reduce((sum, r) => sum + creditsOf(r.course), 0);
  // 履修案の検査と同じく、履修中の通年は残りの学期にも半分を数える。
  const yearLongHalf = registered
    .filter((r) => r.term === "通年" && r.result === "enrolled")
    .reduce((sum, r) => sum + creditsOf(r.course) / 2, 0);
  // 今年度の残りの学期に登録済みの単位も引く（前期の学生の後期の登録。監査の第2.5回の A25-1）
  const enrolledIn = (term: "前期" | "後期") =>
    registered
      .filter((r) => r.term === term && r.result === "enrolled")
      .reduce((sum, r) => sum + creditsOf(r.course), 0);
  const perYear = new Map<number, number>();
  for (let term = now + 1; term <= deadline; term += 1) {
    const year = Math.floor(term / 2) + 1;
    const thisYear = year === student.studentYear;
    const room = maxPerTerm - (thisYear ? yearLongHalf + enrolledIn(term % 2 === 0 ? "前期" : "後期") : 0);
    perYear.set(year, (perYear.get(year) ?? 0) + Math.max(0, room));
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

// 延期見込みの計算に使う、学生に適用されるルール。
function delayInputs({ rules, student }: EvaluationContext) {
  const applies = ({ when }: { when?: Gate["when"] }) => matchesCondition(when, student);
  const retake = rules.retake && disqualifiedCourses(student).size > 0 ? [rules.retake] : [];
  return [
    ...rules.prerequisites.filter(applies),
    ...(rules.enrollment ? [rules.enrollment] : []),
    ...rules.loadLimits.filter(applies),
    ...retake,
  ];
}

// 判定に使えない情報があるときは、延期見込みにせず unknown を返す。
function judgeDelay(context: EvaluationContext, projected: CreditAllocation) {
  const { rules, student, unresolved } = context;
  if (!student.expectedGraduation) return "none";
  const deadline = termIndex(student.expectedGraduation);
  // 要確認のルールは中身そのものが未確定なので、読み方の両端を計算できない。
  if (delayInputs(context).some((rule) => rule.status === "needs_review")) return "unknown";

  if (requiredCoursesCertainlyLate(context)) return "delay";
  const lateIfClosed = requiredCoursesTooLate(context, deadline, true).tooLate;
  if (lateIfClosed) return "unknown";

  const shortfall = shortfallCredits(rules, student, projected);
  if (shortfall === 0) return "none";
  // 翌年度の前年度 GPA はまだないので、緩和なしで足りるなら none、緩和しても足りないなら delay にする。
  const limitsFor = (candidate: Student) =>
    rules.loadLimits.filter((limit) => matchesCondition(limit.when, candidate));
  const nextYears = Math.floor(deadline / 2) + 1 > student.studentYear;
  const { previousGpa: _unknown, ...withoutGpa } = student;
  const reachable = limitsFor(nextYears ? { ...student, previousGpa: Number.MAX_VALUE } : student);
  const highest = reachable.at(-1);
  const lowest = nextYears ? limitsFor(withoutGpa).at(-1) : highest;
  if (!highest || !lowest) return "unknown";
  if (reachable.some((limit) => pendingIds(limit, unresolved).length > 0)) return "unknown";
  const capacity = ({ maxPerTerm, maxPerYear }: LoadLimit) =>
    maxRemainingCredits(context, deadline, maxPerTerm, maxPerYear);
  if (shortfall <= capacity(lowest)) return "none";
  if (shortfall <= capacity(highest)) return "unknown";
  return highest.retakeExclusion === "none" ? "delay" : "unknown";
}

// 不足の必修が卒業予定に間に合わないことが、履修の順だけで確かめられるか。未回答の履修条件や先修は楽観側で計算する。
// 卒業要件の合計単位と年数は使わない（judgeDelay の最初の段と同じ条件）
function requiredCoursesCertainlyLate(context: EvaluationContext) {
  const { student } = context;
  if (!student.expectedGraduation) return false;
  if (delayInputs(context).some((rule) => rule.status === "needs_review")) return false;
  return requiredCoursesTooLate(context, termIndex(student.expectedGraduation), false).tooLate;
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
  // 決定は「修得した学生」について。履修中だけの科目は今までどおり（延期見込みの計算で単位に数えない）
  const stray = current.uncategorized;
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
    uncountedCourses: stray,
    ambiguityIds: [...new Set([...ownIds, ...uncertainIds])],
    needsContact: false,
  };

  const delayRisk = (): Judgment => {
    const deadline = termIndex(student.expectedGraduation!);
    const { courses, grounds } = explainDelay(context, deadline);
    const clauses = [...new Set(grounds.map(({ clause }) => clause))].join("、");
    const reason =
      courses.length > 0
        ? `${courses.join("、")} が卒業予定に間に合わない見込みです。履修の順は${clauses}で決まります。職員と確認してください。`
        : "卒業予定までの履修機会では足りない見込みです。職員と確認してください。";
    return { ...base, status: "delay_risk", reason, grounds, needsContact: true };
  };

  // 未確定の区分や卒業要件自身の曖昧箇所があっても、確定の区分の不足は読み方に関わらず確か（AGENTS.md、H30）。
  // ただし区分に入らない科目があると、算入先しだいで不足が消えうるので職員確認のまま。
  // 卒業要件そのものが要確認（review:）のときは、ルール全体が未確定なので職員確認のまま（H30 は未回答の曖昧箇所の決定）
  const ownReview = ownIds.some((id) => id.startsWith("review:"));
  if ((ownIds.length > 0 || uncertainIds.length > 0) && !ownReview && stray.length === 0 && shortCategories.length > 0) {
    // 区分がすべて確定していれば、必修が卒業予定に間に合わないことは履修の順だけで決まり、合計単位と年数の読み方に関わらない。
    // どう答えても延期見込みになる学生を、最終年次より前だからと対応なしにしない（H31、第3回の監査 A3-2）
    if (uncertainIds.length === 0 && requiredCoursesCertainlyLate(context)) return delayRisk();
    const reason = `${shortCategories.join("、")}に不足があります。`;
    return { ...base, status: "short", reason, needsContact: finalYear };
  }
  if (ownIds.length > 0) {
    return { ...base, status: "needs_staff", reason: unresolvedReason(context, base.ambiguityIds) };
  }
  // どの区分にも入らない科目は、単位を黙って捨てずに職員が確認する（監査の第1回の A1-26、人の決定）
  if (stray.length > 0) {
    const reason = `どの区分にも入らない科目があります（${stray.join("、")}）。卒業に算入できるかを職員が確認します。`;
    return { ...base, status: "needs_staff", reason };
  }
  if (uncertainIds.length > 0) {
    return { ...base, status: "needs_staff", reason: unresolvedReason(context, base.ambiguityIds) };
  }

  const yearsMet = student.yearsEnrolled >= graduation.minYears;
  const creditsMet = current.counted >= graduation.totalCredits;
  if (yearsMet && creditsMet && categories.every((c) => c.status === "satisfied")) {
    return { ...base, status: "satisfied", reason: "卒業に必要な要件を満たしています。" };
  }

  const delay = judgeDelay(context, projected);
  if (delay === "delay") return delayRisk();
  if (delay === "unknown") {
    const inputIds = delayInputs(context).flatMap((rule) => pendingIds(rule, unresolved));
    return {
      ...base,
      ambiguityIds: [...new Set([...base.ambiguityIds, ...inputIds])],
      status: "needs_staff",
      reason: "卒業の見込みを判定できないため、職員が確認します。",
    };
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
