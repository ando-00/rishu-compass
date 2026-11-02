import { describe, expect, it } from "vitest";
import {
  datasetsResponseSchema,
  overviewResponseSchema,
  planCheckResponseSchema,
  studentResponseSchema,
} from "../../shared/api";
import { exampleStudents } from "../../data/fictional/example/students";
import app from "../index";

const ID = "ambiguity-seminar-credits";

function post(path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function overview(answers: Record<string, string>) {
  const res = await post("/api/datasets/example/overview", { answers });
  expect(res.status).toBe(200);
  return overviewResponseSchema.parse(await res.json());
}

const normal = exampleStudents.find(
  (student) => student.specialStatuses.length === 0 && student.studentYear === 2,
)!;
const excluded = exampleStudents.find((student) => student.specialStatuses.length > 0)!;

describe("GET /api/datasets", () => {
  it("見本のデータを返す", async () => {
    const res = await app.request("/api/datasets");
    const { datasets } = datasetsResponseSchema.parse(await res.json());
    expect(datasets.find((dataset) => dataset.id === "example")).toMatchObject({ problems: [] });
  });
});

describe("POST /api/datasets/:id/overview", () => {
  it("未回答の曖昧箇所を返す", async () => {
    const result = await overview({});
    expect(result.unanswered.map((impact) => impact.ambiguityId)).toEqual([ID]);
    expect(result.answered).toEqual([]);
  });

  it("回答を全学生の判定に反映する", async () => {
    const before = await overview({});
    const after = await overview({ [ID]: "exclude" });
    expect(after.unanswered).toEqual([]);
    expect(after.answered[0]?.optionId).toBe("exclude");
    expect(after.summary.contact).toBeGreaterThan(0);
    expect(after.summary.staffReview).toBeLessThan(before.summary.staffReview);
    const { total, contact, staffReview, clear } = after.summary;
    expect(contact + staffReview + clear).toBe(total);
  });

  it("声かけ文は下書きとして返す", async () => {
    const result = await overview({ [ID]: "exclude" });
    const contact = result.outreach.filter((entry) => entry.kind === "contact");
    expect(contact.length).toBeGreaterThan(0);
    expect(contact.every((entry) => entry.draft?.includes("下書き"))).toBe(true);
  });

  it("職員確認の学生には声かけ文の下書きを作らない", async () => {
    const result = await overview({ [ID]: "exclude" });
    const review = result.outreach.filter((entry) => entry.kind === "staff_review");
    expect(review.length).toBeGreaterThan(0);
    expect(review.every((entry) => entry.draft === null)).toBe(true);
  });

  it("未回答でも結果が変わらない学生は、職員確認の一覧に入れない", async () => {
    const result = await overview({});
    expect(result.summary.staffReview).toBeLessThan(result.summary.total / 2);
  });

  it("候補ごとの人数を返す", async () => {
    const [impact] = (await overview({})).unanswered;
    expect(impact?.computable).toBe(true);
    expect(impact?.options.every((option) => option.counts !== null)).toBe(true);
  });

  it("存在しない回答は 400 を返す", async () => {
    const res = await post("/api/datasets/example/overview", { answers: { unknown: "x" } });
    expect(res.status).toBe(400);
  });

  it("形式の違う本文は 400 を返す", async () => {
    const res = await post("/api/datasets/example/overview", { answers: "x" });
    expect(res.status).toBe(400);
  });

  it("JSON でない本文は 400 を返す", async () => {
    const res = await app.request("/api/datasets/example/overview", {
      method: "POST",
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("存在しないデータは 404 を返す", async () => {
    const res = await post("/api/datasets/unknown/overview", { answers: {} });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/datasets/:id/students/:studentId", () => {
  it("学生の判定を返す", async () => {
    const res = await post(`/api/datasets/example/students/${normal.id}`, { answers: {} });
    const result = studentResponseSchema.parse(await res.json());
    expect(result.student.id).toBe(normal.id);
    expect(result.excludedReason).toBeNull();
    expect(result.judgments.length).toBeGreaterThan(0);
  });

  it("特別な状態の学生は全判定が職員確認になる", async () => {
    const res = await post(`/api/datasets/example/students/${excluded.id}`, {
      answers: { [ID]: "include" },
    });
    const result = studentResponseSchema.parse(await res.json());
    expect(result.excludedReason).not.toBeNull();
    expect(result.judgments.every((judgment) => judgment.status === "needs_staff")).toBe(true);
  });

  it("存在しない学生は 404 を返す", async () => {
    const res = await post("/api/datasets/example/students/unknown", { answers: {} });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/datasets/:id/plan-check", () => {
  async function check(studentId: string, plan: unknown[], answers = {}) {
    const res = await post("/api/datasets/example/plan-check", { studentId, plan, answers });
    expect(res.status).toBe(200);
    return planCheckResponseSchema.parse(await res.json());
  }

  it("検査に通った履修案だけを返す", async () => {
    const result = await check(normal.id, [{ course: "他01", term: "前期" }]);
    expect(result.status).toBe("passed");
    expect(result.plan).toEqual([{ course: "他01", term: "前期" }]);
  });

  it("検査に通らない履修案は返さない", async () => {
    const result = await check(normal.id, [{ course: "存在しない科目", term: "前期" }]);
    expect(result.status).toBe("failed");
    expect(result.plan).toBeNull();
  });

  it("職員確認の履修案は返さない", async () => {
    const result = await check(excluded.id, [{ course: "他01", term: "前期" }]);
    expect(result.status).toBe("needs_staff");
    expect(result.plan).toBeNull();
  });

  it("空の履修案は 400 を返す", async () => {
    const res = await post("/api/datasets/example/plan-check", {
      studentId: normal.id,
      plan: [],
      answers: {},
    });
    expect(res.status).toBe(400);
  });
});

describe("経路", () => {
  it("送信の経路がない", async () => {
    const res = await post("/api/datasets/example/send", {});
    expect(res.status).toBe(404);
  });
});
