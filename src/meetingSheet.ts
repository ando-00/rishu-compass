import type { JudgmentStatus, OverviewResponse } from "../shared/api";

export type MeetingSheet = {
  summary: OverviewResponse["summary"];
  items: {
    ambiguityId: string;
    clause: string;
    question: string;
    sourceQuote: string;
    computable: boolean;
    countedRuleNames: string[];
    affected: number;
    staffReview: number;
    // 表の列にする判定。どの読み方でも0人の判定は入れない
    statuses: JudgmentStatus[];
    options: { label: string; counts: Partial<Record<JudgmentStatus, number>> | null; reflected: boolean }[];
  }[];
};

const COUNT_ORDER: JudgmentStatus[] = ["delay_risk", "short", "needs_staff", "delayed", "expected", "satisfied"];

// 人数の表の列。どれかの読み方で人数がある判定だけを、重いものから並べる。確認事項の画面と会議資料で同じ列にする。
// 表は特定の判定だけを数えるので、0人の列を出すと「その影響はない」と読まれる（第3回の監査 A3-3）
export function countedStatuses(options: { counts: Partial<Record<JudgmentStatus, number>> | null }[]) {
  return COUNT_ORDER.filter((status) => options.some((option) => option.counts?.[status]));
}

// 読み方ごとの人数が何を数えたものかを1文で書く。確認事項の画面と会議資料で同じ文を使う
export function countedCaption(names: string[]) {
  return names.length > 0
    ? `人数は「${names.join("」「")}」の判定で、学生1人を1回ずつ数えたものです。`
    : "人数は、学生1人を1回ずつ、全判定のうち最も重いもので数えたものです。";
}

// 確認事項を会議で諮るための資料。人数だけを載せ、学生 ID は載せない（持ち出されても個人に辿れないように）
export function buildMeetingSheet(overview: OverviewResponse): MeetingSheet {
  return {
    summary: overview.summary,
    items: overview.unanswered.map((impact) => ({
      ambiguityId: impact.ambiguityId,
      clause: impact.clause,
      question: impact.question,
      sourceQuote: impact.sourceQuote,
      computable: impact.computable,
      countedRuleNames: impact.countedRuleNames,
      affected: impact.affectedStudentIds.length,
      staffReview: impact.staffReviewStudentIds.length,
      statuses: impact.computable ? countedStatuses(impact.options) : [],
      options: impact.options.map(({ label, counts, reflected }) => ({ label, counts, reflected })),
    })),
  };
}
