import { evaluateStudent, type Answers, type Course, type RuleSet, type Student } from "../engine";
import { ruleNames, same } from "../engine/compareRules";
import type { RulePatch } from "../engine/rules";

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
