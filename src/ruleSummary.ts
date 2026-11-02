import type { Ambiguity, Gate, RuleSet, StudentCondition } from "../engine/rules";

export type RuleRow = {
  id: string;
  clause: string;
  sourceQuote: string;
  summary: string;
  review: "plain" | "ambiguous" | "needs_review";
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

function gateText(gate: Gate) {
  const target =
    gate.target.kind === "course" ? gate.target.courses.join("、") : `${gate.target.toYear}年次への進級`;
  const basis = gate.creditBasis === "countable" ? "卒業に数える単位" : "修得した全単位";
  const parts = [
    gate.minCredits !== undefined && `${basis}で${gate.minCredits}単位以上`,
    gate.requiredCourses.length > 0 && `${gate.requiredCourses.join("、")}を修得`,
  ].filter(Boolean);
  return `${target}: ${gate.checkAtEndOfYear}年次の終わりに ${parts.join("、")}`;
}

function linkedToAmbiguity(ambiguities: Ambiguity[], ruleId: string) {
  return ambiguities.some(({ options }) =>
    options.some(({ patches }) => patches?.some((patch) => patch.ruleId === ruleId)),
  );
}

export function summarizeRules(rules: RuleSet): RuleRow[] {
  const row = (
    rule: Pick<Gate, "id" | "clause" | "sourceQuote" | "status" | "when" | "ambiguityIds">,
    summary: string,
  ): RuleRow => ({
    id: rule.id,
    clause: rule.clause,
    sourceQuote: rule.sourceQuote,
    summary: summary + conditionText(rule.when),
    review:
      rule.status === "needs_review"
        ? "needs_review"
        : rule.ambiguityIds?.length || linkedToAmbiguity(rules.ambiguities, rule.id)
          ? "ambiguous"
          : "plain",
  });

  return [
    row(
      rules.graduation,
      `卒業: ${rules.graduation.minYears}年以上在学、合計${rules.graduation.totalCredits}単位以上`,
    ),
    ...rules.categories.map((category) => {
      const cap = category.maxCredits ? `、算入は${category.maxCredits}単位まで` : "";
      const required = category.requireAll ? "、指定の科目をすべて修得" : "";
      return row(category, `区分 ${category.name}: ${category.minCredits}単位以上${required}${cap}`);
    }),
    ...rules.gates.map((gate) => row(gate, gateText(gate))),
    ...rules.loadLimits.map((limit) => {
      const year = limit.maxPerYear === undefined ? "" : `年間${limit.maxPerYear}単位、`;
      return row(limit, `履修上限: ${year}学期${limit.maxPerTerm}単位`);
    }),
    ...rules.courseCountLimits.map((limit) =>
      row(limit, `科目数の上限: ${limit.group}は学期${limit.maxPerTerm}科目まで`),
    ),
    ...rules.prerequisites.map((prerequisite) => {
      const conditions = prerequisite.conditions.map((group) => group.join(" かつ ")).join(" または ");
      const sameTerm = prerequisite.allowSameTerm ? "、同じ学期も可" : "";
      return row(prerequisite, `先修: ${prerequisite.course}は${conditions}を修得${sameTerm}`);
    }),
    ...(rules.enrollment
      ? [
          row(
            rules.enrollment,
            [
              rules.enrollment.forbidBeforeAssignedYear && "配当年次より前の履修を禁止",
              rules.enrollment.forbidRetakeOfPassed && "修得済みの科目の再履修を禁止",
            ]
              .filter(Boolean)
              .join("、") || "履修の基本: 禁止事項なし",
          ),
        ]
      : []),
  ];
}
