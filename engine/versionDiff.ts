import { compareRules } from "./compareRules";
import type { RuleSet } from "./rules";

export type VersionDiff = {
  // 意味の名前（例: 「区分: 基礎科目」）で突き合わせ、値が変わった項目
  changed: { item: string; field: string; before: string; after: string }[];
  removed: string[];
  added: string[];
  // 曖昧箇所は ID で突き合わせる（前の版の回答の対応と同じ。H25）
  ambiguitiesRemoved: { id: string; clause: string; question: string }[];
  ambiguitiesAdded: { id: string; clause: string; question: string }[];
};

function display(value: unknown) {
  if (value === null || value === undefined) return "なし";
  return typeof value === "string" ? value : JSON.stringify(value);
}

// 要項の版の比較。前の版と今の版のルールの差分で、判定はしない
export function diffVersions(previous: RuleSet, current: RuleSet): VersionDiff {
  const { mismatches, missing, extra } = compareRules(previous, current, { includeProvisional: true });
  const ids = (rules: RuleSet) => new Set(rules.ambiguities.map(({ id }) => id));
  const summary = ({ id, clause, question }: RuleSet["ambiguities"][number]) => ({ id, clause, question });
  return {
    changed: mismatches.map(({ item, field, base, other }) => ({
      item,
      field,
      before: display(base),
      after: display(other),
    })),
    removed: missing,
    added: extra,
    ambiguitiesRemoved: previous.ambiguities.filter(({ id }) => !ids(current).has(id)).map(summary),
    ambiguitiesAdded: current.ambiguities.filter(({ id }) => !ids(previous).has(id)).map(summary),
  };
}
