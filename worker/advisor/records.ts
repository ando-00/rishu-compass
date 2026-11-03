import type { Answers } from "../../engine";
import { adviseResponseSchema, type AdviseResponse, type SavedAdvice } from "../../shared/advise";
import { reviewPlan } from "./advise";
import type { PlanInput } from "./tools";

type Row = { advice: string; created_at: string };

type RecordedAdvice = {
  recording: { model: string; recordedAt: string };
  // 正解ルールと記録のルール案では曖昧箇所の ID が違うので、回答の形を両方持つ
  records: { studentId: string; answers: Answers[]; advice: unknown }[];
};

const NOTHING: SavedAdvice = { advice: null, recordedAt: null };

// API キーなしで試せるよう、実際に作った案の記録を同梱する。作り方は evals/record-advice.ts にある。
const recordedModules = import.meta.glob<RecordedAdvice>("../../data/fictional/*/recorded-advice.json", {
  eager: true,
  import: "default",
});

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
    // Error 以外の値は中身（案や下書きを含みうる）をログに出さず、型だけを出す
    console.error("履修案の記録に失敗しました", cause instanceof Error ? cause.message : typeof cause);
    return null;
  }
}

// 保存した案を今のルールで検査し直す。通らない案は見せない。
function reviewSaved(input: PlanInput, advice: AdviseResponse): AdviseResponse | null {
  if (advice.status === "needs_staff") return advice;
  const plan = advice.plan.map(({ course, term }) => ({ course, term }));
  const reviewed = reviewPlan(input, plan, advice.draft, advice.iterations, advice.corrections);
  if (!reviewed) return null;
  return advice.recording ? { ...reviewed, recording: advice.recording } : reviewed;
}

// 同じ学生と同じ回答の記録を、今のルールで検査を通るときだけ返す。
export function findRecordedAdvice(sourceId: string, input: PlanInput) {
  const file = recordedModules[`../../data/fictional/${sourceId}/recorded-advice.json`];
  const found = file?.records.find(
    ({ studentId, answers }) =>
      studentId === input.student.id &&
      answers.some((candidate) => answersKey(candidate) === answersKey(input.answers)),
  );
  if (!file || !found) return null;
  const advice = adviseResponseSchema.parse({ ...(found.advice as object), recording: file.recording });
  return reviewSaved(input, advice);
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

  const reviewed = reviewSaved(input, adviseResponseSchema.parse(JSON.parse(row.advice)));
  return reviewed ? { advice: reviewed, recordedAt: row.created_at } : NOTHING;
}
