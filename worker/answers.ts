import { Hono, type Context } from "hono";
import {
  saveAnswerRequestSchema,
  type AnswerRecord,
  type AnswerRecordsResponse,
} from "../shared/api";
import { datasets, type Dataset } from "./datasets";

type Row = {
  ambiguity_id: string;
  option_id: string | null;
  respondent: AnswerRecord["respondent"];
  answered_at: string;
};

export const answerRoutes = new Hono<{ Bindings: Env }>();

// 回答が記録できないときに、回答したことにしない。
answerRoutes.onError((cause, c) => {
  console.error("回答の記録に失敗しました", cause.message);
  return c.json({ error: "回答を記録できませんでした。回答は反映していません。" }, 503);
});

function findDataset(c: Context) {
  return datasets.find((dataset) => dataset.id === c.req.param("id"));
}

function findOption(dataset: Dataset, ambiguityId: string, optionId: string) {
  return dataset.rules.ambiguities
    .find((ambiguity) => ambiguity.id === ambiguityId)
    ?.options.find((option) => option.id === optionId);
}

// 曖昧箇所ごとに最新の行を見る。取り消しと、今のルールにない古い回答は除く。
async function currentRecords(db: D1Database, dataset: Dataset): Promise<AnswerRecordsResponse> {
  const { results } = await db
    .prepare(
      `SELECT ambiguity_id, option_id, respondent, answered_at
       FROM ambiguity_answers
       WHERE id IN (SELECT MAX(id) FROM ambiguity_answers WHERE dataset_id = ?1 GROUP BY ambiguity_id)`,
    )
    .bind(dataset.id)
    .all<Row>();

  const records = results.flatMap(({ ambiguity_id, option_id, respondent, answered_at }) =>
    option_id !== null && findOption(dataset, ambiguity_id, option_id)
      ? [{ ambiguityId: ambiguity_id, optionId: option_id, respondent, answeredAt: answered_at }]
      : [],
  );
  return { records };
}

answerRoutes.get("/:id/answers", async (c) => {
  const dataset = findDataset(c);
  if (!dataset) return c.json({ error: "データがありません" }, 404);
  return c.json(await currentRecords(c.env.DB, dataset));
});

answerRoutes.post("/:id/answers", async (c) => {
  const dataset = findDataset(c);
  if (!dataset) return c.json({ error: "データがありません" }, 404);
  const parsed = saveAnswerRequestSchema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return c.json({ error: "回答の形式が正しくありません" }, 400);

  const { ambiguityId, optionId, respondent } = parsed.data;
  const known =
    optionId === null
      ? dataset.rules.ambiguities.some((ambiguity) => ambiguity.id === ambiguityId)
      : findOption(dataset, ambiguityId, optionId) !== undefined;
  if (!known) return c.json({ error: "回答の形式が正しくありません" }, 400);

  await c.env.DB.prepare(
    `INSERT INTO ambiguity_answers (dataset_id, ambiguity_id, option_id, respondent, answered_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(dataset.id, ambiguityId, optionId, respondent, new Date().toISOString())
    .run();
  return c.json(await currentRecords(c.env.DB, dataset));
});
