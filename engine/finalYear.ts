import type { JudgmentStatus, StudentEvaluation } from "./evaluate";
import type { Student } from "./model";
import type { RuleSet, StudentCondition } from "./rules";

export type FinalYearRow = {
  ruleId: string;
  kind: "graduation" | "category";
  name: string;
  clause: string;
  // 区分が当てはまる学生の条件。同じ名前の区分を見分けるために出す（例: 「社会学専攻・副専攻なし」）
  condition?: string;
  counts: Record<JudgmentStatus, number>;
  // 専攻や副専攻の条件で、この区分が当てはまらない学生
  notApplicable: number;
};

export type FinalYearSummary = {
  minYears: number;
  studentCount: number;
  rows: FinalYearRow[];
};

function describeCondition(when: StudentCondition | undefined) {
  if (!when) return "";
  const parts: string[] = [];
  if (when.major) parts.push(when.major);
  if (when.hasMinor !== undefined) parts.push(when.hasMinor ? "副専攻あり" : "副専攻なし");
  return parts.join("・");
}

const emptyCounts =(): Record<JudgmentStatus, number> => ({
  satisfied: 0,
  expected: 0,
  short: 0,
  delay_risk: 0,
  needs_staff: 0,
});

// 最終年次（卒業に必要な在学年数以上の年次）の学生の、卒業要件と区分ごとの判定の人数。
// 判定の値を数えるだけで、新しい判定はしない。履修条件（gate）は卒業要件ではないので含めない。
export function summarizeFinalYear(
  rules: RuleSet,
  students: Student[],
  evaluations: StudentEvaluation[],
): FinalYearSummary {
  const { minYears } = rules.graduation;
  const finalYear = students.filter((student) => student.studentYear >= minYears);
  const byId = new Map(evaluations.map((evaluation) => [evaluation.studentId, evaluation]));
  const rows: FinalYearRow[] = [
    { ruleId: rules.graduation.id, kind: "graduation" as const, name: "卒業要件", clause: rules.graduation.clause },
    ...rules.categories.map((category) => {
      const condition = describeCondition(category.when);
      return {
        ruleId: category.id,
        kind: "category" as const,
        name: category.name,
        clause: category.clause,
        ...(condition ? { condition } : {}),
      };
    }),
  ].map((row) => ({ ...row, counts: emptyCounts(), notApplicable: 0 }));

  for (const student of finalYear) {
    const judgments = byId.get(student.id)?.judgments ?? [];
    for (const row of rows) {
      const judgment = judgments.find((j) => j.ruleId === row.ruleId && j.kind === row.kind);
      if (judgment) row.counts[judgment.status] += 1;
      // 判定がない卒業要件は職員確認に倒す（未確定を確定に見せない）
      else if (row.kind === "graduation") row.counts.needs_staff += 1;
      else row.notApplicable += 1;
    }
  }
  return { minYears, studentCount: finalYear.length, rows };
}
