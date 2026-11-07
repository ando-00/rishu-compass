import type { Judgment, JudgmentStatus } from "../shared/api";

type Option = { counts: Partial<Record<JudgmentStatus, number>> | null };

// 履修案の検査に関わる確認事項の説明。読み方で表の人数が変わらないなら「人数のほか」と言わない
export function planCheckNotice(options: Option[]) {
  const statuses = new Set(options.flatMap(({ counts }) => Object.keys(counts ?? {}) as JudgmentStatus[]));
  const differs = [...statuses].some(
    (status) => new Set(options.map(({ counts }) => counts?.[status] ?? 0)).size > 1,
  );
  return differs
    ? "履修案の検査に関わる確認事項です。人数のほか、検査の結果も変わります。"
    : "履修案の検査に関わる確認事項です。どの読み方でも表の人数は同じで、検査の結果が変わります。";
}

// 対応なしなのに職員確認の行がある学生の説明。この形になるのは、engine の settledStudentIds で確かめた学生だけ
export function settledNotice(state: "contact" | "staff_review" | "clear" | undefined, judgments: Pick<Judgment, "status">[]) {
  if (state !== "clear" || !judgments.some(({ status }) => status === "needs_staff")) return null;
  return "未回答の確認事項に関わる判定がありますが、どの読み方でも対応が要らないと確かめたので、この学生は対応なしです。";
}
