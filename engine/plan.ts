import {
  createContext,
  exclusionReason,
  judgeGate,
  pendingIds,
  prepareRules,
  type EvaluationContext,
} from "./evaluate";
import {
  findCourse,
  matchesCondition,
  disqualifiedCourses,
  passedCourses,
  type Answers,
  type Course,
  type CourseRecord,
  type CourseSlot,
  type OfferedTerm,
  type Student,
} from "./model";
import type { Gate, LoadLimit, RuleSet } from "./rules";

export type PlanEntry = {
  course: string;
  term: OfferedTerm;
};

export type PlanIssueCode =
  | "TIME_CONFLICT"
  | "OVER_LIMIT"
  | "PREREQUISITE_NOT_MET"
  | "NOT_OFFERED"
  | "WRONG_YEAR"
  | "ALREADY_EARNED"
  | "DISQUALIFIED_RETAKE"
  | "SEMINAR_LOCKED"
  | "CATEGORY_LIMIT"
  | "PENDING_RULE"
  | "UNKNOWN_COURSE";

export type PlanIssue = {
  code: PlanIssueCode;
  ruleId: string;
  clause: string;
  sourceQuote: string;
  course?: string;
  message: string;
  hint: string;
  ambiguityIds: string[];
};

export type PlanCheck = {
  status: "passed" | "failed" | "needs_staff";
  issues: PlanIssue[];
  warnings: string[];
};

type Rule = { id: string; clause: string; sourceQuote: string; ambiguityIds?: string[]; status?: "confirmed" | "needs_review" };

const DATA_RULE: Rule = { id: "course-data", clause: "科目データ", sourceQuote: "" };
const TIMETABLE_RULE: Rule = { id: "timetable", clause: "時間割", sourceQuote: "" };
const UNRESOLVED_MESSAGE = "未回答の確認事項があるため、職員が確認します。";

// 検査の前提のうち、学生の記録だけでは表せないもの。
export type PlanAssumptions = {
  // 履修中だが、履修条件が未回答で決まらない科目
  pendingCourses?: string[];
  // 翌年度の案が前提にするのに、決まっていない進級
  promotions?: Gate[];
};

export function isDisplayablePlan(check: PlanCheck) {
  return check.status === "passed";
}

function enrolledGates(rules: RuleSet, courses: Course[], student: Student, answers: Answers) {
  const prepared = prepareRules(rules, courses, answers);
  if (exclusionReason(prepared, student)) return [];
  const context = createContext(prepared, student);
  const enrolled = student.records
    .filter((record) => record.result === "enrolled" && record.studentYear === student.studentYear)
    .map((record) => record.course);

  return prepared.rules.gates.flatMap((gate) => {
    if (gate.target.kind !== "course" || !matchesCondition(gate.when, student)) return [];
    const { status } = judgeGate(gate, context);
    if (status === "satisfied") return [];
    const { courses: targets } = gate.target;
    return enrolled.filter((name) => targets.includes(name)).map((name) => ({ name, status }));
  });
}

// 今年度に履修中でも、履修条件を満たしていない科目を返す。回答した読み方で条件から外れることがある。
export function lockedEnrollments(
  rules: RuleSet,
  courses: Course[],
  student: Student,
  answers: Answers,
) {
  return enrolledGates(rules, courses, student, answers).map(({ name }) => name);
}

// そのうち、未回答で履修条件が決まらない科目を返す。修得の前提にはしないが、満たしていないとは言わない。
export function unresolvedEnrollments(
  rules: RuleSet,
  courses: Course[],
  student: Student,
  answers: Answers,
) {
  return enrolledGates(rules, courses, student, answers)
    .filter(({ status }) => status === "needs_staff")
    .map(({ name }) => name);
}

// 翌年度の案が前提にする進級のうち、不足か未確定のものを返す。履修中の修得を見込むものは含めない。
export function pendingPromotions(rules: RuleSet, courses: Course[], student: Student, answers: Answers) {
  if (student.currentTerm === "前期") return [];
  const prepared = prepareRules(rules, courses, answers);
  if (exclusionReason(prepared, student)) return [];
  const context = createContext(prepared, student);
  return prepared.rules.gates.filter((gate) => {
    if (gate.target.kind !== "promotion" || gate.target.toYear !== student.studentYear + 1) return false;
    if (!matchesCondition(gate.when, student)) return false;
    const { status } = judgeGate(gate, context);
    return status === "needs_staff" || status === "short";
  });
}

// 後期の学生の案は翌年度の登録になるので、今年度の履修中を修得した前提に置き換える。
// 翌年度の前年度 GPA はまだないので持たせず、緩和の上限を使わない。
// locked の科目は修得の前提にできず、案に入れ直す科目なので記録から外す。
export function planningStudent(student: Student, locked: string[] = []): Student {
  const current = (record: CourseRecord) =>
    record.result === "enrolled" && record.studentYear === student.studentYear;
  if (student.currentTerm === "前期") {
    if (locked.length === 0) return student;
    const records = student.records.filter(
      (record) => !(current(record) && locked.includes(record.course)),
    );
    return { ...student, records };
  }
  const { previousGpa: _unknown, ...rest } = student;
  return {
    ...rest,
    studentYear: student.studentYear + 1,
    currentTerm: "前期",
    yearsEnrolled: student.yearsEnrolled + 1,
    records: student.records
      .filter((record) => !(current(record) && locked.includes(record.course)))
      .map((record) => (current(record) ? { ...record, result: "passed" as const } : record)),
  };
}

function overlaps(a: OfferedTerm, b: OfferedTerm) {
  return a === b || a === "通年" || b === "通年";
}

function isEarlier(a: OfferedTerm, b: OfferedTerm) {
  return a === "前期" && b === "後期";
}

function slotsCollide(a: CourseSlot, b: CourseSlot) {
  if (a.day !== b.day || a.period !== b.period) return false;
  return a.quarter === undefined || b.quarter === undefined || a.quarter === b.quarter;
}

class PlanChecker {
  readonly issues: PlanIssue[] = [];
  readonly warnings: string[] = [];
  private readonly context: EvaluationContext;
  private readonly plan: PlanEntry[];
  private readonly scheduled: PlanEntry[];

  constructor(
    context: EvaluationContext,
    plan: PlanEntry[],
    private readonly assumptions: PlanAssumptions,
  ) {
    this.context = context;
    this.plan = plan.filter((entry) => context.catalog.has(entry.course));
    const { student } = context;
    const enrolled = student.records
      .filter((record) => record.result === "enrolled" && record.studentYear === student.studentYear)
      .map(({ course, term }) => ({ course, term }));
    this.scheduled = [...this.plan, ...enrolled];

    for (const entry of plan) {
      if (!context.catalog.has(entry.course)) {
        const message = `${entry.course} は科目データにありません。`;
        this.add("UNKNOWN_COURSE", DATA_RULE, message, "科目名を確認してください。", entry.course);
      }
    }
  }

  private add(code: PlanIssueCode, rule: Rule, message: string, hint: string, course?: string) {
    this.issues.push({
      code,
      ruleId: rule.id,
      clause: rule.clause,
      sourceQuote: rule.sourceQuote,
      message,
      hint,
      ambiguityIds: [],
      ...(course ? { course } : {}),
    });
  }

  // 未確定のルールは、違反の有無にかかわらず職員確認にする。
  private deferIfUnresolved(rule: Rule, course?: string) {
    const ambiguityIds = pendingIds(rule, this.context.unresolved);
    if (ambiguityIds.length === 0) return false;
    this.issues.push({
      code: "PENDING_RULE",
      ruleId: rule.id,
      clause: rule.clause,
      sourceQuote: rule.sourceQuote,
      message: UNRESOLVED_MESSAGE,
      hint: "曖昧箇所に回答すると検査できます。",
      ambiguityIds,
      ...(course ? { course } : {}),
    });
    return true;
  }

  private course(name: string) {
    return findCourse(this.context.catalog, name);
  }

  checkPromotions() {
    for (const rule of this.assumptions.promotions ?? []) {
      const message = `${rule.name} が決まっていないので、翌年次の案は職員が確認します。`;
      this.add("PENDING_RULE", rule, message, "進級の条件を確かめてください。");
    }
  }

  checkDuplicates() {
    const { student } = this.context;
    const seen = new Set<string>();
    for (const { course } of this.plan) {
      if (seen.has(course)) {
        this.add("ALREADY_EARNED", DATA_RULE, `${course} が重複しています。`, "1つにしてください。", course);
      }
      seen.add(course);
      const inProgress = student.records.some(
        (record) => record.course === course && record.result === "enrolled",
      );
      if (inProgress) {
        this.add("ALREADY_EARNED", DATA_RULE, `${course} は履修中です。`, "案から外してください。", course);
      }
    }
  }

  checkOffering() {
    for (const { course, term } of this.plan) {
      const { offeredIn } = this.course(course);
      if (offeredIn !== undefined && offeredIn !== term) {
        const message = `${course} は${offeredIn}の科目です。`;
        this.add("NOT_OFFERED", DATA_RULE, message, `${offeredIn}に入れ直してください。`, course);
      }
    }
  }

  checkEnrollment() {
    const { rules, student } = this.context;
    const rule = rules.enrollment;
    if (!rule || this.deferIfUnresolved(rule)) return;
    const passed = passedCourses(student);
    for (const { course } of this.plan) {
      const { assignedYear } = this.course(course);
      if (rule.forbidBeforeAssignedYear && student.studentYear < assignedYear) {
        const message = `${course} は${assignedYear}年次からの科目です。`;
        this.add("WRONG_YEAR", rule, message, `${assignedYear}年次以降に入れてください。`, course);
      }
      if (rule.forbidRetakeOfPassed && passed.has(course)) {
        this.add("ALREADY_EARNED", rule, `${course} は修得済みです。`, "案から外してください。", course);
      }
    }
  }

  checkRetake() {
    const { rules, student } = this.context;
    const rule = rules.retake;
    if (!rule) return;
    const passed = passedCourses(student);
    const disqualified = disqualifiedCourses(student);
    for (const { course } of this.plan) {
      if (!disqualified.has(course) || passed.has(course)) continue;
      if (this.deferIfUnresolved(rule, course)) continue;
      if (rule.forbidDisqualified) {
        const message = `${course} は失格のため再び履修できません。`;
        this.add("DISQUALIFIED_RETAKE", rule, message, "案から外してください。", course);
      }
    }
  }

  checkPrerequisites() {
    const { rules, student } = this.context;
    const passed = passedCourses(student);
    for (const entry of this.plan) {
      for (const rule of rules.prerequisites) {
        if (rule.course !== entry.course || !matchesCondition(rule.when, student)) continue;
        if (this.deferIfUnresolved(rule, entry.course)) continue;

        const others = (name: string) => this.scheduled.filter((other) => other.course === name);
        const earlier = (name: string) => others(name).some((o) => isEarlier(o.term, entry.term));
        const together = (name: string) =>
          rule.allowSameTerm && others(name).some((o) => overlaps(o.term, entry.term));
        const available = (name: string) => passed.has(name) || earlier(name) || together(name);

        const met = rule.conditions.find((names) => names.every(available));
        const pending = rule.conditions
          .flat()
          .find((name) => this.assumptions.pendingCourses?.includes(name));
        if (!met && pending) {
          // 前提の科目の履修条件が未回答で決まらないので、不合格と言い切らない。
          const message = `${entry.course} の前提の ${pending} は、履修条件が未確定です。${UNRESOLVED_MESSAGE}`;
          this.add("PENDING_RULE", rule, message, "曖昧箇所に回答すると検査できます。", entry.course);
          continue;
        }
        if (!met) {
          const need = rule.conditions.map((names) => names.join("と")).join("または");
          const message = `${entry.course} には ${need} の修得が必要です。`;
          this.add("PREREQUISITE_NOT_MET", rule, message, `先に ${need} を修得してください。`, entry.course);
          continue;
        }
        for (const name of met.filter((n) => !passed.has(n))) {
          this.warnings.push(`${entry.course} は ${name} の修得を前提にしています。不合格の場合は組み直しが必要です。`);
        }
      }
    }
  }

  checkGates() {
    const { rules, student } = this.context;
    for (const gate of rules.gates) {
      if (gate.target.kind !== "course" || !matchesCondition(gate.when, student)) continue;
      const { courses } = gate.target;
      for (const { course } of this.plan.filter((entry) => courses.includes(entry.course))) {
        const judgment = judgeGate(gate, this.context);
        // 判定年次のうちは、条件を満たしていても判定の翌年次まで履修できない。
        const firstYear = gate.checkAtEndOfYear + 1;
        if (judgment.status === "satisfied") {
          if (student.studentYear >= firstYear) continue;
          const message = `${gate.name}は${firstYear}年次から履修できます。`;
          this.add("SEMINAR_LOCKED", gate, message, message, course);
          continue;
        }
        if (judgment.status === "needs_staff") {
          this.issues.push({
            code: "PENDING_RULE",
            ruleId: gate.id,
            clause: gate.clause,
            sourceQuote: gate.sourceQuote,
            course,
            message: judgment.reason,
            hint: "曖昧箇所に回答すると検査できます。",
            ambiguityIds: judgment.ambiguityIds,
          });
          continue;
        }
        const hint = judgment.eligibleFromYear
          ? `${judgment.eligibleFromYear}年次から履修できます。`
          : "条件を満たしてから履修してください。";
        this.add("SEMINAR_LOCKED", gate, judgment.reason, hint, course);
      }
    }
  }

  private isExcludedRetake(limit: LoadLimit, course: string, before: number) {
    if (limit.retakeExclusion === "none") return false;
    return this.context.student.records.some((record) => {
      if (record.course !== course || record.studentYear >= before) return false;
      if (record.result === "failed") return true;
      return record.result === "disqualified" && limit.retakeExclusion === "failed_or_disqualified";
    });
  }

  private loadItems(limit: LoadLimit) {
    const { student } = this.context;
    const registered = student.records.filter((record) => record.studentYear === student.studentYear);
    return [
      ...this.plan.filter(
        (entry) => !this.isExcludedRetake(limit, entry.course, student.studentYear + 1),
      ),
      ...registered
        .filter((record) => !this.isExcludedRetake(limit, record.course, record.studentYear))
        .map(({ course, term }) => ({ course, term })),
    ];
  }

  checkLoad() {
    const { rules, student } = this.context;
    const applicable = rules.loadLimits.filter((limit) => matchesCondition(limit.when, student));
    const limit = applicable.at(-1);
    if (!limit) {
      const message = "この学生に適用する履修上限がないため、職員が確認します。";
      this.issues.push({
        code: "PENDING_RULE",
        ruleId: "load-limit",
        clause: "履修上限",
        sourceQuote: "",
        message,
        hint: "ルールの履修上限を確認してください。",
        ambiguityIds: [],
      });
      return;
    }
    const deferred = applicable.map((rule) => this.deferIfUnresolved(rule)).some(Boolean);
    if (deferred) return;

    const load = { 前期: 0, 後期: 0 };
    for (const { course, term } of this.loadItems(limit)) {
      const { credits } = this.course(course);
      if (term === "通年") {
        load.前期 += credits / 2;
        load.後期 += credits / 2;
      } else load[term] += credits;
    }

    const hint = "優先度の低い科目を外してください。";
    for (const term of ["前期", "後期"] as const) {
      if (load[term] > limit.maxPerTerm) {
        const message = `${term}の履修単位 ${load[term]} が上限 ${limit.maxPerTerm} を超えています。`;
        this.add("OVER_LIMIT", limit, message, hint);
      }
    }
    const year = load.前期 + load.後期;
    if (limit.maxPerYear !== undefined && year > limit.maxPerYear) {
      const message = `年間の履修単位 ${year} が上限 ${limit.maxPerYear} を超えています。`;
      this.add("OVER_LIMIT", limit, message, hint);
    }
  }

  checkCourseCounts() {
    const { rules, student } = this.context;
    for (const rule of rules.courseCountLimits) {
      if (!matchesCondition(rule.when, student)) continue;
      const inGroup = this.scheduled.filter(({ course }) =>
        this.course(course).groups.includes(rule.group),
      );
      if (inGroup.length === 0 || this.deferIfUnresolved(rule)) continue;
      for (const term of ["前期", "後期"] as const) {
        const count = inGroup.filter((entry) => overlaps(entry.term, term)).length;
        if (count > rule.maxPerTerm) {
          const message = `${term}の${rule.group}が ${count} 科目で、上限 ${rule.maxPerTerm} を超えています。`;
          this.add("CATEGORY_LIMIT", rule, message, `${rule.group}を別の学期へ移してください。`);
        }
      }
    }
  }

  checkTimetable() {
    this.plan.forEach((entry, index) => {
      const course = this.course(entry.course);
      if (course.intensive) return;
      const slots = course.slots ?? [];
      for (const other of this.scheduled.slice(index + 1)) {
        const otherCourse = this.course(other.course);
        if (other.course === entry.course || otherCourse.intensive) continue;
        if (!overlaps(entry.term, other.term)) continue;
        if (slots.some((a) => (otherCourse.slots ?? []).some((b) => slotsCollide(a, b)))) {
          const message = `${entry.course} と ${other.course} の時限が重なっています。`;
          this.add("TIME_CONFLICT", TIMETABLE_RULE, message, "どちらかを別の時限へ移してください。", entry.course);
        }
      }
    });
  }
}

function needsStaffCheck(message: string): PlanCheck {
  const issue: PlanIssue = {
    code: "PENDING_RULE",
    ruleId: "excluded",
    clause: "作業ルール",
    sourceQuote: "",
    message,
    hint: "職員が確認してください。",
    ambiguityIds: [],
  };
  return { status: "needs_staff", issues: [issue], warnings: [] };
}

export function checkPlan(
  rules: RuleSet,
  courses: Course[],
  student: Student,
  plan: PlanEntry[],
  answers: Answers,
  assumptions: PlanAssumptions = {},
): PlanCheck {
  const prepared = prepareRules(rules, courses, answers);
  const reason = exclusionReason(prepared, student);
  if (reason) return needsStaffCheck(reason);

  // エラーは例外で止めず、職員確認にする。
  try {
    const checker = new PlanChecker(createContext(prepared, student), plan, assumptions);
    checker.checkPromotions();
    checker.checkDuplicates();
    checker.checkOffering();
    checker.checkEnrollment();
    checker.checkRetake();
    checker.checkPrerequisites();
    checker.checkGates();
    checker.checkLoad();
    checker.checkCourseCounts();
    checker.checkTimetable();

    const { issues, warnings } = checker;
    if (issues.some((issue) => issue.code !== "PENDING_RULE")) {
      return { status: "failed", issues, warnings };
    }
    if (issues.length > 0) return { status: "needs_staff", issues, warnings };
    return { status: "passed", issues, warnings };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "検査できません";
    return needsStaffCheck(`案を検査できないため、職員が確認します（${detail}）。`);
  }
}
