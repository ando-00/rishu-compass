import { createContext, exclusionReason, judgeGate, type EvaluationContext } from "./evaluate";
import {
  findCourse,
  indexCourses,
  matchesCondition,
  passedCourses,
  type Answers,
  type Course,
  type CourseSlot,
  type OfferedTerm,
  type Student,
} from "./model";
import type { LoadLimit, RuleSet } from "./rules";

export type PlanEntry = {
  course: string;
  term: OfferedTerm;
};

export type PlanIssue = {
  ruleId: string;
  clause: string;
  severity: "violation" | "needs_staff";
  course?: string;
  message: string;
  ambiguityIds: string[];
};

export type PlanCheck = {
  status: "passed" | "failed" | "needs_staff";
  issues: PlanIssue[];
};

type Rule = { id: string; clause: string; ambiguityIds?: string[] };

const UNRESOLVED_MESSAGE = "未回答の確認事項があるため、職員が確認します。";

export function isDisplayablePlan(check: PlanCheck) {
  return check.status === "passed";
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
  private readonly context: EvaluationContext;
  private readonly plan: PlanEntry[];
  private readonly scheduled: PlanEntry[];

  constructor(context: EvaluationContext, plan: PlanEntry[]) {
    this.context = context;
    this.plan = plan.filter((entry) => context.catalog.has(entry.course));
    const { student } = context;
    const enrolled = student.records
      .filter((record) => record.result === "enrolled" && record.studentYear === student.studentYear)
      .map(({ course, term }) => ({ course, term }));
    this.scheduled = [...this.plan, ...enrolled];

    for (const entry of plan) {
      if (!context.catalog.has(entry.course)) {
        this.addViolation("catalog", "科目データ", `${entry.course} は科目データにありません。`, entry.course);
      }
    }
  }

  private addViolation(ruleId: string, clause: string, message: string, course?: string) {
    this.issues.push({
      ruleId,
      clause,
      severity: "violation",
      message,
      ambiguityIds: [],
      ...(course ? { course } : {}),
    });
  }

  private unresolvedOf(rule: Rule) {
    return (rule.ambiguityIds ?? []).filter((id) => this.context.unresolved.has(id));
  }

  // 未確定のルールは、違反の有無にかかわらず職員確認にする。
  private deferIfUnresolved(rule: Rule, course?: string) {
    const ambiguityIds = this.unresolvedOf(rule);
    if (ambiguityIds.length === 0) return false;
    this.issues.push({
      ruleId: rule.id,
      clause: rule.clause,
      severity: "needs_staff",
      message: UNRESOLVED_MESSAGE,
      ambiguityIds,
      ...(course ? { course } : {}),
    });
    return true;
  }

  private course(name: string) {
    return findCourse(this.context.catalog, name);
  }

  checkDuplicates() {
    const { student } = this.context;
    const seen = new Set<string>();
    for (const { course } of this.plan) {
      if (seen.has(course)) {
        this.addViolation("duplicate", "科目データ", `${course} が重複しています。`, course);
      }
      seen.add(course);
      const inProgress = student.records.some(
        (record) => record.course === course && record.result === "enrolled",
      );
      if (inProgress) {
        this.addViolation("duplicate", "科目データ", `${course} は履修中です。`, course);
      }
    }
  }

  checkOffering() {
    for (const { course, term } of this.plan) {
      const { offeredIn } = this.course(course);
      if (offeredIn !== undefined && offeredIn !== term) {
        this.addViolation("offering", "科目データ", `${course} は${offeredIn}の科目です。`, course);
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
        this.addViolation(rule.id, rule.clause, `${course} は${assignedYear}年次からの科目です。`, course);
      }
      if (rule.forbidRetakeOfPassed && passed.has(course)) {
        this.addViolation(rule.id, rule.clause, `${course} は修得済みです。`, course);
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
        const satisfied = rule.anyOf.some(
          (name) =>
            passed.has(name) ||
            this.scheduled.some(
              (other) =>
                other.course === name &&
                (isEarlier(other.term, entry.term) ||
                  (rule.allowSameTerm && overlaps(other.term, entry.term))),
            ),
        );
        if (!satisfied) {
          const message = `${entry.course} には ${rule.anyOf.join("または")} の修得が必要です。`;
          this.addViolation(rule.id, rule.clause, message, entry.course);
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
        if (judgment.status === "met") continue;
        this.issues.push({
          ruleId: gate.id,
          clause: gate.clause,
          severity: judgment.status === "needs_staff" ? "needs_staff" : "violation",
          course,
          message: judgment.reason,
          ambiguityIds: judgment.ambiguityIds,
        });
      }
    }
  }

  private loadItems(limit: LoadLimit) {
    const { student } = this.context;
    const failedEarlier = (course: string, studentYear: number) =>
      student.records.some(
        (record) =>
          record.course === course && record.result === "failed" && record.studentYear < studentYear,
      );
    const failedAtAll = (course: string) =>
      student.records.some((record) => record.course === course && record.result === "failed");
    const registered = student.records.filter((record) => record.studentYear === student.studentYear);

    return [
      ...this.plan.map((entry) => ({ ...entry, retake: failedAtAll(entry.course) })),
      ...registered.map(({ course, term, studentYear }) => ({
        course,
        term,
        retake: failedEarlier(course, studentYear),
      })),
    ].filter(({ course, retake }) => {
      if (retake && !limit.countsRetakes) return false;
      return !this.course(course).intensive || limit.countsIntensive;
    });
  }

  checkLoad() {
    const { rules, student } = this.context;
    const applicable = rules.loadLimits.filter((limit) => matchesCondition(limit.when, student));
    const deferred = applicable.map((limit) => this.deferIfUnresolved(limit)).some(Boolean);
    const limit = applicable.at(-1);
    if (deferred || !limit) return;

    const load = { 前期: 0, 後期: 0 };
    for (const { course, term } of this.loadItems(limit)) {
      const { credits } = this.course(course);
      if (term !== "通年") load[term] += credits;
      else if (limit.splitsYearLong) {
        load.前期 += credits / 2;
        load.後期 += credits / 2;
      } else load.前期 += credits;
    }

    for (const term of ["前期", "後期"] as const) {
      if (load[term] > limit.maxPerTerm) {
        const message = `${term}の履修単位 ${load[term]} が上限 ${limit.maxPerTerm} を超えています。`;
        this.addViolation(limit.id, limit.clause, message);
      }
    }
    const year = load.前期 + load.後期;
    if (limit.maxPerYear !== undefined && year > limit.maxPerYear) {
      const message = `年間の履修単位 ${year} が上限 ${limit.maxPerYear} を超えています。`;
      this.addViolation(limit.id, limit.clause, message);
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
          this.addViolation(rule.id, rule.clause, message);
        }
      }
    }
  }

  checkTimetable() {
    this.plan.forEach((entry, index) => {
      const others = [...this.scheduled.slice(index + 1)];
      const slots = this.course(entry.course).slots ?? [];
      for (const other of others) {
        if (other.course === entry.course || !overlaps(entry.term, other.term)) continue;
        const otherSlots = this.course(other.course).slots ?? [];
        if (slots.some((a) => otherSlots.some((b) => slotsCollide(a, b)))) {
          const message = `${entry.course} と ${other.course} の時限が重なっています。`;
          this.addViolation("timetable", "時間割", message, entry.course);
        }
      }
    });
  }
}

export function checkPlan(
  rules: RuleSet,
  courses: Course[],
  student: Student,
  plan: PlanEntry[],
  answers: Answers,
): PlanCheck {
  const reason = exclusionReason(rules, indexCourses(courses), student);
  if (reason) {
    const issue: PlanIssue = {
      ruleId: "excluded",
      clause: "作業ルール",
      severity: "needs_staff",
      message: reason,
      ambiguityIds: [],
    };
    return { status: "needs_staff", issues: [issue] };
  }

  const checker = new PlanChecker(createContext(rules, courses, student, answers), plan);
  checker.checkDuplicates();
  checker.checkOffering();
  checker.checkEnrollment();
  checker.checkPrerequisites();
  checker.checkGates();
  checker.checkLoad();
  checker.checkCourseCounts();
  checker.checkTimetable();

  const { issues } = checker;
  if (issues.some((issue) => issue.severity === "violation")) return { status: "failed", issues };
  if (issues.length > 0) return { status: "needs_staff", issues };
  return { status: "passed", issues };
}
