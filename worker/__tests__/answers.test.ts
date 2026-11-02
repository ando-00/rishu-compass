import { beforeEach, describe, expect, it } from "vitest";
import { answerRecordsResponseSchema, overviewResponseSchema } from "../../shared/api";
import app from "../index";
import { createTestDb } from "./testDb";

const PATH = "/api/datasets/example/answers";
const ID = "ambiguity-seminar-credits";

let test: ReturnType<typeof createTestDb>;

beforeEach(() => {
  test = createTestDb();
});

function request(path: string, init?: RequestInit, env: object = { DB: test.db }) {
  return app.request(path, init, env);
}

function post(body: unknown, env?: object, path = PATH) {
  return request(
    path,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
  );
}

async function records(path = PATH) {
  const res = await request(path);
  expect(res.status).toBe(200);
  return answerRecordsResponseSchema.parse(await res.json()).records;
}

function rowCount() {
  return (test.sqlite.prepare("SELECT COUNT(*) AS n FROM ambiguity_answers").get() as { n: number }).n;
}

const answer = { ambiguityId: ID, optionId: "exclude", respondent: "教務職員A" };

describe("回答の記録", () => {
  it("回答がなければ空を返す", async () => {
    expect(await records()).toEqual([]);
  });

  it("回答を回答者と日時つきで残す", async () => {
    const before = Date.now();
    const res = await post(answer);
    expect(res.status).toBe(200);
    const [record] = await records();
    expect(record).toMatchObject(answer);
    expect(Date.parse(record!.answeredAt)).toBeGreaterThanOrEqual(before);
  });

  it("保存の応答で今の回答を返す", async () => {
    const res = await post(answer);
    const { records: saved } = answerRecordsResponseSchema.parse(await res.json());
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject(answer);
  });

  it("回答し直すと最新を返し、前の回答も記録に残す", async () => {
    await post(answer);
    await post({ ...answer, optionId: "include", respondent: "教務職員B" });
    expect(await records()).toMatchObject([{ optionId: "include", respondent: "教務職員B" }]);
    expect(rowCount()).toBe(2);
  });

  it("取り消すと回答から外れ、取り消しも記録に残す", async () => {
    await post(answer);
    await post({ ...answer, optionId: null, respondent: "教務職員B" });
    expect(await records()).toEqual([]);
    expect(rowCount()).toBe(2);
    const last = test.sqlite
      .prepare("SELECT option_id, respondent FROM ambiguity_answers ORDER BY id DESC")
      .get();
    expect(last).toMatchObject({ option_id: null, respondent: "教務職員B" });
  });

  it("保存した回答を全学生の判定に使える", async () => {
    await post(answer);
    const saved = Object.fromEntries((await records()).map((r) => [r.ambiguityId, r.optionId]));
    const res = await post({ answers: saved }, undefined, "/api/datasets/example/overview");
    const { unanswered, answered } = overviewResponseSchema.parse(await res.json());
    expect(unanswered).toHaveLength(0);
    expect(answered).toMatchObject([{ ambiguityId: ID, optionId: "exclude" }]);
  });
});

describe("回答の検査", () => {
  it.each([
    ["役割名でない回答者", { ...answer, respondent: "山田太郎" }],
    ["回答者なし", { ambiguityId: ID, optionId: "exclude" }],
    ["ない曖昧箇所", { ...answer, ambiguityId: "unknown" }],
    ["ない選択肢", { ...answer, optionId: "unknown" }],
  ])("%sは保存しない", async (_, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(rowCount()).toBe(0);
  });

  it("ない曖昧箇所の取り消しは保存しない", async () => {
    const res = await post({ ...answer, ambiguityId: "unknown", optionId: null });
    expect(res.status).toBe(400);
    expect(rowCount()).toBe(0);
  });

  it("ないデータには保存しない", async () => {
    expect((await request("/api/datasets/unknown/answers")).status).toBe(404);
    expect((await post(answer, undefined, "/api/datasets/unknown/answers")).status).toBe(404);
    expect(rowCount()).toBe(0);
  });

  it("今のルールにない古い回答は返さない", async () => {
    const insert = test.sqlite.prepare(
      "INSERT INTO ambiguity_answers (dataset_id, ambiguity_id, option_id, respondent, answered_at) VALUES ('example', ?, ?, '教務職員A', '2026-11-02T00:00:00.000Z')",
    );
    insert.run("removed-ambiguity", "any");
    insert.run(ID, "removed-option");
    expect(await records()).toEqual([]);
  });

  it("別のデータの回答を混ぜない", async () => {
    test.sqlite
      .prepare(
        "INSERT INTO ambiguity_answers (dataset_id, ambiguity_id, option_id, respondent, answered_at) VALUES ('sakuradai', ?, 'exclude', '教務職員A', '2026-11-02T00:00:00.000Z')",
      )
      .run(ID);
    expect(await records()).toEqual([]);
  });
});

describe("記録できないとき", () => {
  it("DB がなければ失敗を返し、回答したことにしない", async () => {
    expect((await post(answer, {})).status).toBe(503);
    expect((await request(PATH, undefined, {})).status).toBe(503);
  });

  it("表がなければ失敗を返す", async () => {
    test.sqlite.exec("DROP TABLE ambiguity_answers");
    expect((await post(answer)).status).toBe(503);
  });
});
