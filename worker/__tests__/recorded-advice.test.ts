import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import recordedText from "../../data/fictional/sakuradai/recorded-advice.json?raw";
import { sakuradaiCourses } from "../../data/fictional/sakuradai/courses";
import { goldRules } from "../../data/fictional/sakuradai/gold-rules";
import { sakuradaiStudents } from "../../data/fictional/sakuradai/students";
import type { Answers } from "../../engine";
import { savedAdviceSchema, type AdviseResponse } from "../../shared/advise";
import { confirmResponseSchema, proposalResponseSchema } from "../../shared/api";
import { reviewPlan } from "../advisor/advise";
import { findRecordedAdvice } from "../advisor/records";
import app from "../index";
import { createTestDb } from "./testDb";

type Recorded = {
  recording: { model: string; recordedAt: string };
  records: { studentId: string; answers: Answers[]; advice: Extract<AdviseResponse, { status: "passed" }> }[];
};

const recorded = JSON.parse(recordedText) as Recorded;
const [record] = recorded.records;
const { studentId } = record!;
const [answers, proposalAnswers] = record!.answers as [Answers, Answers];
const student = sakuradaiStudents.find(({ id }) => id === studentId)!;
const unrecorded = sakuradaiStudents.find(({ id }) => !recorded.records.some((item) => item.studentId === id))!;

let env: { DB: D1Database };

function post(path: string, body: object) {
  return app.request(
    path,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
  );
}

const latest = async (datasetId: string, id: string, requested: object) =>
  savedAdviceSchema.parse(
    await (await post(`/api/datasets/${datasetId}/students/${id}/advice/latest`, { answers: requested })).json(),
  );

const load = (datasetId: string, id: string, requested: object) =>
  post(`/api/datasets/${datasetId}/students/${id}/advice/recorded`, { answers: requested });

beforeEach(() => {
  env = { DB: createTestDb().db };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("履修案の記録", () => {
  it("記録の案はすべて検査を通り、学生を一度しか使わない", () => {
    expect(recorded.records.length).toBeGreaterThan(0);
    expect(new Set(recorded.records.map((item) => item.studentId)).size).toBe(recorded.records.length);
    for (const item of recorded.records) {
      const target = sakuradaiStudents.find(({ id }) => id === item.studentId)!;
      const input = { rules: goldRules, courses: sakuradaiCourses, student: target, answers: item.answers[0]! };
      const plan = item.advice.plan.map(({ course, term }) => ({ course, term }));
      expect(reviewPlan(input, plan, item.advice.draft, 0, [])).not.toBeNull();
      expect(item.advice.draft).toContain("下書き");
      expect(JSON.stringify(item.advice.corrections)).not.toContain("\\\\u");
    }
  });

  it("同じ学生と同じ回答のときだけ、読み込めると知らせる", async () => {
    expect((await latest("sakuradai", studentId, answers)).recordingAvailable).toBe(true);
    expect((await latest("sakuradai", studentId, {})).recordingAvailable).toBeUndefined();
    expect((await latest("sakuradai", unrecorded.id, answers)).recordingAvailable).toBeUndefined();
  });

  it("記録にない曖昧箇所にも答えると、前提が違うので記録を出さない", async () => {
    const other = goldRules.ambiguities.find(({ id }) => !(id in answers))!;
    const both = { ...answers, [other.id]: other.options[0]!.id };
    expect((await latest("sakuradai", studentId, both)).recordingAvailable).toBeUndefined();
    expect((await load("sakuradai", studentId, both)).status).toBe(404);
  });

  it("履修案を作れない環境の案内のとおりに答えると、記録を読み込める（P3-18）", async () => {
    const response = await post(`/api/datasets/sakuradai/students/${unrecorded.id}/advise`, { answers: {} });
    expect(response.status).toBe(403);
    const { error } = (await response.json()) as { error: string };
    for (const part of ["さくら台大学", "第6条だけに", "単位だけを数える", "S0095", "「記録を読み込む」"]) {
      expect(error).toContain(part);
    }
    const sixth = goldRules.ambiguities.find(({ clause }) => clause === "第6条")!;
    const option = sixth.options.find(({ label }) => label.includes("単位だけを数える"))!;
    expect((await latest("sakuradai", "S0095", { [sixth.id]: option.id })).recordingAvailable).toBe(true);
  });

  it("API キーなしで読み込み、Claude を呼ばずに記録する", async () => {
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);

    const res = await load("sakuradai", studentId, answers);
    expect(res.status).toBe(200);
    const saved = savedAdviceSchema.parse(await res.json());
    expect(saved.advice).toMatchObject({ status: "passed", recording: { model: recorded.recording.model } });
    expect(fetchStub).not.toHaveBeenCalled();

    // 開き直しても、記録を読み込んだ案だと分かる
    expect((await latest("sakuradai", studentId, answers)).advice).toMatchObject({
      recording: { recordedAt: recorded.recording.recordedAt },
    });
  });

  it("記録のルール案を確定した対象でも読み込める", async () => {
    const proposal = proposalResponseSchema.parse(
      await (await post("/api/sources/sakuradai/proposals/recorded", {})).json(),
    );
    const confirmed = await post(`/api/proposals/${proposal.proposalId}/confirm`, {
      respondent: "教務職員A",
      acceptedRuleIds: [],
    });
    const { datasetId } = confirmResponseSchema.parse(await confirmed.json());

    for (const item of recorded.records) {
      expect((await load(datasetId, item.studentId, proposalAnswers)).status).toBe(200);
    }
  });

  it("記録がなければ 404 を返す", async () => {
    expect((await load("sakuradai", unrecorded.id, answers)).status).toBe(404);
    expect((await load("sakuradai", studentId, {})).status).toBe(404);
  });

  it("今のルールで検査を通らない記録は見せない", () => {
    const planned = new Set(record!.advice.plan.map(({ course }) => course));
    const courses = sakuradaiCourses.filter(({ name }) => !planned.has(name));
    expect(findRecordedAdvice("sakuradai", { rules: goldRules, courses, student, answers })).toBeNull();
  });
});
