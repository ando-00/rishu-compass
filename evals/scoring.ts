import { z } from "zod";
import { evaluateStudent, type Course, type Judgment, type RuleSet, type Student } from "../engine";
import type { AdviseResponse } from "../shared/advise";

const goldStudentSchema = z.object({
  // 修得済みの単位で数えた、区分ごとの不足単位。不足がない区分は書かない
  shortages: z.record(z.string(), z.number().int().positive()),
  // 今年度の卒業が難しい見込みか
  delay: z.boolean(),
  // 職員に回すべきか
  escalate: z.boolean(),
  // 伝えるべき要点。判断ルールの番号で書く
  points: z.array(z.number().int().positive()),
});

// 正解は作り手が書く。Claude の出力や engine の結果から作らない
export const evalGoldSchema = z.object({
  answers: z.record(z.string(), z.string()),
  students: z.record(z.string(), goldStudentSchema),
});

export type GoldStudent = z.infer<typeof goldStudentSchema>;

// 設計書 v4 第8節の危険な誤り
export type DangerKind =
  | "short_shown_met" // 不足があるのに足りていると示す
  | "met_shown_short" // 足りているのに不足と示す
  | "delay_missed" // 今年度の卒業が難しい見込みなのに可能と示す
  | "false_delay" // 卒業できるのに延期見込みと示す
  | "not_escalated" // 職員に回すべき学生や案を回さない
  | "unresolved_shown"; // 未確定のルールを確定として示す

export type Danger = { studentId: string; kind: DangerKind; detail: string };

function compareCredits(studentId: string, gold: GoldStudent, judgments: Judgment[]) {
  const differences: { category: string; gold: number; actual: number }[] = [];
  const dangerous: Danger[] = [];
  let total = 0;

  for (const { name, kind, status, required, actual } of judgments) {
    if (kind !== "category" || required === undefined || actual === undefined) continue;
    total += 1;
    const expected = gold.shortages[name] ?? 0;
    const shown = Math.max(required - actual, 0);
    if (expected !== shown) differences.push({ category: name, gold: expected, actual: shown });
    if (expected > 0 && status === "satisfied") {
      dangerous.push({ studentId, kind: "short_shown_met", detail: `${name}: 正解は不足 ${expected}単位` });
    }
    if (expected === 0 && (status === "short" || status === "delay_risk")) {
      dangerous.push({ studentId, kind: "met_shown_short", detail: `${name}: 正解は不足なし` });
    }
  }
  return { credits: { matched: total - differences.length, total, differences }, dangerous };
}

function compareGraduation(studentId: string, gold: GoldStudent, judgments: Judgment[]): Danger[] {
  const status = judgments.find(({ kind }) => kind === "graduation")?.status;
  if (gold.delay && (status === "satisfied" || status === "expected")) {
    return [{ studentId, kind: "delay_missed", detail: `卒業要件の判定は ${status}` }];
  }
  if (!gold.delay && status === "delay_risk") {
    return [{ studentId, kind: "false_delay", detail: "卒業要件の判定は delay_risk" }];
  }
  return [];
}

export function scoreStudent(
  studentId: string,
  gold: GoldStudent,
  judgments: Judgment[],
  advice: AdviseResponse | null,
) {
  const { credits, dangerous } = compareCredits(studentId, gold, judgments);
  // 職員面談に回す印（H28）の付いた案は、職員に回したものとして数える
  const escalated =
    advice?.status === "needs_staff" || (advice?.status === "passed" && advice.staffReview !== undefined);
  const notEscalated: Danger[] =
    gold.escalate && advice !== null && !escalated
      ? [{ studentId, kind: "not_escalated", detail: "職員に回すべき学生に案を出した" }]
      : [];
  return {
    credits,
    dangerous: [...dangerous, ...compareGraduation(studentId, gold, judgments), ...notEscalated],
    overEscalated: !gold.escalate && escalated,
    adviceMissing: advice === null,
  };
}

type Outcomes = { unanswered: Judgment[]; byOption: Record<string, Judgment[]> };

function judgeEachReading(rules: RuleSet, courses: Course[], student: Student): Outcomes[] {
  const unanswered = evaluateStudent(rules, courses, student, {}).judgments;
  return rules.ambiguities.map(({ id, options }) => ({
    unanswered,
    byOption: Object.fromEntries(
      options
        .filter(({ patches }) => patches !== null)
        .map((option) => [option.id, evaluateStudent(rules, courses, student, { [id]: option.id }).judgments]),
    ),
  }));
}

// 未回答で確定の判定が、読み方によって変わるなら、未確定のルールを確定として示している。
export function unresolvedShown(rules: RuleSet, courses: Course[], student: Student, outcomes?: Outcomes) {
  const shown = new Set<string>();
  for (const { unanswered, byOption } of outcomes ? [outcomes] : judgeEachReading(rules, courses, student)) {
    for (const { ruleId, name, status } of unanswered) {
      if (status === "needs_staff") continue;
      const readings = Object.values(byOption).map(
        (judgments) => judgments.find((judgment) => judgment.ruleId === ruleId)?.status,
      );
      if (readings.some((reading) => reading !== status)) shown.add(name);
    }
  }
  return [...shown];
}

type RecordedCall = { tool: string; output: string };

function checkPassed({ tool, output }: RecordedCall) {
  if (tool === "validate_plan") return output.startsWith('{"status":"passed"');
  return tool === "submit_plan" ? output.startsWith('{"accepted":true') : null;
}

// 履修案の検査通過（設計書 v4 第8節）。検査まで進んだ学生のうち、最初の検査と最後の結果を数える。
export function summarizeChecks(results: { calls: RecordedCall[]; result: AdviseResponse }[]) {
  const checked = results.filter(({ calls }) => calls.some((call) => checkPassed(call) !== null));
  const firstOf = (calls: RecordedCall[]) => calls.map(checkPassed).find((passed) => passed !== null);
  return {
    attempted: checked.length,
    firstPassed: checked.filter(({ calls }) => firstOf(calls)).length,
    finalPassed: checked.filter(({ result }) => result.status === "passed").length,
  };
}
