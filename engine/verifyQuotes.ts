import { listRules } from "./answers";
import type { RuleSet } from "./rules";

export type Quote = {
  ruleId: string;
  sourceQuote: string;
};

// 比較の前にそろえるのは、空白と全角の英数字だけ。言い換えは認めない。
function normalize(text: string) {
  return text
    .replace(/[０-９Ａ-Ｚａ-ｚ．]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[\s　]+/g, "");
}

export function collectQuotes(rules: RuleSet): Quote[] {
  return [
    ...listRules(rules).map(({ rule }) => ({ ruleId: rule.id, sourceQuote: rule.sourceQuote })),
    ...rules.ambiguities.map(({ id, sourceQuote }) => ({ ruleId: id, sourceQuote })),
  ];
}

export function verifyQuotes(quotes: Quote[], handbook: string) {
  const body = normalize(handbook);
  return quotes.filter(({ sourceQuote }) => {
    const quote = normalize(sourceQuote);
    return quote === "" || !body.includes(quote);
  });
}
