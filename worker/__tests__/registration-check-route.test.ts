import { describe, expect, it } from "vitest";
import { exampleCourses } from "../../data/fictional/example/courses";
import { exampleRules } from "../../data/fictional/example/rules";
import { exampleStudents } from "../../data/fictional/example/students";
import { checkCurrentRegistrations } from "../../engine";
import { registrationCheckResponseSchema } from "../../shared/api";
import app from "../index";

const answers = { "ambiguity-seminar-credits": "include" };

function post(path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/datasets/:id/registration-check（今期の登録をまとめて検査。H25 の J。B40）", () => {
  it("今年度の履修中がある学生を検査し、通らなかった学生だけを返す", async () => {
    const res = await post("/api/datasets/example/registration-check", { answers });
    expect(res.status).toBe(200);
    const body = registrationCheckResponseSchema.parse(await res.json());

    const expected = exampleStudents.flatMap((student) => {
      const result = checkCurrentRegistrations(exampleRules, exampleCourses, student, answers);
      return result ? [{ student, ...result }] : [];
    });
    expect(body.checked).toBe(expected.length);
    expect(body.results.map(({ studentId }) => studentId)).toEqual(
      expected.filter(({ check }) => check.status !== "passed").map(({ student }) => student.id),
    );
    for (const result of body.results) expect(result.issues.length).toBeGreaterThan(0);
  });

  it("回答の形式が正しくなければ 400、ない対象は 404", async () => {
    expect((await post("/api/datasets/example/registration-check", { answers: { none: "x" } })).status).toBe(400);
    expect((await post("/api/datasets/none/registration-check", { answers: {} })).status).toBe(404);
  });
});
