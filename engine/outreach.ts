import type { Judgment, JudgmentStatus, StudentEvaluation } from "./evaluate";
import type { Student } from "./model";

export type OutreachReason = {
  ruleId: string;
  name: string;
  clause: string;
  sourceQuote: string;
  status: JudgmentStatus;
  detail: string;
};

export type OutreachEntry = {
  studentId: string;
  studentYear: number;
  kind: "contact" | "staff_review";
  severity: number;
  reasons: OutreachReason[];
};

function toReason(judgment: Judgment): OutreachReason {
  const { ruleId, name, clause, sourceQuote, status, reason } = judgment;
  return { ruleId, name, clause, sourceQuote, status, detail: reason };
}

// 数字が大きいほど危険。延期見込み、卒業の不足、履修条件の不足、見込みの危険の順に並べる。
function severityOf(contact: Judgment[]) {
  if (contact.some((judgment) => judgment.status === "delay_risk")) return 4;
  if (contact.some((judgment) => judgment.kind !== "gate" && judgment.status === "short")) return 3;
  if (contact.some((judgment) => judgment.status === "short" && !judgment.atRisk)) return 2;
  return contact.length > 0 ? 1 : 0;
}

// answerSensitive を渡すと、回答で結果が変わる学生だけを未回答による職員確認に入れる。
export function listOutreach(
  evaluations: StudentEvaluation[],
  students: Student[],
  answerSensitive?: Set<string>,
) {
  const years = new Map(students.map((student) => [student.id, student.studentYear]));
  const entries: OutreachEntry[] = [];

  for (const { studentId, excludedReason, judgments } of evaluations) {
    const contact = judgments.filter((judgment) => judgment.needsContact);
    const inReview =
      excludedReason !== null || answerSensitive === undefined || answerSensitive.has(studentId);
    const review = inReview ? judgments.filter((j) => j.status === "needs_staff") : [];
    if (contact.length === 0 && review.length === 0) continue;
    entries.push({
      studentId,
      studentYear: years.get(studentId) ?? 0,
      kind: contact.length > 0 ? "contact" : "staff_review",
      severity: severityOf(contact),
      reasons: [...contact, ...review].map(toReason),
    });
  }

  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "contact" ? -1 : 1;
    if (a.severity !== b.severity) return b.severity - a.severity;
    return b.studentYear - a.studentYear || a.studentId.localeCompare(b.studentId);
  });
}

export function draftOutreachMessage(entry: OutreachEntry) {
  const lines = entry.reasons
    .filter((reason) => reason.status !== "needs_staff")
    .map((reason) => `・${reason.name}（${reason.clause}）: ${reason.detail}`);
  return [
    "【下書き】職員が内容を確認してから使ってください。",
    "",
    "履修状況について、確認していただきたいことがあります。",
    "",
    ...lines,
    "",
    "今後の履修について一緒に確認したいので、教務窓口にお越しください。",
  ].join("\n");
}
