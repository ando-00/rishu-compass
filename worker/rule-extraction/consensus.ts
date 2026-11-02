import { validateRuleSet, type RuleSet } from "../../engine";
import { listRules } from "../../engine/answers";
import { runCheckCases, type CaseResult } from "../../engine/checkCases";
import { compareRules, patchedTargets, ruleNames } from "../../engine/compareRules";
import type { Ambiguity } from "../../engine/rules";
import { extractRules, type Attempt, type AttemptObserver, type ExtractionFailure, type ExtractionInput } from "./extract";
import type { ExtractionNote } from "./schema";

export const RUN_COUNT = 3;

export type Proposal = {
  rules: RuleSet;
  notes: ExtractionNote[];
  problems: string[];
};

export type Disagreement = {
  item: string;
  field: string;
  // 土台の案、他の回の順に並べる
  values: string[];
};

export type ExtraQuestion = {
  clause: string;
  sourceQuote: string;
  question: string;
  options: string[];
};

export type ConsensusResult =
  | (Omit<Proposal, "problems"> & {
      ok: true;
      problems: string[];
      disagreements: Disagreement[];
      extraQuestions: ExtraQuestion[];
      caseResults: CaseResult[];
      runs: { requested: number; succeeded: number };
      attempts: Attempt[];
    })
  | { ok: false; failure: ExtractionFailure; attempts: Attempt[] };

function differenceCount(base: RuleSet, other: RuleSet) {
  const { mismatches, missing, extra } = compareRules(base, other);
  return mismatches.length + missing.length + extra.length;
}

function chooseBase(proposals: Proposal[]) {
  const clean = proposals.filter(({ problems }) => problems.length === 0);
  const candidates = clean.length > 0 ? clean : proposals;
  const scored = candidates.map((candidate) => ({
    candidate,
    score: proposals.reduce((sum, { rules }) => sum + differenceCount(candidate.rules, rules), 0),
  }));
  const best = Math.min(...scored.map(({ score }) => score));
  return scored.find(({ score }) => score === best)!.candidate;
}

function display(value: unknown) {
  if (value === null || value === undefined) return "なし";
  return typeof value === "string" ? value : JSON.stringify(value);
}

// 他の回が曖昧箇所にした項目の値は仮のものなので、割れた項目に数えない。
function provisionalTargets(rules: RuleSet) {
  return new Set(rules.ambiguities.flatMap((ambiguity) => patchedTargets(rules, ambiguity)));
}

function collectDisagreements(base: RuleSet, others: RuleSet[]) {
  const found = new Map<string, Disagreement>();
  const record = (item: string, field: string, index: number, baseValue: string, value: string) => {
    const key = `${item}.${field}`;
    const entry = found.get(key) ?? { item, field, values: [baseValue, ...others.map(() => baseValue)] };
    entry.values[index + 1] = value;
    found.set(key, entry);
  };

  others.forEach((other, index) => {
    const provisional = provisionalTargets(other);
    const { mismatches, missing, extra } = compareRules(base, other);
    for (const { item, field, base: value, other: otherValue } of mismatches) {
      if (!provisional.has(`${item}.${field}`)) {
        record(item, field, index, display(value), display(otherValue));
      }
    }
    for (const item of missing) record(item, "存在", index, "あり", "なし");
    for (const item of extra) {
      const key = `${item}.存在`;
      const entry = found.get(key) ?? { item, field: "存在", values: ["なし", ...others.map(() => "なし")] };
      entry.values[index + 1] = "あり";
      found.set(key, entry);
    }
  });
  return [...found.values()];
}

function markForReview(rules: RuleSet, disagreements: Disagreement[]) {
  const names = ruleNames(rules);
  const items = new Set(disagreements.map(({ item }) => item));
  for (const { rule } of listRules(rules)) {
    if (items.has(names.get(rule.id) ?? "")) rule.status = "needs_review";
  }
}

function linkedRuleIds(rules: RuleSet, ambiguity: Ambiguity) {
  const listed = listRules(rules)
    .filter(({ rule }) => rule.ambiguityIds?.includes(ambiguity.id))
    .map(({ rule }) => rule.id);
  const patched = ambiguity.options.flatMap(({ patches }) => (patches ?? []).map(({ ruleId }) => ruleId));
  return [...new Set([...listed, ...patched])];
}

// 他の回だけが見つけた質問を土台へ移す。土台のルールに対応づけられなければ、職員に見せるだけにする。
function adoptQuestions(rules: RuleSet, others: { rules: RuleSet; run: number }[]) {
  const baseIds = new Map([...ruleNames(rules)].map(([id, name]) => [name, id]));
  const seen = provisionalTargets(rules);
  const extraQuestions: ExtraQuestion[] = [];

  for (const { rules: other, run } of others) {
    const names = ruleNames(other);
    const toBase = (ruleId: string) => baseIds.get(names.get(ruleId) ?? "");

    for (const ambiguity of other.ambiguities) {
      const targets = patchedTargets(other, ambiguity);
      const sameQuote = rules.ambiguities.some(({ sourceQuote }) => sourceQuote === ambiguity.sourceQuote);
      if (targets.some((target) => seen.has(target)) || (targets.length === 0 && sameQuote)) continue;

      const linked = linkedRuleIds(other, ambiguity).map(toBase);
      if (linked.length === 0 || linked.includes(undefined)) {
        const { clause, sourceQuote, question, options } = ambiguity;
        if (!extraQuestions.some((entry) => entry.sourceQuote === sourceQuote)) {
          extraQuestions.push({ clause, sourceQuote, question, options: options.map(({ label }) => label) });
        }
        continue;
      }

      const id = `run${run}-${ambiguity.id}`;
      rules.ambiguities.push({
        ...ambiguity,
        id,
        options: ambiguity.options.map((option) => ({
          ...option,
          patches:
            option.patches?.map((patch) => ({ ...patch, ruleId: toBase(patch.ruleId) ?? patch.ruleId })) ?? null,
        })),
      });
      for (const { rule } of listRules(rules)) {
        if (linked.includes(rule.id)) rule.ambiguityIds = [...(rule.ambiguityIds ?? []), id];
      }
      targets.forEach((target) => seen.add(target));
    }
  }
  return extraQuestions;
}

export function mergeProposals(proposals: Proposal[]) {
  const base = chooseBase(proposals);
  const others = proposals.flatMap((proposal, index) =>
    proposal === base ? [] : [{ rules: proposal.rules, run: index + 1 }],
  );
  const rules = structuredClone(base.rules);
  const disagreements = collectDisagreements(
    rules,
    others.map((other) => other.rules),
  );
  markForReview(rules, disagreements);
  const extraQuestions = adoptQuestions(rules, others);

  const notes = [...base.notes];
  for (const note of proposals.flatMap((proposal) => proposal.notes)) {
    if (!notes.some(({ sourceQuote }) => sourceQuote === note.sourceQuote)) notes.push(note);
  }
  return { rules, notes, problems: base.problems, disagreements, extraQuestions };
}

// 検出を増やすために、同じ要項を独立に変換して比べる。同じ誤りが3回出れば残る。
export async function extractConsensus(
  model: Parameters<typeof extractRules>[0],
  input: ExtractionInput,
  observe?: (proposal: Proposal & { run: number }) => void,
): Promise<ConsensusResult> {
  const results = await Promise.all(
    Array.from({ length: RUN_COUNT }, (_, run) => {
      const observer: AttemptObserver = (proposal) => observe?.({ ...proposal, run });
      return extractRules(model, input, observer);
    }),
  );
  const attempts = results.flatMap((result) => result.attempts);
  const proposals = results.flatMap((result) => (result.ok ? [result] : []));
  if (proposals.length === 0) {
    const first = results.find((result) => !result.ok);
    return { ok: false, failure: first!.failure, attempts };
  }

  const merged = mergeProposals(proposals);
  return {
    ok: true,
    ...merged,
    problems: [...new Set([...merged.problems, ...validateRuleSet(merged.rules, input.courses)])],
    caseResults: runCheckCases(merged.rules, input.courses, input.cases),
    runs: { requested: RUN_COUNT, succeeded: proposals.length },
    attempts,
  };
}
