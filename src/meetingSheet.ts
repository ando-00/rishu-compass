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
    options: { label: string; counts: Partial<Record<JudgmentStatus, number>> | null; reflected: boolean }[];
  }[];
};

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
      options: impact.options.map(({ label, counts, reflected }) => ({ label, counts, reflected })),
    })),
  };
}
