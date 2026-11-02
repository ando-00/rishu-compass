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
  type Answers,
  type Course,
  type CourseIndex,
  type Student,
} from "./model";
import type { Category, Gate, RuleSet } from "./rules";

export type JudgmentStatus = "met" | "unmet" | "pending" | "needs_staff";

export type Judgment = {
  ruleId: string;
  kind: "graduation" | "category" | "gate";
  name: string;
  clause: string;
  status: JudgmentStatus;
  reason: string;
  ambiguityIds: string[];
  required?: number;
  actual?: number;
  missingCourses?: string[];
  atRisk?: boolean;
  eligibleFromYear?: number;
};

export type StudentEvaluation = {
  studentId: string;
  excludedReason: string | null;
  judgments: Judgment[];
};

export type EvaluationContext = {
  rules: RuleSet;
  catalog: CourseIndex;
  student: Student;
  unresolved: Set<string>;
  uncertainCategories: Map<string, string[]>;
};

const UNRESOLVED_REASON = "未回答の確認事項があるため、職員が確認します。";

export function exclusionReason(rules: RuleSet, student: Student) {
  if (student.specialStatuses.length > 0) {
    return `${student.specialStatuses.join("、")}に該当するため、職員が確認します。`;
  }
  if (!rules.admissionYears.includes(student.admissionYear)) {
    return `入学年度 ${student.admissionYear} はこの要項の適用外のため、職員が確認します。`;
  }
  return null;
}

function unresolvedIds(ids: string[] | undefined, unresolved: Set<string>) {
  return (ids ?? []).filter((id) => unresolved.has(id));
}

// 超過分を受け取る区分は、送り元の区分が未確定なら同じく未確定になる。
function findUncertainCategories(categories: Category[], unresolved: Set<string>) {
  const uncertain = new Map<string, string[]>();
  for (const category of sortByOverflow(categories)) {
    const ids = [
      ...new Set([
        ...unresolvedIds(category.ambiguityIds, unresolved),
        ...(uncertain.get(category.id) ?? []),
      ]),
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

export function createContext(
  baseRules: RuleSet,
  courses: Course[],
  student: Student,
  answers: Answers,
): EvaluationContext {
  const { rules, unresolved } = resolveRules(baseRules, answers);
  return {
    rules,
    catalog: indexCourses(courses),
    student,
    unresolved,
    uncertainCategories: findUncertainCategories(applicableCategories(rules, student), unresolved),
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
    required: category.minCredits,
    actual: allocation.total,
    missingCourses: allocation.missingCourses,
    ambiguityIds: uncertainCategories.get(category.id) ?? [],
  };

  if (base.ambiguityIds.length > 0) {
    return { ...base, status: "needs_staff", reason: UNRESOLVED_REASON };
  }
  if (isCategoryMet(category, allocation)) {
    return { ...base, status: "met", reason: "必要な単位を満たしています。" };
  }
  if (student.studentYear < rules.graduation.minYears) {
    return { ...base, status: "pending", reason: "在学中のため、判定はまだ確定しません。" };
  }
  if (isCategoryMet(category, allocationOf(projected, category))) {
    return { ...base, status: "pending", reason: "履修中の科目の結果を待ちます。" };
  }
  return { ...base, status: "unmet", reason: "必要な単位または科目が不足しています。" };
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
  const ownIds = unresolvedIds(graduation.ambiguityIds, unresolved);
  const base = {
    ruleId: graduation.id,
    kind: "graduation" as const,
    name: "卒業要件",
    clause: graduation.clause,
    required: graduation.totalCredits,
    actual: current.counted,
    ambiguityIds: [...new Set([...ownIds, ...uncertainIds])],
  };

  if (ownIds.length > 0) {
    return { ...base, status: "needs_staff", reason: UNRESOLVED_REASON };
  }
  const shortages = categories.filter((category) => category.status === "unmet");
  if (shortages.length > 0) {
    const names = shortages.map((category) => category.name).join("、");
    return { ...base, status: "unmet", reason: `${names}に不足があります。` };
  }
  if (uncertainIds.length > 0) {
    return { ...base, status: "needs_staff", reason: UNRESOLVED_REASON };
  }

  const beforeFinalYear = student.studentYear < graduation.minYears;
  const creditsMet = current.counted >= graduation.totalCredits;
  if (!beforeFinalYear && creditsMet && categories.every((c) => c.status === "met")) {
    return { ...base, status: "met", reason: "卒業に必要な要件を満たしています。" };
  }
  if (beforeFinalYear) {
    return { ...base, status: "pending", reason: "在学中のため、判定はまだ確定しません。" };
  }
  if (projected.counted >= graduation.totalCredits) {
    return { ...base, status: "pending", reason: "履修中の科目の結果を待ちます。" };
  }
  return { ...base, status: "unmet", reason: "合計単位が不足しています。" };
}

function gateProgress(gate: Gate, context: EvaluationContext, passed: Set<string>) {
  const { rules, catalog, student } = context;
  const allocation = allocateCredits(rules, catalog, student, passed);
  const actual = gate.creditBasis === "countable" ? allocation.counted : allocation.earned;
  const missingCourses = gate.requiredCourses.filter((name) => !passed.has(name));
  const satisfied = actual >= (gate.minCredits ?? 0) && missingCourses.length === 0;
  return { actual, missingCourses, satisfied };
}

export function judgeGate(gate: Gate, context: EvaluationContext): Judgment {
  const { student, unresolved, uncertainCategories } = context;
  const check = gate.checkAtEndOfYear;
  const present = gateProgress(gate, context, passedCourses(student));
  const projected = gateProgress(gate, context, passedCourses(student, { includeEnrolled: true }));
  const inherited = gate.creditBasis === "countable" ? [...uncertainCategories.values()].flat() : [];
  const ambiguityIds = [...new Set([...unresolvedIds(gate.ambiguityIds, unresolved), ...inherited])];
  const base = {
    ruleId: gate.id,
    kind: "gate" as const,
    name: gate.name,
    clause: gate.clause,
    required: gate.minCredits,
    ambiguityIds,
  };
  const progress = ({ actual, missingCourses }: typeof present) => ({ actual, missingCourses });

  if (gate.target.kind === "promotion" && student.studentYear >= gate.target.toYear) {
    return {
      ...base,
      ...progress(present),
      ambiguityIds: [],
      status: "met",
      reason: "進級済みです。",
    };
  }

  if (ambiguityIds.length > 0) {
    return { ...base, ...progress(present), status: "needs_staff", reason: UNRESOLVED_REASON };
  }

  if (student.studentYear <= check) {
    if (present.satisfied) {
      return { ...base, ...progress(present), status: "met", reason: "条件を満たしています。" };
    }
    const atRisk = student.studentYear === check && !projected.satisfied;
    const reason = atRisk
      ? `${check}年次の終わりまでに条件を満たせない見込みです。`
      : `${check}年次の終わりに判定します。`;
    return { ...base, ...progress(present), status: "pending", reason, atRisk };
  }

  const atCheck = gateProgress(gate, context, passedCourses(student, { throughYear: check }));
  if (atCheck.satisfied) {
    return { ...base, ...progress(atCheck), status: "met", reason: "条件を満たしています。" };
  }
  if (!gate.retryAfterMet) {
    const reason = `${check}年次の終わりの時点で条件を満たしていません。`;
    return { ...base, ...progress(atCheck), status: "unmet", reason };
  }

  for (let year = check + 1; year < student.studentYear; year += 1) {
    const later = gateProgress(gate, context, passedCourses(student, { throughYear: year }));
    if (later.satisfied) {
      const reason = `${year}年次に条件を満たしたため、${year + 1}年次から認められます。`;
      return {
        ...base,
        ...progress(later),
        status: "met",
        reason,
        eligibleFromYear: year + 1,
      };
    }
  }
  if (present.satisfied || projected.satisfied) {
    const reason = `条件を満たせば、${student.studentYear + 1}年次から認められます。`;
    return {
      ...base,
      ...progress(present),
      status: "pending",
      reason,
      eligibleFromYear: student.studentYear + 1,
    };
  }
  return {
    ...base,
    ...progress(present),
    status: "unmet",
    reason: `${check}年次の終わりの時点で条件を満たしておらず、その後も満たしていません。`,
  };
}

function excludedJudgments(rules: RuleSet, student: Student, reason: string): Judgment[] {
  const base = { status: "needs_staff" as const, reason, ambiguityIds: [] };
  return [
    ...applicableCategories(rules, student).map((category) => ({
      ...base,
      ruleId: category.id,
      kind: "category" as const,
      name: category.name,
      clause: category.clause,
    })),
    {
      ...base,
      ruleId: rules.graduation.id,
      kind: "graduation" as const,
      name: "卒業要件",
      clause: rules.graduation.clause,
    },
    ...rules.gates
      .filter((gate) => matchesCondition(gate.when, student))
      .map((gate) => ({
        ...base,
        ruleId: gate.id,
        kind: "gate" as const,
        name: gate.name,
        clause: gate.clause,
      })),
  ];
}

export function evaluateStudent(
  baseRules: RuleSet,
  courses: Course[],
  student: Student,
  answers: Answers,
): StudentEvaluation {
  const reason = exclusionReason(baseRules, student);
  if (reason) {
    const { rules } = resolveRules(baseRules, answers);
    return {
      studentId: student.id,
      excludedReason: reason,
      judgments: excludedJudgments(rules, student, reason),
    };
  }

  const context = createContext(baseRules, courses, student, answers);
  const { rules, catalog } = context;
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

  return {
    studentId: student.id,
    excludedReason: null,
    judgments: [
      ...categories,
      judgeGraduation(context, categories, current, projected),
      ...gates,
    ],
  };
}
