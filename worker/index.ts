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
  settledStudentIds,
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
import { advisorRoutes } from "./advisor/routes";
import { planningTarget } from "./advisor/tools";
import { claudeKey, FAILURE_STATUS, type ClaudeBindings } from "./claudeAccess";
import { findSource, isValidAnswers, listSources, type Dataset } from "./datasets";
import { createClaudeModel } from "./rule-extraction/claude";
import { extractConsensus } from "./rule-extraction/consensus";
import {
  listDatasets,
  resolveDataset,
  ruleSetRoutes,
  saveProposal,
  toProposalResponse,
} from "./ruleSets";

const app = new Hono<{ Bindings: Env & ClaudeBindings }>();

async function parseBody<T extends z.ZodType>(c: Context, schema: T) {
  const result = schema.safeParse(await c.req.json().catch(() => undefined));
  return result.success ? result.data : null;
}

function findDataset(c: Context) {
  return resolveDataset(c.env?.DB, c.req.param("id") ?? "");
}

function buildOverview(dataset: Dataset, answers: Answers): OverviewResponse {
  const { rules, courses, students } = dataset;
  const prepared = prepareRules(rules, courses, answers);
  const evaluations = students.map((student) => evaluatePrepared(prepared, student));
  const unanswered = computeImpacts(rules, courses, students, answers);
  const pending = new Set(
    evaluations
      .filter(({ judgments }) => judgments.some(({ status }) => status === "needs_staff"))
      .map(({ studentId }) => studentId),
  );
  const candidates = students.filter(({ id }) => pending.has(id));
  const outreach = listOutreach(
    evaluations,
    students,
    settledStudentIds(rules, courses, candidates, answers),
  );
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

app.get("/api/datasets", async (c) => {
  const listed = await listDatasets(c.env?.DB);
  const body: DatasetsResponse = {
    datasets: listed.map(({ id, name, problems, confirmation }) => ({
      id,
      name,
      problems,
      ...(confirmation ? { confirmation } : {}),
    })),
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

  const { ok: _ok, ...proposal } = result;
  const proposalId = await saveProposal(c.env?.DB, source.id, body.handbook, proposal);
  const response: ProposalResponse = toProposalResponse(proposal, source, proposalId);
  return c.json(response);
});

app.post("/api/datasets/:id/overview", async (c) => {
  const dataset = await findDataset(c);
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
  const dataset = await findDataset(c);
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
  const dataset = await findDataset(c);
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

  // 案の作成と同じ前提で検査する。
  const { rules, courses } = dataset;
  const input = { rules, courses, student, answers: body.answers };
  const { target, lockedNotes } = planningTarget(input);
  const check = checkPlan(rules, courses, target, body.plan, body.answers);
  const response: PlanCheckResponse = {
    ...check,
    warnings: [...lockedNotes, ...check.warnings],
    plan: isDisplayablePlan(check) ? body.plan : null,
  };
  return c.json(response);
});

app.route("/api/datasets", answerRoutes);
app.route("/api/datasets", advisorRoutes);
app.route("/api", ruleSetRoutes);

export default app;
