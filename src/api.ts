import type { z } from "zod";
import { savedAdviceSchema } from "../shared/advise";
import {
  answerRecordsResponseSchema,
  confirmResponseSchema,
  coursesResponseSchema,
  datasetsResponseSchema,
  latestProposalResponseSchema,
  overviewResponseSchema,
  planCandidatesResponseSchema,
  planCheckResponseSchema,
  proposalResponseSchema,
  registrationCheckResponseSchema,
  sourcesResponseSchema,
  studentResponseSchema,
  versionCompareResponseSchema,
  type Answers,
  type PlanEntry,
  type Respondent,
} from "../shared/api";

// 通信の失敗を、英語の文のまま画面に出さない（追加の監査 R-14）
async function send(path: string, init?: RequestInit) {
  try {
    return await fetch(path, init);
  } catch {
    throw new Error("サーバーに接続できません。起動しているか確かめてください。");
  }
}

async function readJson<T extends z.ZodType>(res: Response, schema: T): Promise<z.infer<T>> {
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const { error, problems } = (body ?? {}) as { error?: string; problems?: string[] };
    throw new Error([error ?? `通信に失敗しました（${res.status}）`, ...(problems ?? [])].join("\n"));
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new Error("サーバーの応答の形が想定と違います。");
  return parsed.data;
}

function post(path: string, body: unknown) {
  return send(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function fetchDatasets() {
  return readJson(await send("/api/datasets"), datasetsResponseSchema);
}

export async function fetchCourses(datasetId: string) {
  return readJson(await send(`/api/datasets/${datasetId}/courses`), coursesResponseSchema);
}

export async function fetchLatestProposal(sourceId: string) {
  const res = await send(`/api/sources/${sourceId}/proposals/latest`);
  return readJson(res, latestProposalResponseSchema);
}

export async function confirmProposal(
  proposalId: number,
  body: { respondent: Respondent; acceptedRuleIds: string[] },
) {
  const res = await post(`/api/proposals/${proposalId}/confirm`, body);
  return readJson(res, confirmResponseSchema);
}

export async function withdrawProposal(proposalId: number, respondent: Respondent) {
  const res = await post(`/api/proposals/${proposalId}/withdraw`, { respondent });
  if (!res.ok) await readJson(res, confirmResponseSchema);
}

export async function fetchVersionCompare(proposalId: number) {
  return readJson(await send(`/api/proposals/${proposalId}/compare`), versionCompareResponseSchema);
}

export async function fetchSources() {
  return readJson(await send("/api/sources"), sourcesResponseSchema);
}

export async function extractProposal(sourceId: string, handbook: string) {
  const res = await post(`/api/sources/${sourceId}/extract`, { handbook });
  return readJson(res, proposalResponseSchema);
}

export async function loadRecordedProposal(sourceId: string) {
  const res = await post(`/api/sources/${sourceId}/proposals/recorded`, {});
  return readJson(res, proposalResponseSchema);
}

export async function fetchAnswerRecords(datasetId: string) {
  return readJson(await send(`/api/datasets/${datasetId}/answers`), answerRecordsResponseSchema);
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
  return readJson(res, savedAdviceSchema);
}

export async function loadRecordedAdvice(datasetId: string, studentId: string, answers: Answers) {
  const res = await post(`/api/datasets/${datasetId}/students/${studentId}/advice/recorded`, { answers });
  return readJson(res, savedAdviceSchema);
}

export async function fetchLatestAdvice(datasetId: string, studentId: string, answers: Answers) {
  const res = await post(`/api/datasets/${datasetId}/students/${studentId}/advice/latest`, { answers });
  return readJson(res, savedAdviceSchema);
}

export async function checkRegistrations(datasetId: string, answers: Answers) {
  const res = await post(`/api/datasets/${datasetId}/registration-check`, { answers });
  return readJson(res, registrationCheckResponseSchema);
}

export async function fetchPlanCandidates(datasetId: string, studentId: string, answers: Answers) {
  const res = await post(`/api/datasets/${datasetId}/plan-candidates`, { studentId, answers });
  return readJson(res, planCandidatesResponseSchema);
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
