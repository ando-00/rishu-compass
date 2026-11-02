import { collectQuotes, validateRuleSet, verifyQuotes, type RuleSet } from "../../engine";
import { listRules } from "../../engine/answers";
import type { ExtractionInput } from "./extract";
import type { ExtractionNote } from "./schema";

function duplicates(values: string[]) {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

function majorProblems(rules: RuleSet, input: ExtractionInput) {
  const majors = new Set(input.students.flatMap(({ major }) => (major ? [major] : [])));
  const named = listRules(rules).flatMap(({ rule: { id, when } }) =>
    when?.major ? [{ id, major: when.major }] : [],
  );
  return named
    .filter(({ major }) => !majors.has(major))
    .map(({ id, major }) => `${id}: 学生データにない専攻です: ${major}`);
}

function gateProblems(rules: RuleSet) {
  // creditBasis がないと engine は修得した全単位で数える。Claude の書き漏らしを確定として通さない。
  return rules.gates
    .filter((gate) => gate.minCredits !== undefined && gate.creditBasis === undefined)
    .map((gate) => `${gate.id}: 単位の条件に数え方（creditBasis）がありません`);
}

function ambiguityProblems(rules: RuleSet) {
  const ids = rules.ambiguities.map(({ id }) => id);
  return [
    ...duplicates(ids).map((id) => `${id}: 曖昧箇所の id が重複しています`),
    ...rules.ambiguities.flatMap(({ id, options }) => [
      ...(options.length < 2 ? [`${id}: 解釈の候補が2つ以上ありません`] : []),
      ...duplicates(options.map((option) => option.id)).map(
        (optionId) => `${id}: 選択肢の id が重複しています: ${optionId}`,
      ),
    ]),
  ];
}

export function checkProposal({
  rules,
  notes,
  input,
  problems,
}: {
  rules: RuleSet;
  notes: ExtractionNote[];
  input: ExtractionInput;
  problems: string[];
}) {
  const quotes = [
    ...collectQuotes(rules),
    ...notes.map(({ clause, sourceQuote }) => ({ ruleId: clause, sourceQuote })),
  ];
  return [
    ...problems,
    ...validateRuleSet(rules, input.courses),
    ...verifyQuotes(quotes, input.handbook).map(
      ({ ruleId, sourceQuote }) => `${ruleId}: 根拠の文が要項にありません: ${sourceQuote}`,
    ),
    ...majorProblems(rules, input),
    ...gateProblems(rules),
    ...ambiguityProblems(rules),
  ];
}
