import { evaluateStudent, type JudgmentStatus } from "./evaluate";
import type { Answers, Course, Student } from "./model";
import type { RuleSet } from "./rules";

export type ImpactChange = {
  studentId: string;
  ruleId: string;
  name: string;
  clause: string;
  statuses: Record<string, JudgmentStatus>;
};

export type AmbiguityImpact = {
  ambiguityId: string;
  clause: string;
  question: string;
  options: { id: string; label: string }[];
  affectedStudentIds: string[];
  staffReviewStudentIds: string[];
  changes: ImpactChange[];
};

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

  const changes: ImpactChange[] = [];
  const needsStaff = new Set<string>();
  for (const student of students) {
    const byRule = new Map<string, ImpactChange>();
    for (const option of ambiguity.options) {
      const evaluation = evaluateStudent(rules, courses, student, {
        ...answers,
        [ambiguityId]: option.id,
      });
      for (const { ruleId, name, clause, status } of evaluation.judgments) {
        const change = byRule.get(ruleId) ?? {
          studentId: student.id,
          ruleId,
          name,
          clause,
          statuses: {},
        };
        change.statuses[option.id] = status;
        byRule.set(ruleId, change);
        if (status === "needs_staff") needsStaff.add(student.id);
      }
    }
    for (const change of byRule.values()) {
      if (new Set(Object.values(change.statuses)).size > 1) changes.push(change);
    }
  }

  const affected = new Set(changes.map((change) => change.studentId));
  return {
    ambiguityId,
    clause: ambiguity.clause,
    question: ambiguity.question,
    options: ambiguity.options.map(({ id, label }) => ({ id, label })),
    affectedStudentIds: [...affected],
    staffReviewStudentIds: [...needsStaff].filter((id) => !affected.has(id)),
    changes,
  };
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
