import { listRules } from "./answers";
import { evaluatePrepared, prepareRules, type Judgment, type JudgmentStatus } from "./evaluate";
import type { Answers, Course, Student } from "./model";
import type { RuleSet } from "./rules";
import type { StudentState } from "./stateChanges";

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
  // 読み方ごとの人数を数えた判定の名前。空なら、学生の全判定のうち最も重いもので数えた
  countedRuleNames: string[];
  affectedStudentIds: string[];
  staffReviewStudentIds: string[];
  changes: ImpactChange[];
};

const SEVERITY: JudgmentStatus[] = ["delay_risk", "short", "needs_staff", "delayed", "expected", "satisfied"];

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
  // 一覧での今の対応（声かけ・職員確認・対応なし）。渡されれば回答の前の状態として使う
  beforeStates?: Map<string, StudentState>,
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
      countedRuleNames: [],
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

  const evaluated = prepared.map(({ rules: resolved }) =>
    students.map((student) => evaluatePrepared(resolved, student).judgments),
  );
  // 回答しても職員確認の判定が残る学生は、残りの読み方しだいで一覧では対応なしへ動く（独立の全体監査 V-5）。
  // 一覧と同じ確かめ方で、回答のあとの状態を求める
  const settledAfter = prepared.map(({ option }, optionIndex) => {
    if (!beforeStates) return new Set<string>();
    const candidates = students.filter((student, studentIndex) => {
      const judgments = evaluated[optionIndex]![studentIndex]!;
      return (
        beforeStates.get(student.id) === "staff_review" &&
        !judgments.some((j) => j.needsContact) &&
        judgments.some((j) => j.status === "needs_staff")
      );
    });
    if (candidates.length === 0) return new Set<string>();
    return settledStudentIds(rules, courses, candidates, { ...answers, [ambiguityId]: option.id });
  });

  const changes: ImpactChange[] = [];
  const counted = new Set<string>();
  const affected = new Set<string>();
  const stuck = new Set<string>();
  for (const [studentIndex, student] of students.entries()) {
    const beforeState: StudentState = beforeStates?.get(student.id) ?? "clear";

    const byRule = new Map<string, ImpactChange>();
    const shown = new Map<string, Set<string>>();
    let moved = false;
    for (const [optionIndex, { option, counts }] of prepared.entries()) {
      const judgments = evaluated[optionIndex]![studentIndex]!;
      // 履修上限のように判定を持たないルールは、学生の全判定の中で数える。
      const related = judgments.filter((judgment) => linked.has(judgment.ruleId));
      for (const judgment of related) counted.add(judgment.name);
      const worst = worstStatus(related.length > 0 ? related : judgments);
      if (worst) counts[worst] = (counts[worst] ?? 0) + 1;

      // 回答の前後で職員の対応が変わるか。声かけの有無は確定で分かる。職員確認が残っても、残りの読み方の
      // どれでも対応が要らないと確かめられれば、一覧では対応なしへ動く
      // 一覧の状態を渡されていないときは、仮の状態では「対応なし」と「職員確認」を見分けられないので比べない
      if (beforeStates) {
        const hasContact = judgments.some((j) => j.needsContact);
        const hasStaff = judgments.some((j) => j.status === "needs_staff");
        if ((beforeState === "contact") !== hasContact) moved = true;
        const settled = settledAfter[optionIndex]!.has(student.id);
        if (beforeState === "staff_review" && !hasContact && (!hasStaff || settled)) moved = true;
      }
      // 回答しても職員確認が残る学生（A25-3）。一覧の状態を渡されていれば、今の一覧で職員確認の学生に限る。
      // 渡されていないと、どの読み方でも対応が要らない学生を見分けられないので、従来どおり全員を数える
      if (judgments.some((j) => j.status === "needs_staff") && (!beforeStates || beforeState === "staff_review")) {
        stuck.add(student.id);
      }

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
      }
    }
    for (const change of byRule.values()) {
      const differs = (shown.get(change.ruleId)?.size ?? 0) > 1;
      // 読み方どうしで違う判定と、回答の前後で対応が変わる学生の関わる判定を、変わる学生の一覧に出す
      if (differs || (moved && linked.has(change.ruleId))) changes.push(change);
    }
    if (moved || byRule.size > 0 && changes.some((c) => c.studentId === student.id)) affected.add(student.id);
  }

  return {
    ...common,
    options: prepared.map(({ option, counts }) => ({
      id: option.id,
      label: option.label,
      counts,
      reflected: true,
    })),
    countedRuleNames: [...counted],
    affectedStudentIds: students.map((s) => s.id).filter((id) => affected.has(id)),
    staffReviewStudentIds: students.map((s) => s.id).filter((id) => stuck.has(id) && !affected.has(id)),
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
  const unanswered = rules.ambiguities.filter(
    (ambiguity) => !Object.hasOwn(answers, ambiguity.id) && ambiguity.options.length > 0,
  );
  const prepared = new Map<string, ReturnType<typeof prepareRules>[]>();
  const readingsOf = ({ id, options }: RuleSet["ambiguities"][number]) => {
    let readings = prepared.get(id);
    if (!readings) {
      readings = options.map((option) => prepareRules(rules, courses, { ...answers, [id]: option.id }));
      prepared.set(id, readings);
    }
    return readings;
  };
  const needsNothing = (resolved: ReturnType<typeof prepareRules>, student: Student) =>
    evaluatePrepared(resolved, student).judgments.every(
      (judgment) => judgment.status !== "needs_staff" && !judgment.needsContact,
    );
  const current = prepareRules(rules, courses, answers);
  const settled = students.filter((student) => {
    // 区分と履修条件の職員確認を消せるのは、その判定の ambiguityIds にある曖昧箇所だけ
    // （resolveRules が、書き換えるルールと単位を受け取る区分に結びつける）。ほかの読み方は試さない
    const held = evaluatePrepared(current, student).judgments.filter(
      ({ status, kind }) => status === "needs_staff" && kind !== "graduation",
    );
    return unanswered
      .filter(({ id }) => held.every(({ ambiguityIds }) => ambiguityIds.includes(id)))
      .some((ambiguity) => readingsOf(ambiguity).every((resolved) => needsNothing(resolved, student)));
  });
  return new Set(settled.map((student) => student.id));
}

export function computeImpacts(
  rules: RuleSet,
  courses: Course[],
  students: Student[],
  answers: Answers,
  beforeStates?: Map<string, StudentState>,
) {
  return rules.ambiguities
    .filter((ambiguity) => !Object.hasOwn(answers, ambiguity.id))
    .map((ambiguity) => computeImpact(rules, courses, students, answers, ambiguity.id, beforeStates))
    .sort((a, b) => b.affectedStudentIds.length - a.affectedStudentIds.length);
}
