import { evaluateStudent, type Answers, type Course, type RuleSet, type Student } from "../engine";
import type { Category, Gate, RulePatch, StudentCondition } from "../engine/rules";

export type Mismatch = { item: string; field: string; gold: unknown; proposal: unknown };

export type AmbiguityCheck = {
  id: string;
  clause: string;
  detected: "same_field" | "same_clause" | null;
  matchedId: string | null;
};

export type Comparison = {
  rate: number;
  matched: number;
  total: number;
  mismatches: Mismatch[];
  missing: string[];
  extra: string[];
  ambiguities: AmbiguityCheck[];
  extraAmbiguities: string[];
};

type Spec<T> = {
  label: string;
  key: (rule: T) => string;
  fields: (rule: T, rules: RuleSet) => Record<string, unknown>;
};

function whenKey(when: StudentCondition | undefined) {
  const entries = Object.entries(when ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return entries.length > 0 ? ` [${entries.map(([k, v]) => `${k}=${String(v)}`).join(", ")}]` : "";
}

function sorted(values: string[]) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function targetKey({ target }: Gate) {
  return target.kind === "course" ? sorted(target.courses).join("、") : `${target.toYear}年次への進級`;
}

const categoryKey = (category: Category) => sorted(category.groups).join("、") + whenKey(category.when);

function overflowKey(category: Category, rules: RuleSet) {
  const target = rules.categories.find(({ id }) => id === category.overflowTo);
  return target ? categoryKey(target) : (category.overflowTo ?? null);
}

function subLimitKeys(category: Category) {
  return sorted((category.subLimits ?? []).map((limit) => `${sorted(limit.groups).join("、")}:${limit.maxCredits}`));
}

const SPECS = {
  graduation: {
    label: "卒業要件",
    key: () => "",
    fields: ({ minYears, totalCredits }) => ({ minYears, totalCredits }),
  } satisfies Spec<RuleSet["graduation"]>,
  categories: {
    label: "区分",
    key: categoryKey,
    fields: (category, rules) => ({
      minCredits: category.minCredits,
      requireAll: category.requireAll,
      maxCredits: category.maxCredits,
      overflowTo: overflowKey(category, rules),
      subLimits: subLimitKeys(category),
    }),
  } satisfies Spec<Category>,
  gates: {
    label: "履修条件",
    key: (gate) => targetKey(gate) + whenKey(gate.when),
    fields: (gate) => ({
      checkAtEndOfYear: gate.checkAtEndOfYear,
      minCredits: gate.minCredits,
      creditBasis: gate.creditBasis,
      requiredCourses: sorted(gate.requiredCourses),
      requiredMayBeEnrolled: gate.requiredMayBeEnrolled ?? false,
      retryAfterMet: gate.retryAfterMet,
    }),
  } satisfies Spec<Gate>,
  loadLimits: {
    label: "履修上限",
    key: (limit) => `上限${whenKey(limit.when)}`,
    fields: ({ maxPerYear, maxPerTerm, retakeExclusion }) => ({ maxPerYear, maxPerTerm, retakeExclusion }),
  } satisfies Spec<RuleSet["loadLimits"][number]>,
  courseCountLimits: {
    label: "科目数の上限",
    key: (limit) => limit.group + whenKey(limit.when),
    fields: ({ maxPerTerm }) => ({ maxPerTerm }),
  } satisfies Spec<RuleSet["courseCountLimits"][number]>,
  prerequisites: {
    label: "先修条件",
    key: (rule) => rule.course + whenKey(rule.when),
    fields: ({ conditions, allowSameTerm }) => ({
      conditions: sorted(conditions.map((group) => sorted(group).join(" かつ "))),
      allowSameTerm,
    }),
  } satisfies Spec<RuleSet["prerequisites"][number]>,
  enrollment: {
    label: "履修の基本",
    key: () => "",
    fields: ({ forbidBeforeAssignedYear, forbidRetakeOfPassed }) => ({
      forbidBeforeAssignedYear,
      forbidRetakeOfPassed,
    }),
  } satisfies Spec<NonNullable<RuleSet["enrollment"]>>,
};

function itemName<T>(spec: Spec<T>, rule: T) {
  const key = spec.key(rule);
  return key ? `${spec.label}: ${key}` : spec.label;
}

function same(a: unknown, b: unknown) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

// 曖昧箇所の差分が変える項目の値は仮のものなので、一致率に数えない。
function patchedFields(rules: RuleSet) {
  return new Set(
    rules.ambiguities.flatMap(({ options }) =>
      options.flatMap(({ patches }) => (patches ?? []).map(({ ruleId, field }) => `${ruleId}.${field}`)),
    ),
  );
}

// ルールの id は作り手ごとに違うので、意味の名前で突き合わせる。
function ruleNames(rules: RuleSet) {
  const names = new Map<string, string>();
  const add = <T extends { id: string }>(spec: Spec<T>, list: T[]) => {
    for (const rule of list) names.set(rule.id, itemName(spec, rule));
  };
  add(SPECS.graduation, [rules.graduation]);
  add(SPECS.categories, rules.categories);
  add(SPECS.gates, rules.gates);
  add(SPECS.loadLimits, rules.loadLimits);
  add(SPECS.courseCountLimits, rules.courseCountLimits);
  add(SPECS.prerequisites, rules.prerequisites);
  add(SPECS.enrollment, rules.enrollment ? [rules.enrollment] : []);
  return names;
}

function patchedTargets(rules: RuleSet, ambiguity: RuleSet["ambiguities"][number]) {
  const names = ruleNames(rules);
  return ambiguity.options.flatMap(({ patches }) =>
    (patches ?? []).map(({ ruleId, field }) => `${names.get(ruleId) ?? ruleId}.${field}`),
  );
}

function compareAmbiguities(gold: RuleSet, proposal: RuleSet) {
  const matchedIds = new Set<string>();
  const ambiguities = gold.ambiguities.map(({ id, clause }, index): AmbiguityCheck => {
    const targets = new Set(patchedTargets(gold, gold.ambiguities[index]!));
    const byField = proposal.ambiguities.find((candidate) =>
      patchedTargets(proposal, candidate).some((target) => targets.has(target)),
    );
    const byClause = proposal.ambiguities.find(
      (candidate) => candidate.clause.includes(clause) || clause.includes(candidate.clause),
    );
    const match = byField ?? byClause;
    if (match) matchedIds.add(match.id);
    return {
      id,
      clause,
      detected: byField ? "same_field" : byClause ? "same_clause" : null,
      matchedId: match?.id ?? null,
    };
  });
  const extraAmbiguities = proposal.ambiguities
    .filter(({ id }) => !matchedIds.has(id))
    .map(({ id, clause }) => `${id}（${clause}）`);
  return { ambiguities, extraAmbiguities };
}

export function compareRules(gold: RuleSet, proposal: RuleSet): Comparison {
  const skip = patchedFields(gold);
  const mismatches: Mismatch[] = [];
  const missing: string[] = [];
  const extra: string[] = [];
  let matched = 0;
  let total = 0;

  const compare = <T extends { id: string }>(spec: Spec<T>, golds: T[], proposals: T[]) => {
    const byKey = new Map(proposals.map((rule) => [spec.key(rule), rule]));
    for (const rule of golds) {
      const counted = Object.entries(spec.fields(rule, gold)).filter(
        ([field]) => !skip.has(`${rule.id}.${field}`),
      );
      total += counted.length;
      const found = byKey.get(spec.key(rule));
      byKey.delete(spec.key(rule));
      if (!found) {
        missing.push(itemName(spec, rule));
        continue;
      }
      const other = spec.fields(found, proposal);
      for (const [field, value] of counted) {
        if (same(value, other[field])) matched += 1;
        else mismatches.push({ item: itemName(spec, rule), field, gold: value, proposal: other[field] });
      }
    }
    extra.push(...[...byKey.values()].map((rule) => itemName(spec, rule)));
  };

  compare(SPECS.graduation, [gold.graduation], [proposal.graduation]);
  compare(SPECS.categories, gold.categories, proposal.categories);
  compare(SPECS.gates, gold.gates, proposal.gates);
  compare(SPECS.loadLimits, gold.loadLimits, proposal.loadLimits);
  compare(SPECS.courseCountLimits, gold.courseCountLimits, proposal.courseCountLimits);
  compare(SPECS.prerequisites, gold.prerequisites, proposal.prerequisites);
  compare(
    SPECS.enrollment,
    gold.enrollment ? [gold.enrollment] : [],
    proposal.enrollment ? [proposal.enrollment] : [],
  );

  return {
    rate: total === 0 ? 0 : matched / total,
    matched,
    total,
    mismatches,
    missing,
    extra,
    ...compareAmbiguities(gold, proposal),
  };
}

export type JudgmentComparison = {
  scenario: string;
  matched: number;
  total: number;
  // 「正解の判定→案の判定」ごとの件数
  differences: Record<string, number>;
};

type Scenario = { scenario: string; gold: Answers; proposal: Answers };

function samePatches(goldRules: RuleSet, proposalRules: RuleSet, gold: RulePatch[], proposal: RulePatch[]) {
  const goldNames = ruleNames(goldRules);
  const proposalNames = ruleNames(proposalRules);
  return gold.every((patch) =>
    proposal.some(
      (other) =>
        proposalNames.get(other.ruleId) === goldNames.get(patch.ruleId) &&
        other.field === patch.field &&
        same(other.value, patch.value),
    ),
  );
}

// 正解の回答ごとに、同じ差分になる案の回答を組にする。ほかの曖昧箇所は未回答のまま比べる。
function scenarios(gold: RuleSet, proposal: RuleSet): Scenario[] {
  return [
    { scenario: "未回答", gold: {}, proposal: {} },
    ...gold.ambiguities.flatMap((ambiguity) =>
      ambiguity.options.flatMap((option) =>
        proposal.ambiguities.flatMap((candidate) =>
          candidate.options
            .filter(({ patches }) =>
              samePatches(gold, proposal, option.patches ?? [{ ruleId: "", field: "", value: null }], patches ?? []),
            )
            .map(({ id }) => ({
              scenario: `${ambiguity.id}=${option.id}`,
              gold: { [ambiguity.id]: option.id },
              proposal: { [candidate.id]: id },
            })),
        ),
      ),
    ),
  ];
}

function statuses(rules: RuleSet, courses: Course[], student: Student, answers: Answers) {
  const names = ruleNames(rules);
  const { judgments } = evaluateStudent(rules, courses, student, answers);
  return new Map(judgments.map(({ ruleId, status }) => [names.get(ruleId) ?? ruleId, status as string]));
}

// 項目が同じでも、engine で動かすと判定が変わることがある。全学生を判定して比べる。
export function compareJudgments(
  gold: RuleSet,
  proposal: RuleSet,
  courses: Course[],
  students: Student[],
): JudgmentComparison[] {
  return scenarios(gold, proposal).map(({ scenario, gold: goldAnswers, proposal: proposalAnswers }) => {
    const differences: Record<string, number> = {};
    let matched = 0;
    let total = 0;
    for (const student of students) {
      const expected = statuses(gold, courses, student, goldAnswers);
      const actual = statuses(proposal, courses, student, proposalAnswers);
      for (const item of new Set([...expected.keys(), ...actual.keys()])) {
        const pair = [expected.get(item) ?? "なし", actual.get(item) ?? "なし"] as const;
        total += 1;
        if (pair[0] === pair[1]) matched += 1;
        else differences[pair.join("→")] = (differences[pair.join("→")] ?? 0) + 1;
      }
    }
    return { scenario, matched, total, differences };
  });
}
