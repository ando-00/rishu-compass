import { Hono, type Context } from "hono";
import adviceRules from "../../data/fictional/advice-rules.md?raw";
import { NO_ADVISOR_MESSAGE } from "../../shared/advise";
import { answersRequestSchema } from "../../shared/api";
import { claudeKey, FAILURE_STATUS, type ClaudeBindings } from "../claudeAccess";
import { isValidAnswers } from "../datasets";
import { resolveDataset } from "../ruleSets";
import { ModelError } from "../rule-extraction/model";
import { adviseStudent } from "./advise";
import { createAdvisorLoop } from "./claude";
import { findAdvice, findRecordedAdvice, recordAdvice } from "./records";

type Bindings = { Bindings: Env & ClaudeBindings };

export const advisorRoutes = new Hono<Bindings>();

async function readRequest(c: Context<Bindings>) {
  const dataset = await resolveDataset(c.env?.DB, c.req.param("id") ?? "");
  if (!dataset) return c.json({ error: "データがありません" }, 404);
  if (dataset.problems.length > 0) {
    return c.json({ error: "ルールに問題があります", problems: dataset.problems }, 422);
  }
  const student = dataset.students.find(({ id }) => id === c.req.param("studentId"));
  if (!student) return c.json({ error: "学生がいません" }, 404);
  const body = answersRequestSchema.safeParse(await c.req.json().catch(() => undefined));
  if (!body.success || !isValidAnswers(dataset, body.data.answers)) {
    return c.json({ error: "回答の形式が正しくありません" }, 400);
  }

  const { id, sourceId, rules, courses } = dataset;
  return {
    datasetId: id,
    sourceId: sourceId ?? "",
    input: { rules, courses, student, answers: body.data.answers },
  };
}

advisorRoutes.post("/:id/students/:studentId/advise", async (c) => {
  const apiKey = claudeKey(c.env ?? {});
  if (!apiKey) return c.json({ error: NO_ADVISOR_MESSAGE }, 403);
  const request = await readRequest(c);
  if (request instanceof Response) return request;

  const { datasetId, input } = request;
  try {
    const advice = await adviseStudent(createAdvisorLoop(apiKey), { ...input, adviceRules });
    return c.json({ advice, recordedAt: await recordAdvice(c.env?.DB, datasetId, input, advice) });
  } catch (cause) {
    if (cause instanceof ModelError) return c.json({ error: cause.message }, FAILURE_STATUS[cause.kind]);
    throw cause;
  }
});

// 記録を読むだけで Claude を呼ばないので、ALLOW_CLAUDE を見ない。
advisorRoutes.post("/:id/students/:studentId/advice/latest", async (c) => {
  const request = await readRequest(c);
  if (request instanceof Response) return request;
  const { datasetId, sourceId, input } = request;
  const saved = await findAdvice(c.env?.DB, datasetId, input);
  return c.json(findRecordedAdvice(sourceId, input) ? { ...saved, recordingAvailable: true } : saved);
});

// Claude を呼ばず、同梱の記録を通常の案と同じように記録して返す。
advisorRoutes.post("/:id/students/:studentId/advice/recorded", async (c) => {
  const request = await readRequest(c);
  if (request instanceof Response) return request;
  const { datasetId, sourceId, input } = request;
  const advice = findRecordedAdvice(sourceId, input);
  if (!advice) return c.json({ error: "この学生と回答の記録はありません" }, 404);
  return c.json({ advice, recordedAt: await recordAdvice(c.env?.DB, datasetId, input, advice) });
});
