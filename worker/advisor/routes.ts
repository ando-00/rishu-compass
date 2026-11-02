import { Hono } from "hono";
import adviceRules from "../../data/fictional/advice-rules.md?raw";
import { answersRequestSchema } from "../../shared/api";
import { claudeKey, FAILURE_STATUS, type ClaudeBindings } from "../claudeAccess";
import { datasets, isValidAnswers } from "../datasets";
import { ModelError } from "../rule-extraction/model";
import { adviseStudent } from "./advise";
import { createAdvisorLoop } from "./claude";

export const advisorRoutes = new Hono<{ Bindings: Env & ClaudeBindings }>();

advisorRoutes.post("/:id/students/:studentId/advise", async (c) => {
  const apiKey = claudeKey(c.env ?? {});
  if (!apiKey) return c.json({ error: "この環境では履修案の作成を使えません" }, 403);
  const dataset = datasets.find(({ id }) => id === c.req.param("id"));
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

  const { rules, courses } = dataset;
  const input = { rules, courses, student, answers: body.data.answers, adviceRules };
  try {
    return c.json(await adviseStudent(createAdvisorLoop(apiKey), input));
  } catch (cause) {
    if (cause instanceof ModelError) return c.json({ error: cause.message }, FAILURE_STATUS[cause.kind]);
    throw cause;
  }
});
