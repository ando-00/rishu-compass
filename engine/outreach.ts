import type { Judgment, JudgmentStatus, StudentEvaluation } from "./evaluate";
import type { Student } from "./model";

export type OutreachReason = {
  ruleId: string;
  name: string;
  clause: string;
  status: JudgmentStatus;
  detail: string;
};

export type OutreachEntry = {
  studentId: string;
  studentYear: number;
  kind: "contact" | "staff_review";
  reasons: OutreachReason[];
};

function needsContact(judgment: Judgment) {
  return judgment.status === "unmet" || (judgment.status === "pending" && judgment.atRisk === true);
}

function toReason({ ruleId, name, clause, status, reason }: Judgment): OutreachReason {
  return { ruleId, name, clause, status, detail: reason };
}

export function listOutreach(evaluations: StudentEvaluation[], students: Student[]) {
  const years = new Map(students.map((student) => [student.id, student.studentYear]));
  const entries: OutreachEntry[] = [];

  for (const { studentId, judgments } of evaluations) {
    const contact = judgments.filter(needsContact);
    const review = judgments.filter((judgment) => judgment.status === "needs_staff");
    if (contact.length === 0 && review.length === 0) continue;
    entries.push({
      studentId,
      studentYear: years.get(studentId) ?? 0,
      kind: contact.length > 0 ? "contact" : "staff_review",
      reasons: [...contact, ...review].map(toReason),
    });
  }

  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "contact" ? -1 : 1;
    return b.studentYear - a.studentYear;
  });
}

export function draftOutreachMessage(entry: OutreachEntry) {
  const lines = entry.reasons.map((reason) => `・${reason.name}（${reason.clause}）: ${reason.detail}`);
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
