import { describe, expect, it } from "vitest";
import { exampleStudents } from "../../data/fictional/example/students";
import { adviseResponseSchema } from "../../shared/advise";
import app from "../index";

const ANSWERS = { "ambiguity-seminar-credits": "include" };
const excluded = exampleStudents.find((student) => student.specialStatuses.length > 0)!;
const allowed = { ALLOW_CLAUDE: "true", ANTHROPIC_API_KEY: "test-key" };

function post(studentId: string, env: object, body: unknown = { answers: ANSWERS }) {
  return app.request(
    `/api/datasets/example/students/${studentId}/advise`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
  );
}

describe("履修案の経路", () => {
  it.each([
    ["鍵がない", { ALLOW_CLAUDE: "true" }],
    ["明示していない", { ANTHROPIC_API_KEY: "test-key" }],
    ["環境の値がない", {}],
  ])("%sと使えない", async (_, env) => {
    expect((await post(excluded.id, env)).status).toBe(403);
  });

  it("適用外の学生は Claude を呼ばず職員確認を返す", async () => {
    const res = await post(excluded.id, allowed);
    expect(res.status).toBe(200);
    expect(adviseResponseSchema.parse(await res.json())).toMatchObject({
      status: "needs_staff",
      iterations: 0,
    });
  });

  it("いない学生は 404 を返す", async () => {
    expect((await post("unknown", allowed)).status).toBe(404);
  });

  it("回答の形式が違えば 400 を返す", async () => {
    const res = await post(excluded.id, allowed, { answers: { unknown: "x" } });
    expect(res.status).toBe(400);
  });
});
