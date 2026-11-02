import { z } from "zod";
import {
  checkPlan,
  evaluateStudent,
  isDisplayablePlan,
  planningStudent,
  type Answers,
  type Course,
  type PlanEntry,
  type RuleSet,
  type Student,
} from "../../engine";

export type AdvisorInput = {
  rules: RuleSet;
  courses: Course[];
  student: Student;
  answers: Answers;
  adviceRules: string;
};

export type AdvisorState = {
  submitted: { plan: PlanEntry[]; draft: string } | null;
  escalated: string | null;
};

export type AdvisorTool = {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  run: (input: unknown) => string;
};

const MAX_RESULTS = 30;

const planSchema = z
  .array(z.object({ course: z.string(), term: z.enum(["前期", "後期", "通年"]) }))
  .min(1)
  .max(40);

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
      const result = run(inputSchema.parse(input));
      return typeof result === "string" ? result : JSON.stringify(result);
    },
  };
}

// 下書きの単位数は Claude の計算になるので書かせない。判定の数値は画面の engine の結果を見せる。
export function draftProblem(draft: string) {
  if (/[0-9０-９]+\s*単位/.test(draft)) {
    return "単位数を書かないでください。判定の数値は職員が画面で確認します。";
  }
  if (/卒業(でき|可能|不可|確定|が確定)|留年(し|が確定|確定)/.test(draft)) {
    return "卒業の可否を断定する表現を外してください。「一緒に確認したい」のように書いてください。";
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

export function createAdvisorTools(input: AdvisorInput) {
  const { rules, courses, student, answers, adviceRules } = input;
  const target = planningStudent(student);
  const state: AdvisorState = { submitted: null, escalated: null };
  const check = (plan: PlanEntry[]) => checkPlan(rules, courses, target, plan, answers);

  const planCheck = (plan: PlanEntry[]) => {
    const { status, issues, warnings } = check(plan);
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
          target === student
            ? "同じ年度の登録の案です。"
            : "翌年度の案です。今年度の履修中はすべて修得した前提で検査します。前年度 GPA は未確定なので、緩和の上限は使えません。",
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
      "案を出さず、職員の確認に回す。判断できないとき、検査に通る案を組めないときに使う。",
      z.object({ reason: z.string().min(1).describe("職員に伝える理由") }),
      ({ reason }) => {
        state.escalated = reason;
        return "職員の確認に回しました。ここで終えてください。";
      },
    ),
    defineTool(
      "submit_plan",
      "検査に通った案と、声かけ文の下書きを職員の画面へ出す。通らない案は違反を返して受け付けない。",
      z.object({
        plan: planSchema,
        draft: z.string().min(1).describe("学生に送る声かけ文の下書き"),
      }),
      ({ plan, draft }) => {
        if (state.escalated !== null) return "職員の確認に回したので、案は受け付けません。";
        const problem = draftProblem(draft);
        if (problem) return { accepted: false, draftProblem: problem };
        if (!isDisplayablePlan(check(plan))) return { accepted: false, ...planCheck(plan) };
        state.submitted = { plan, draft };
        return { accepted: true };
      },
    ),
  ];

  return { tools, state };
}
