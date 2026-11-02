import { Hono, type Context } from "hono";
import type { z } from "zod";
import {
  computeImpact,
  computeImpacts,
  checkPlan,
  draftOutreachMessage,
  evaluatePrepared,
  evaluateStudent,
  isDisplayablePlan,
  listOutreach,
  prepareRules,
} from "../engine";
import {
  answersRequestSchema,
  extractRequestSchema,
  planCheckRequestSchema,
  type Answers,
  type DatasetsResponse,
  type OverviewResponse,
  type PlanCheckResponse,
  type ProposalResponse,
  type SourcesResponse,
  type StudentResponse,
} from "../shared/api";
import { answerRoutes } from "./answers";
import { datasets, findSource, listSources, type Dataset } from "./datasets";
import { createClaudeModel } from "./rule-extraction/claude";
import { extractConsensus } from "./rule-extraction/consensus";
import type { ExtractionFailure } from "./rule-extraction/extract";

// 型の定義は .dev.vars から生成されるので、これがない環境でも通るようここに書く。
type ClaudeBindings = {
  ANTHROPIC_API_KEY?: string;
  ALLOW_CLAUDE?: string;
};

const app = new Hono<{ Bindings: Env & ClaudeBindings }>();

// 公開 URL の利用の制限が決まるまで、明示して開けた環境でだけ Claude を呼ぶ。
function claudeKey({ ALLOW_CLAUDE, ANTHROPIC_API_KEY }: ClaudeBindings) {
  return ALLOW_CLAUDE === "true" && ANTHROPIC_API_KEY ? ANTHROPIC_API_KEY : null;
}

const FAILURE_STATUS: Record<ExtractionFailure["kind"], 429 | 502 | 504> = {
  rate_limited: 429,
  timeout: 504,
  api_error: 502,
  refusal: 502,
  truncated: 502,
  invalid_format: 502,
};

async function parseBody<T extends z.ZodType>(c: Context, schema: T) {
  const result = schema.safeParse(await c.req.json().catch(() => undefined));
  return result.success ? result.data : null;
}

function isValidAnswers(dataset: Dataset, answers: Answers) {
  return Object.entries(answers).every(([ambiguityId, optionId]) =>
    dataset.rules.ambiguities
      .find((ambiguity) => ambiguity.id === ambiguityId)
      ?.options.some((option) => option.id === optionId),
  );
}

function findDataset(c: Context) {
  return datasets.find((dataset) => dataset.id === c.req.param("id"));
}

function buildOverview(dataset: Dataset, answers: Answers): OverviewResponse {
  const { rules, courses, students } = dataset;
  const prepared = prepareRules(rules, courses, answers);
  const evaluations = students.map((student) => evaluatePrepared(prepared, student));
  const unanswered = computeImpacts(rules, courses, students, answers);
  // 未回答でも結果が変わらない学生は、職員確認の一覧に入れない。
  const answerSensitive = new Set(
    unanswered.flatMap((impact) =>
      impact.computable ? impact.affectedStudentIds : impact.staffReviewStudentIds,
    ),
  );
  const outreach = listOutreach(evaluations, students, answerSensitive);
  const states = new Map(outreach.map((entry) => [entry.studentId, entry.kind]));
  const contact = outreach.filter((entry) => entry.kind === "contact").length;
  const staffReview = outreach.length - contact;

  return {
    summary: { total: students.length, contact, staffReview, clear: students.length - outreach.length },
    unanswered,
    answered: Object.entries(answers).map(([ambiguityId, optionId]) => ({
      ...computeImpact(rules, courses, students, answers, ambiguityId),
      optionId,
    })),
    outreach: outreach.map((entry) => ({
      ...entry,
      draft: entry.kind === "contact" ? draftOutreachMessage(entry) : null,
    })),
    students: students.map(({ id, studentYear, major }) => ({
      id,
      studentYear,
      ...(major ? { major } : {}),
      state: states.get(id) ?? "clear",
    })),
  };
}

app.get("/api/health", (c) => c.json({ status: "ok" }));

app.get("/api/datasets", (c) => {
  const body: DatasetsResponse = {
    datasets: datasets.map(({ id, name, problems }) => ({ id, name, problems })),
  };
  return c.json(body);
});

app.get("/api/sources", (c) => {
  const body: SourcesResponse = {
    extractionEnabled: claudeKey(c.env ?? {}) !== null,
    sources: listSources(),
  };
  return c.json(body);
});

app.post("/api/sources/:id/extract", async (c) => {
  const apiKey = claudeKey(c.env ?? {});
  if (!apiKey) return c.json({ error: "この環境では要項の変換を使えません" }, 403);
  const source = findSource(c.req.param("id"));
  if (!source) return c.json({ error: "データがありません" }, 404);
  const body = await parseBody(c, extractRequestSchema);
  if (!body) return c.json({ error: "要項の形式が正しくありません" }, 400);

  const input = { ...source, handbook: body.handbook };
  const result = await extractConsensus(createClaudeModel(apiKey), input);
  if (!result.ok) {
    return c.json({ error: result.failure.message }, FAILURE_STATUS[result.failure.kind]);
  }

  const { rules, notes, problems, attempts, runs, disagreements, extraQuestions } = result;
  const response: ProposalResponse = {
    rules,
    notes,
    problems,
    impacts: problems.length === 0 ? computeImpacts(rules, source.courses, source.students, {}) : null,
    runs,
    disagreements,
    extraQuestions,
    attempts,
  };
  return c.json(response);
});

app.post("/api/datasets/:id/overview", async (c) => {
  const dataset = findDataset(c);
  if (!dataset) return c.json({ error: "データがありません" }, 404);
  if (dataset.problems.length > 0) {
    return c.json({ error: "ルールに問題があります", problems: dataset.problems }, 422);
  }
  const body = await parseBody(c, answersRequestSchema);
  if (!body || !isValidAnswers(dataset, body.answers)) {
    return c.json({ error: "回答の形式が正しくありません" }, 400);
  }
  return c.json(buildOverview(dataset, body.answers));
});

app.post("/api/datasets/:id/students/:studentId", async (c) => {
  const dataset = findDataset(c);
  if (!dataset) return c.json({ error: "データがありません" }, 404);
  if (dataset.problems.length > 0) {
    return c.json({ error: "ルールに問題があります", problems: dataset.problems }, 422);
  }
  const student = dataset.students.find(({ id }) => id === c.req.param("studentId"));
  if (!student) return c.json({ error: "学生がいません" }, 404);
  const body = await parseBody(c, answersRequestSchema);
  if (!body || !isValidAnswers(dataset, body.answers)) {
    return c.json({ error: "回答の形式が正しくありません" }, 400);
  }

  const { excludedReason, judgments } = evaluateStudent(
    dataset.rules,
    dataset.courses,
    student,
    body.answers,
  );
  const { id, studentYear, admissionYear, major, hasMinor, specialStatuses } = student;
  const response: StudentResponse = {
    student: {
      id,
      studentYear,
      admissionYear,
      ...(major ? { major } : {}),
      ...(hasMinor === undefined ? {} : { hasMinor }),
      specialStatuses,
    },
    excludedReason,
    judgments,
  };
  return c.json(response);
});

app.post("/api/datasets/:id/plan-check", async (c) => {
  const dataset = findDataset(c);
  if (!dataset) return c.json({ error: "データがありません" }, 404);
  if (dataset.problems.length > 0) {
    return c.json({ error: "ルールに問題があります", problems: dataset.problems }, 422);
  }
  const body = await parseBody(c, planCheckRequestSchema);
  if (!body || !isValidAnswers(dataset, body.answers)) {
    return c.json({ error: "履修案の形式が正しくありません" }, 400);
  }
  const student = dataset.students.find(({ id }) => id === body.studentId);
  if (!student) return c.json({ error: "学生がいません" }, 404);

  const check = checkPlan(dataset.rules, dataset.courses, student, body.plan, body.answers);
  const response: PlanCheckResponse = {
    ...check,
    plan: isDisplayablePlan(check) ? body.plan : null,
  };
  return c.json(response);
});

app.route("/api/datasets", answerRoutes);

export default app;
