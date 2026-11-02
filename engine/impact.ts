import { listRules } from "./answers";
import { evaluatePrepared, prepareRules, type Judgment, type JudgmentStatus } from "./evaluate";
import type { Answers, Course, Student } from "./model";
import type { RuleSet } from "./rules";

export type ImpactChange = {
  studentId: string;
  ruleId: string;
  name: string;
  clause: string;
  statuses: Record<string, JudgmentStatus>;
};

export type ImpactOption = {
  id: string;
  label: string;
  // 差分で表せない候補は null。人数を推測しない。
  counts: Partial<Record<JudgmentStatus, number>> | null;
  // false の候補は、回答しても判定に反映できない。
  reflected: boolean;
};

export type AmbiguityImpact = {
  ambiguityId: string;
  clause: string;
  sourceQuote: string;
  question: string;
  computable: boolean;
  // false は履修上限のように判定を持たないルールだけに関わり、影響は履修案の検査に出る。
  judged: boolean;
  options: ImpactOption[];
  affectedStudentIds: string[];
  staffReviewStudentIds: string[];
  changes: ImpactChange[];
};

const SEVERITY: JudgmentStatus[] = ["delay_risk", "short", "needs_staff", "expected", "satisfied"];

function linkedRuleIds(rules: RuleSet, ambiguityId: string) {
  const ambiguity = rules.ambiguities.find((a) => a.id === ambiguityId);
  const patched = (ambiguity?.options ?? []).flatMap((option) =>
    (option.patches ?? []).map((patch) => patch.ruleId),
  );
  const listed = listRules(rules)
    .filter(({ rule }) => rule.ambiguityIds?.includes(ambiguityId))
    .map(({ rule }) => rule.id);
  return new Set([...patched, ...listed]);
}

function worstStatus(judgments: Judgment[]) {
  return SEVERITY.find((status) => judgments.some((judgment) => judgment.status === status));
}

// 他の曖昧箇所が未回答のままなら、その判定は職員確認のまま比べる。
export function computeImpact(
  rules: RuleSet,
  courses: Course[],
  students: Student[],
  answers: Answers,
  ambiguityId: string,
): AmbiguityImpact {
  const ambiguity = rules.ambiguities.find((a) => a.id === ambiguityId);
  if (!ambiguity) throw new Error(`曖昧箇所がありません: ${ambiguityId}`);

  const computable = ambiguity.options.every((option) => option.patches !== null);
  const linked = linkedRuleIds(rules, ambiguityId);
  const judged = listRules(rules).some(
    ({ kind, rule }) => linked.has(rule.id) && ["graduation", "category", "gate"].includes(kind),
  );
  const common = {
    ambiguityId,
    clause: ambiguity.clause,
    sourceQuote: ambiguity.sourceQuote,
    question: ambiguity.question,
    computable,
    judged,
  };

  if (!computable) {
    const prepared = prepareRules(rules, courses, answers);
    const needsStaff = students
      .filter((student) =>
        evaluatePrepared(prepared, student).judgments.some(
          (judgment) =>
            judgment.status === "needs_staff" &&
            (judgment.ambiguityIds.includes(ambiguityId) || linked.size === 0),
        ),
      )
      .map((student) => student.id);
    return {
      ...common,
      options: ambiguity.options.map(({ id, label, patches }) => ({
        id,
        label,
        counts: null,
        reflected: patches !== null,
      })),
      affectedStudentIds: [],
      staffReviewStudentIds: needsStaff,
      changes: [],
    };
  }

  const prepared = ambiguity.options.map((option) => ({
    option,
    rules: prepareRules(rules, courses, { ...answers, [ambiguityId]: option.id }),
    counts: {} as Partial<Record<JudgmentStatus, number>>,
  }));

  const changes: ImpactChange[] = [];
  const needsStaff = new Set<string>();
  for (const student of students) {
    const byRule = new Map<string, ImpactChange>();
    const shown = new Map<string, Set<string>>();
    for (const { option, rules: resolved, counts } of prepared) {
      const { judgments } = evaluatePrepared(resolved, student);
      // 履修上限のように判定を持たないルールは、学生の全判定の中で数える。
      const related = judgments.filter((judgment) => linked.has(judgment.ruleId));
      const worst = worstStatus(related.length > 0 ? related : judgments);
      if (worst) counts[worst] = (counts[worst] ?? 0) + 1;

      for (const { ruleId, name, clause, status, needsContact } of judgments) {
        const change = byRule.get(ruleId) ?? {
          studentId: student.id,
          ruleId,
          name,
          clause,
          statuses: {},
        };
        change.statuses[option.id] = status;
        byRule.set(ruleId, change);
        // 状態が同じでも、声かけの対象が変われば判定が変わったものとして数える。
        shown.set(ruleId, (shown.get(ruleId) ?? new Set()).add(`${status}:${needsContact}`));
        if (status === "needs_staff") needsStaff.add(student.id);
      }
    }
    for (const change of byRule.values()) {
      if ((shown.get(change.ruleId)?.size ?? 0) > 1) changes.push(change);
    }
  }

  const affected = new Set(changes.map((change) => change.studentId));
  return {
    ...common,
    options: prepared.map(({ option, counts }) => ({
      id: option.id,
      label: option.label,
      counts,
      reflected: true,
    })),
    affectedStudentIds: [...affected],
    staffReviewStudentIds: [...needsStaff].filter((id) => !affected.has(id)),
    changes,
  };
}

// 未回答の1件をどの読み方にしても職員確認と声かけが残らない学生だけを、対応が要らないと確かめたものとして返す。
// 確かめられない学生は職員確認に残す。曖昧箇所が2件関わる学生、反映できない回答、要確認のルールがここに当たる。
export function settledStudentIds(
  rules: RuleSet,
  courses: Course[],
  students: Student[],
  answers: Answers,
) {
  const readings = rules.ambiguities
    .filter((ambiguity) => !(ambiguity.id in answers) && ambiguity.options.length > 0)
    .map((ambiguity) =>
      ambiguity.options.map((option) =>
        prepareRules(rules, courses, { ...answers, [ambiguity.id]: option.id }),
      ),
    );
  const needsNothing = (resolved: ReturnType<typeof prepareRules>, student: Student) =>
    evaluatePrepared(resolved, student).judgments.every(
      (judgment) => judgment.status !== "needs_staff" && !judgment.needsContact,
    );
  const settled = students.filter((student) =>
    readings.some((options) => options.every((resolved) => needsNothing(resolved, student))),
  );
  return new Set(settled.map((student) => student.id));
}

export function computeImpacts(
  rules: RuleSet,
  courses: Course[],
  students: Student[],
  answers: Answers,
) {
  return rules.ambiguities
    .filter((ambiguity) => !(ambiguity.id in answers))
    .map((ambiguity) => computeImpact(rules, courses, students, answers, ambiguity.id))
    .sort((a, b) => b.affectedStudentIds.length - a.affectedStudentIds.length);
}
