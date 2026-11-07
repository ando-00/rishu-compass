import { describe, expect, it } from "vitest";
import { quoteText } from "../quoteText";

const recorded = import.meta.glob("../../data/fictional/*/recorded-proposal.json", { eager: true, import: "default" });

function quotesIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(quotesIn);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, item]) => (key === "sourceQuote" && typeof item === "string" ? [item] : quotesIn(item)));
}

describe("根拠の文の見せ方", () => {
  it("要項の表の1行は、記号を除いて区切って見せる", () => {
    expect(quoteText("| 基礎教育 | 必修 | 8 |")).toBe("基礎教育 ／ 必修 ／ 8");
  });

  it("表でない文はそのまま見せる", () => {
    expect(quoteText("修得単位が合計60単位以上であること")).toBe("修得単位が合計60単位以上であること");
  });

  it("文の途中の記号は表とみなさない", () => {
    expect(quoteText("A | B")).toBe("A | B");
  });

  it("架空の2校の変換の記録のどの根拠の文にも、表の記号を残さない", () => {
    const quotes = quotesIn(recorded);
    expect(quotes.filter((quote) => quote.includes("|")).length).toBeGreaterThan(0);
    expect(quotes.map(quoteText).filter((text) => text.includes("|"))).toEqual([]);
  });
});
