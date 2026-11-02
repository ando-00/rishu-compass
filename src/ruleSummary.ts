import type { Category, Gate, RuleSet, StudentCondition } from "../engine/rules";

export type RuleRow = {
  id: string;
  clause: string;
  sourceQuote: string;
  summary: string;
  review: "plain" | "ambiguous" | "needs_review";
};

type RuleHead = Pick<Gate, "id" | "clause" | "sourceQuote" | "status" | "when" | "ambiguityIds">;

const PENDING = "確認中";

const FIELD_LABELS: Record<string, string> = {
  minYears: "在学年数",
  totalCredits: "合計単位",
  minCredits: "必要な単位",
  requireAll: "すべて修得",
  maxCredits: "算入の上限",
  overflowTo: "超過分の算入先",
  subLimits: "科目群の上限",
  checkAtEndOfYear: "判定の年次",
  creditBasis: "単位の数え方",
  requiredCourses: "必要な科目",
  requiredMayBeEnrolled: "履修中でも可",
  retryAfterMet: "後からの再判定",
  maxPerYear: "年間の上限",
  maxPerTerm: "学期の上限",
  retakeExclusion: "上限から除く再履修",
  conditions: "先修条件",
  allowSameTerm: "同じ学期の履修",
  forbidBeforeAssignedYear: "配当年次より前の履修",
  forbidRetakeOfPassed: "修得済みの再履修",
};

export function fieldLabel(field: string) {
  return FIELD_LABELS[field] ?? field;
}

const RETAKE_LABELS = {
  none: "再履修も含める",
  failed: "不合格の再履修を除く",
  failed_or_disqualified: "不合格と失格の再履修を除く",
};

function conditionText(when: StudentCondition | undefined) {
  if (!when) return "";
  const parts = [
    when.major && `${when.major}の学生`,
    when.hasMinor !== undefined && (when.hasMinor ? "副専攻あり" : "副専攻なし"),
    when.minStudentYear !== undefined && `${when.minStudentYear}年次以上`,
    when.minPreviousGpa !== undefined && `前年度 GPA ${when.minPreviousGpa} 以上`,
  ].filter(Boolean);
  return parts.length > 0 ? `（${parts.join("、")}）` : "";
}

export function summarizeRules(rules: RuleSet): RuleRow[] {
  const patched = new Set(
    rules.ambiguities.flatMap(({ options }) =>
      options.flatMap(({ patches }) => (patches ?? []).map(({ ruleId, field }) => `${ruleId}.${field}`)),
    ),
  );
  // 読み方が決まっていない項目の値は仮のものなので、表示しない。
  const shown = (rule: { id: string }, field: string, text: string) =>
    patched.has(`${rule.id}.${field}`) ? PENDING : text;
  const linked = (rule: RuleHead) =>
    Boolean(rule.ambiguityIds?.length) || [...patched].some((key) => key.startsWith(`${rule.id}.`));

  const row = (rule: RuleHead, summary: string): RuleRow => ({
    id: rule.id,
    clause: rule.clause,
    sourceQuote: rule.sourceQuote,
    summary: summary + conditionText(rule.when),
    review: rule.status === "needs_review" ? "needs_review" : linked(rule) ? "ambiguous" : "plain",
  });

  const categoryText = (category: Category) => {
    const target = rules.categories.find(({ id }) => id === category.overflowTo);
    const parts = [
      `${shown(category, "minCredits", `${category.minCredits}単位`)}以上`,
      category.requireAll && "指定の科目をすべて修得",
      category.maxCredits != null && `算入は${shown(category, "maxCredits", `${category.maxCredits}単位`)}まで`,
      target && `超過分は${shown(category, "overflowTo", target.name)}へ`,
      ...(category.subLimits ?? []).map(({ groups, maxCredits }) => `${groups.join("、")}は${maxCredits}単位まで`),
    ].filter(Boolean);
    return `区分 ${category.name}: ${parts.join("、")}`;
  };

  const gateText = (gate: Gate) => {
    const target =
      gate.target.kind === "course" ? gate.target.courses.join("、") : `${gate.target.toYear}年次への進級`;
    const basis = gate.creditBasis === "countable" ? "卒業に数える単位" : "修得した全単位";
    const credits = `${shown(gate, "minCredits", `${gate.minCredits}単位`)}以上`;
    const parts = [
      gate.minCredits !== undefined &&
        (patched.has(`${gate.id}.creditBasis`)
          ? `${credits}（単位の数え方は${PENDING}）`
          : `${basis}で${credits}`),
      gate.requiredCourses.length > 0 && `${gate.requiredCourses.join("、")}を修得`,
      gate.requiredMayBeEnrolled && "履修中でも可",
      gate.retryAfterMet && "後から満たせば認める",
    ].filter(Boolean);
    return `${target}: ${gate.checkAtEndOfYear}年次の終わりに ${parts.join("、")}`;
  };

  const loadText = (limit: RuleSet["loadLimits"][number]) => {
    const parts = [
      limit.maxPerYear !== undefined && `年間${shown(limit, "maxPerYear", `${limit.maxPerYear}単位`)}`,
      `学期${shown(limit, "maxPerTerm", `${limit.maxPerTerm}単位`)}`,
      shown(limit, "retakeExclusion", RETAKE_LABELS[limit.retakeExclusion]),
    ].filter(Boolean);
    return `履修上限: ${parts.join("、")}`;
  };

  const { graduation, enrollment } = rules;
  return [
    row(
      graduation,
      `卒業: ${shown(graduation, "minYears", `${graduation.minYears}年`)}以上在学、合計${shown(graduation, "totalCredits", `${graduation.totalCredits}単位`)}以上`,
    ),
    ...rules.categories.map((category) => row(category, categoryText(category))),
    ...rules.gates.map((gate) => row(gate, gateText(gate))),
    ...rules.loadLimits.map((limit) => row(limit, loadText(limit))),
    ...rules.courseCountLimits.map((limit) =>
      row(limit, `科目数の上限: ${limit.group}は学期${shown(limit, "maxPerTerm", `${limit.maxPerTerm}科目`)}まで`),
    ),
    ...rules.prerequisites.map((prerequisite) => {
      const conditions = prerequisite.conditions.map((group) => group.join(" かつ ")).join(" または ");
      const sameTerm = patched.has(`${prerequisite.id}.allowSameTerm`)
        ? `、同じ学期の履修は${PENDING}`
        : prerequisite.allowSameTerm
          ? "、同じ学期も可"
          : "";
      return row(prerequisite, `先修: ${prerequisite.course}は${conditions}を修得${sameTerm}`);
    }),
    ...(enrollment
      ? [
          row(
            enrollment,
            [
              shown(enrollment, "forbidBeforeAssignedYear", enrollment.forbidBeforeAssignedYear ? "配当年次より前の履修を禁止" : ""),
              shown(enrollment, "forbidRetakeOfPassed", enrollment.forbidRetakeOfPassed ? "修得済みの科目の再履修を禁止" : ""),
            ]
              .filter(Boolean)
              .join("、") || "履修の基本: 禁止事項なし",
          ),
        ]
      : []),
  ];
}
