import { describe, expect, it } from "vitest";
import { verifyQuotes } from "../verifyQuotes";
import { exampleRules } from "../../data/fictional/example/rules";

const HANDBOOK = "第1条　卒業には、合計50単位\n以上を修得する。\n第２条  ＧＰＡ３.０以上の学生。";

describe("verifyQuotes", () => {
  it("本文にある文は通す", () => {
    expect(verifyQuotes([{ ruleId: "a", sourceQuote: "卒業には、合計50単位" }], HANDBOOK)).toEqual([]);
  });

  it("改行と連続する空白の違いはそろえる", () => {
    expect(verifyQuotes([{ ruleId: "a", sourceQuote: "合計50単位 以上を修得する" }], HANDBOOK)).toEqual([]);
  });

  it("全角と半角の英数字の違いはそろえる", () => {
    expect(verifyQuotes([{ ruleId: "a", sourceQuote: "GPA3.0以上" }], HANDBOOK)).toEqual([]);
  });

  it("根拠の文が要項にないときは検査に落とす", () => {
    const quotes = [{ ruleId: "a", sourceQuote: "合計60単位以上を修得する" }];
    expect(verifyQuotes(quotes, HANDBOOK)).toEqual(quotes);
  });

  it("言い換えは認めない", () => {
    const quotes = [{ ruleId: "a", sourceQuote: "卒業するには合計50単位" }];
    expect(verifyQuotes(quotes, HANDBOOK)).toEqual(quotes);
  });

  it("空の文は検査に落とす", () => {
    const quotes = [{ ruleId: "a", sourceQuote: "  " }];
    expect(verifyQuotes(quotes, HANDBOOK)).toEqual(quotes);
  });

  it("ルール全体の根拠の文を集められる", async () => {
    const { collectQuotes } = await import("../verifyQuotes");
    const quotes = collectQuotes(exampleRules);
    expect(quotes.map((quote) => quote.ruleId)).toContain("gate-seminar");
    expect(quotes.map((quote) => quote.ruleId)).toContain("ambiguity-seminar-credits");
  });
});
