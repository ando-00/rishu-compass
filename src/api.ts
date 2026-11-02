import type { z } from "zod";
import { adviseResponseSchema } from "../shared/advise";
import {
  answerRecordsResponseSchema,
  datasetsResponseSchema,
  overviewResponseSchema,
  planCheckResponseSchema,
  proposalResponseSchema,
  sourcesResponseSchema,
  studentResponseSchema,
  type Answers,
  type PlanEntry,
  type Respondent,
} from "../shared/api";

async function readJson<T extends z.ZodType>(res: Response, schema: T): Promise<z.infer<T>> {
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const { error, problems } = (body ?? {}) as { error?: string; problems?: string[] };
    throw new Error([error ?? `通信に失敗しました（${res.status}）`, ...(problems ?? [])].join("\n"));
  }
  return schema.parse(body);
}

function post(path: string, body: unknown) {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function fetchDatasets() {
  return readJson(await fetch("/api/datasets"), datasetsResponseSchema);
}

export async function fetchSources() {
  return readJson(await fetch("/api/sources"), sourcesResponseSchema);
}

export async function extractProposal(sourceId: string, handbook: string) {
  const res = await post(`/api/sources/${sourceId}/extract`, { handbook });
  return readJson(res, proposalResponseSchema);
}

export async function fetchAnswerRecords(datasetId: string) {
  return readJson(await fetch(`/api/datasets/${datasetId}/answers`), answerRecordsResponseSchema);
}

export async function saveAnswer(
  datasetId: string,
  answer: { ambiguityId: string; optionId: string | null; respondent: Respondent },
) {
  const res = await post(`/api/datasets/${datasetId}/answers`, answer);
  return readJson(res, answerRecordsResponseSchema);
}

export async function fetchOverview(datasetId: string, answers: Answers) {
  const res = await post(`/api/datasets/${datasetId}/overview`, { answers });
  return readJson(res, overviewResponseSchema);
}

export async function fetchStudent(datasetId: string, studentId: string, answers: Answers) {
  const res = await post(`/api/datasets/${datasetId}/students/${studentId}`, { answers });
  return readJson(res, studentResponseSchema);
}

export async function adviseStudent(datasetId: string, studentId: string, answers: Answers) {
  const res = await post(`/api/datasets/${datasetId}/students/${studentId}/advise`, { answers });
  return readJson(res, adviseResponseSchema);
}

export async function checkPlan(
  datasetId: string,
  studentId: string,
  plan: PlanEntry[],
  answers: Answers,
) {
  const res = await post(`/api/datasets/${datasetId}/plan-check`, { studentId, plan, answers });
  return readJson(res, planCheckResponseSchema);
}
