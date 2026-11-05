import { z } from "zod";
import {
  checkPlan,
  evaluateStudent,
  isDisplayablePlan,
  lockedEnrollments,
  pendingPromotions,
  unresolvedEnrollments,
  planningStudent,
  type Answers,
  type Course,
  type PlanEntry,
  type RuleSet,
  type Student,
} from "../../engine";
import type { Correction } from "../../shared/advise";

export type AdvisorInput = {
  rules: RuleSet;
  courses: Course[];
  student: Student;
  answers: Answers;
  adviceRules: string;
};

export type PlanInput = Omit<AdvisorInput, "adviceRules">;

export type AdvisorState = {
  submitted: { plan: PlanEntry[]; draft: string } | null;
  escalated: string | null;
  corrections: Correction[];
};

export type AdvisorTool = {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  run: (input: unknown) => string;
};

const MAX_RESULTS = 30;

// strict の道具は件数や長さの制約を受け付けないので、スキーマの外のコードで検査する。
const filled = z.string().refine((text) => text.trim().length > 0, "空にできません");

const planSchema = z
  .array(z.object({ course: z.string(), term: z.enum(["前期", "後期", "通年"]) }))
  .refine((plan) => plan.length >= 1 && plan.length <= 40, "科目は1〜40件にしてください");

// Claude が日本語を \uXXXX の文字列のまま道具へ渡すことがある。科目名が合わず検査に落ちるので、元の文字に戻す。
function decodeEscapes(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  }
  if (Array.isArray(value)) return value.map(decodeEscapes);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, decodeEscapes(entry)]));
  }
  return value;
}

function defineTool<T extends z.ZodType>(
  name: string,
  description: string,
  inputSchema: T,
  run: (input: z.infer<T>) => unknown,
): AdvisorTool {
  return {
    name,
    description,
    inputSchema,
    run: (input) => {
      const result = run(inputSchema.parse(decodeEscapes(input)));
      return typeof result === "string" ? result : JSON.stringify(result);
    },
  };
}

export const MAX_DRAFT_LENGTH = 600;
export const MAX_REASON_LENGTH = 200;

const DRAFT_CORRECTION = "下書きに、書かない決まりの数値か、卒業や進級の断定が含まれていました。";

// 「一緒に」を数と取り違えないよう、語の後ろの数には単独の「一」を含めない。
const NUMBER = "[0-9〇一二三四五六七八九十百]+";
const NUMBER_AFTER = "(?:[0-9]+|[〇二三四五六七八九十百][〇一二三四五六七八九十百]*)";
const COUNTS = new RegExp(
  [
    `${NUMBER}\\s*単\\s*位`,
    `${NUMBER}\\s*科目(?!でも|を落としても)`,
    `${NUMBER}\\s*credits?`,
    `単位[^。\\n]{0,8}?${NUMBER_AFTER}`,
    // 「3年次」「4年次」「前期」のような時期の数は単位数ではない
    `(?:あと|残り|不足)[^。\\n]{0,6}?${NUMBER_AFTER}(?!\\s*(?:年次|年生|年度|年|期|条|月|回|つ))(?:\\s*単\\s*位|\\s*科目)?`,
    `GPA[^。\\n]{0,6}?[0-9]`,
  ].join("|"),
  "i",
);
// 「卒業できるよう」「留年しないように」は相談の文なので止めない。
const OUTCOMES = "(?:(?:でき|出来)(?!るよう)[ぁ-ん]*|可能(?!性)|不可|無理|難し|確定|間に合|延期|見込み)";
const VERDICTS = new RegExp(`(?:卒業|進級)[^。\\n]{0,12}?${OUTCOMES}|要件を満たして|留年(?!しない)`);
// 頭文字の英字と4桁以上の数字。大学ごとの頭文字に決め打ちしない（3校目の番号でも止める）
const STUDENT_ID = /\b[A-Z]{1,3}\d{4,}\b/;

// 単位数と判定の値は Claude の計算になるので書かせない。判定の数値は画面の engine の結果を見せる。
export function draftProblem(text: string, limit = MAX_DRAFT_LENGTH) {
  if (text.length > limit) return `${limit}字以内にしてください。`;
  const draft = text.normalize("NFKC");
  if (STUDENT_ID.test(draft)) return "学生の番号を外してください。宛名は職員が入れます。";
  const counts = COUNTS.exec(draft);
  if (counts) return `「${counts[0]}」を外してください。単位数や成績の値は職員が画面で確認します。`;
  const verdict = VERDICTS.exec(draft);
  if (verdict) {
    return `「${verdict[0]}」を外してください。卒業や進級の可否を断定せず、「一緒に確認したい」のように書いてください。`;
  }
  return null;
}

function parseAdviceRules(adviceRules: string) {
  return adviceRules.split("\n").flatMap((line) => {
    const cells = line.split("|").map((cell) => cell.trim());
    const [, number, priority, topic, rule] = cells;
    return number && /^\d+$/.test(number) && topic && rule
      ? [{ number: Number(number), major: priority === "主要", topic, rule }]
      : [];
  });
}

function findAdviceRules(adviceRules: string, keyword: string | null) {
  const rules = parseAdviceRules(adviceRules);
  const matched = keyword
    ? rules.filter(({ topic, rule }) => topic.includes(keyword) || rule.includes(keyword))
    : [];
  const shown = matched.length > 0 ? matched : rules.filter(({ major }) => major);
  return shown.map(({ number, topic, rule }) => ({ number, topic, rule }));
}

export function planningTarget({ rules, courses, student, answers }: PlanInput) {
  const locked = lockedEnrollments(rules, courses, student, answers);
  const pendingCourses = unresolvedEnrollments(rules, courses, student, answers);
  return {
    target: planningStudent(student, locked),
    assumptions: { pendingCourses, promotions: pendingPromotions(rules, courses, student, answers) },
    lockedNotes: locked.map((name) =>
      pendingCourses.includes(name)
        ? `${name} は履修条件が未確定なので、修得した前提にしていません。`
        : `${name} は履修条件を満たしていないので、修得した前提にしていません。`,
    ),
  };
}

export function createAdvisorTools(input: AdvisorInput) {
  const { rules, courses, student, answers, adviceRules } = input;
  const { target, lockedNotes, assumptions } = planningTarget(input);
  const state: AdvisorState = { submitted: null, escalated: null, corrections: [] };
  const check = (plan: PlanEntry[]) => checkPlan(rules, courses, target, plan, answers, assumptions);

  // 同じ違反を検査と提出で続けて返しても、直した回数は増えないので1回に数える。
  const noteCorrection = (correction: Correction) => {
    const last = state.corrections.at(-1);
    if (JSON.stringify(last) !== JSON.stringify(correction)) state.corrections.push(correction);
  };

  const planCheck = (plan: PlanEntry[]) => {
    const { status, issues, warnings } = check(plan);
    if (issues.length > 0) {
      // 検査の文だけを経過に残す。科目名は Claude の入力なので、知らない名前は写さない。
      const messages = issues.map(({ code, message, clause }) =>
        code === "UNKNOWN_COURSE" ? "科目データにない科目が入っていました。" : `${message}（${clause}）`,
      );
      noteCorrection({ stage: "plan", messages });
    }
    return {
      status,
      issues: issues.map(({ code, course, message, hint, clause }) => ({ code, course, message, hint, clause })),
      warnings,
    };
  };

  const tools = [
    defineTool(
      "check_requirements",
      "学生の区分別の不足、卒業と履修条件の判定を返す。最初に呼ぶ。案を組む年次と、案を検査するときの前提も返す。",
      z.object({}),
      () => ({
        planningYear: target.studentYear,
        planningAssumption:
          student.currentTerm === "前期"
            ? "同じ年度の登録の案です。"
            : "翌年度の案です。今年度の履修中はすべて修得した前提で検査します。前年度 GPA は未確定なので、緩和の上限は使えません。",
        lockedEnrollments: lockedNotes,
        judgments: evaluateStudent(rules, courses, student, answers).judgments.map(
          ({ name, status, required, actual, enrolled, missingCourses, reason, clause }) => ({
            name,
            status,
            required,
            actual,
            enrolled,
            missingCourses,
            reason,
            clause,
          }),
        ),
      }),
    ),
    defineTool(
      "search_courses",
      "案を組む年次に履修できる開講科目を、1行の科目概要つきで返す。修得済みの科目と、今年度に履修中の科目は返さない。絞り込まない項目は null にする。",
      z.object({
        keyword: z.string().nullable().describe("科目名か概要に含まれる語"),
        group: z.string().nullable().describe("科目群の名前の一部。例: 専門教育/必修"),
        term: z.enum(["前期", "後期", "通年"]).nullable(),
      }),
      ({ keyword, group, term }) => {
        const taken = new Set(
          target.records.filter((record) => record.result === "passed").map((record) => record.course),
        );
        const found = courses
          .filter((course) => course.assignedYear <= target.studentYear && !taken.has(course.name))
          .filter((course) => !term || course.offeredIn === term)
          .filter((course) => !group || course.groups.some((name) => name.includes(group)))
          .filter(
            ({ name, summary }) => !keyword || name.includes(keyword) || summary?.includes(keyword),
          );
        return {
          total: found.length,
          courses: found.slice(0, MAX_RESULTS).map((course) => ({
            name: course.name,
            credits: course.credits,
            groups: course.groups,
            term: course.offeredIn,
            intensive: course.intensive ?? false,
            slots: course.slots ?? [],
            summary: course.summary,
          })),
        };
      },
    ),
    defineTool(
      "validate_plan",
      "履修案を検査して違反の一覧を返す。status が passed になるまで hint をもとに直す。",
      z.object({ plan: planSchema }),
      ({ plan }) => planCheck(plan),
    ),
    defineTool(
      "lookup_advice_rules",
      "職員の履修指導の判断ルールを返す。keyword に論点の語を渡す。null なら主要な論点を返す。",
      z.object({ keyword: z.string().nullable() }),
      ({ keyword }) => findAdviceRules(adviceRules, keyword),
    ),
    defineTool(
      "escalate_to_staff",
      "案を出さず、職員の確認に回す。検査に通る案を組めないときと、要項の外の事情があるときだけ使う。",
      z.object({
        reason: filled.describe("職員に伝える理由。2文までにする。単位数と卒業の可否は書かない"),
      }),
      ({ reason }) => {
        const problem = draftProblem(reason, MAX_REASON_LENGTH);
        if (problem) return { accepted: false, reasonProblem: problem };
        state.escalated = reason;
        return "職員の確認に回しました。ここで終えてください。";
      },
    ),
    defineTool(
      "submit_plan",
      "検査に通った案と、声かけ文の下書きを職員の画面へ出す。通らない案や下書きに問題があるときは、理由を返して受け付けない。直すときは案の全体をもう一度送る。",
      z.object({
        plan: planSchema,
        draft: filled.describe("学生に送る声かけ文の下書き"),
      }),
      ({ plan, draft }) => {
        if (state.escalated !== null) return "職員の確認に回したので、案は受け付けません。";
        const problem = draftProblem(draft);
        if (problem) {
          noteCorrection({ stage: "draft", messages: [DRAFT_CORRECTION] });
          return { accepted: false, draftProblem: problem };
        }
        if (!isDisplayablePlan(check(plan))) return { accepted: false, ...planCheck(plan) };
        state.submitted = { plan, draft };
        return { accepted: true };
      },
    ),
  ];

  return { tools, state, target, lockedNotes };
}
