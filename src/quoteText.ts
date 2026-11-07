// 要項の表の1行を引いた根拠の文を、表の記号を除いて見せる。
// 保存する文と、要項にあるかの検査は原文のままなので、ここで変えるのは見せ方だけ。
export function quoteText(quote: string) {
  const line = quote.trim();
  if (!line.startsWith("|") || !line.endsWith("|")) return quote;
  return line
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim())
    .join(" ／ ");
}
