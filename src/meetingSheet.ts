import type { JudgmentStatus, OverviewResponse } from "../shared/api";

export type MeetingSheet = {
  summary: OverviewResponse["summary"];
  items: {
    ambiguityId: string;
    clause: string;
    question: string;
    sourceQuote: string;
    computable: boolean;
    affected: number;
    staffReview: number;
    options: { label: string; counts: Partial<Record<JudgmentStatus, number>> | null; reflected: boolean }[];
  }[];
};

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
      affected: impact.affectedStudentIds.length,
      staffReview: impact.staffReviewStudentIds.length,
      options: impact.options.map(({ label, counts, reflected }) => ({ label, counts, reflected })),
    })),
  };
}
