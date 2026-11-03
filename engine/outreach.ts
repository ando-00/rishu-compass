import type { Ground, Judgment, JudgmentStatus, StudentEvaluation } from "./evaluate";
import type { Student } from "./model";

export type OutreachReason = {
  ruleId: string;
  name: string;
  clause: string;
  sourceQuote: string;
  status: JudgmentStatus;
  detail: string;
  grounds?: Ground[];
  // 不足の量。職員確認の判定には付けない（未確定を確定に見せない）
  required?: number;
  actual?: number;
  enrolled?: number;
  missingCourses?: string[];
};

export type OutreachEntry = {
  studentId: string;
  studentYear: number;
  kind: "contact" | "staff_review";
  severity: number;
  reasons: OutreachReason[];
};

function toReason(judgment: Judgment): OutreachReason {
  const { ruleId, name, clause, sourceQuote, status, reason, grounds, required, actual, enrolled, missingCourses } = judgment;
  const amounts =
    status === "needs_staff"
      ? {}
      : {
          ...(required === undefined ? {} : { required }),
          ...(actual === undefined ? {} : { actual }),
          ...(enrolled === undefined ? {} : { enrolled }),
          ...(missingCourses && missingCourses.length > 0 ? { missingCourses } : {}),
        };
  return { ruleId, name, clause, sourceQuote, status, detail: reason, ...(grounds ? { grounds } : {}), ...amounts };
}

// 理由に添える量の文。「修得 18 / 必要 28 単位、履修中 6。未修得: 演習Ⅰ」
export function describeAmounts(reason: OutreachReason) {
  const parts: string[] = [];
  if (reason.required !== undefined && reason.actual !== undefined) {
    parts.push(`修得 ${reason.actual} / 必要 ${reason.required} 単位${reason.enrolled ? `、履修中 ${reason.enrolled}` : ""}`);
  }
  if (reason.missingCourses && reason.missingCourses.length > 0) parts.push(`未修得: ${reason.missingCourses.join("、")}`);
  return parts.join("。");
}

// 数字が大きいほど危険。延期見込み、卒業の不足、履修条件の不足、見込みの危険の順に並べる。
function severityOf(contact: Judgment[]) {
  if (contact.some((judgment) => judgment.status === "delay_risk")) return 4;
  if (contact.some((judgment) => judgment.kind !== "gate" && judgment.status === "short")) return 3;
  if (contact.some((judgment) => judgment.status === "short" && !judgment.atRisk)) return 2;
  return contact.length > 0 ? 1 : 0;
}

// settled には、どの読み方でも対応が要らないと確かめた学生を渡す。それ以外の職員確認は一覧に残す。
export function listOutreach(
  evaluations: StudentEvaluation[],
  students: Student[],
  settled: Set<string> = new Set(),
) {
  const years = new Map(students.map((student) => [student.id, student.studentYear]));
  const entries: OutreachEntry[] = [];

  for (const { studentId, excludedReason, judgments } of evaluations) {
    const contact = judgments.filter((judgment) => judgment.needsContact);
    const inReview = excludedReason !== null || !settled.has(studentId);
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
    .map((reason) => {
      const amounts = describeAmounts(reason);
      return `・${reason.name}（${reason.clause}）: ${reason.detail}${amounts ? `（${amounts}）` : ""}`;
    });
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
