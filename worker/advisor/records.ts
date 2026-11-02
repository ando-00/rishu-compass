import type { Answers } from "../../engine";
import { adviseResponseSchema, type AdviseResponse, type SavedAdvice } from "../../shared/advise";
import { reviewPlan } from "./advise";
import type { PlanInput } from "./tools";

type Row = { advice: string; created_at: string };

const NOTHING: SavedAdvice = { advice: null, recordedAt: null };

// 同じ回答が同じ文字列になるように、並びを揃える。
export function answersKey(answers: Answers) {
  return JSON.stringify(Object.entries(answers).sort(([a], [b]) => (a < b ? -1 : 1)));
}

// 案は検査を通っていて費用もかかっているので、記録に失敗しても返す。画面で記録できなかったことを示す。
export async function recordAdvice(
  db: D1Database | undefined,
  datasetId: string,
  input: PlanInput,
  advice: AdviseResponse,
) {
  const recordedAt = new Date().toISOString();
  try {
    if (!db) throw new Error("D1 がありません");
    await db
      .prepare(
        `INSERT INTO plans (dataset_id, student_id, answers, advice, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .bind(datasetId, input.student.id, answersKey(input.answers), JSON.stringify(advice), recordedAt)
      .run();
    return recordedAt;
  } catch (cause) {
    console.error("履修案の記録に失敗しました", cause instanceof Error ? cause.message : cause);
    return null;
  }
}

// 今の回答で作った最新の記録を返す。回答が違えば別の前提の案なので返さない。
export async function findAdvice(
  db: D1Database | undefined,
  datasetId: string,
  input: PlanInput,
): Promise<SavedAdvice> {
  if (!db) return NOTHING;
  const { results } = await db
    .prepare(
      `SELECT advice, created_at FROM plans
       WHERE dataset_id = ?1 AND student_id = ?2 AND answers = ?3
       ORDER BY id DESC LIMIT 1`,
    )
    .bind(datasetId, input.student.id, answersKey(input.answers))
    .all<Row>();
  const [row] = results;
  if (!row) return NOTHING;

  const advice = adviseResponseSchema.parse(JSON.parse(row.advice));
  if (advice.status === "needs_staff") return { advice, recordedAt: row.created_at };
  const plan = advice.plan.map(({ course, term }) => ({ course, term }));
  const reviewed = reviewPlan(input, plan, advice.draft, advice.iterations);
  return reviewed ? { advice: reviewed, recordedAt: row.created_at } : NOTHING;
}
