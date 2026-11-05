import { describe, expect, it } from "vitest";
import { sakuradaiCourses } from "../../data/fictional/sakuradai/courses";
import { goldRules } from "../../data/fictional/sakuradai/gold-rules";
import { sakuradaiStudents } from "../../data/fictional/sakuradai/students";
import { checkPlan } from "../../engine";
import { planCandidatesResponseSchema } from "../../shared/api";
import { planningTarget } from "../advisor/tools";
import app from "../index";

// B41: 履修案の検査の候補から外す科目。2026-11-03 の通しで、S0095 の候補に修得済みの英語Ⅰが出た
const student = sakuradaiStudents.find(({ id }) => id === "S0095")!;

async function candidates(body: object, dataset = "sakuradai") {
  return app.request(`/api/datasets/${dataset}/plan-candidates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/datasets/:id/plan-candidates（候補から外す科目。B41）", () => {
  it("S0095 の修得済みの英語Ⅰを外す", async () => {
    const res = await candidates({ studentId: student.id, answers: {} });
    expect(res.status).toBe(200);
    const body = planCandidatesResponseSchema.parse(await res.json());
    expect(body.unavailable).toContainEqual({ course: "英語Ⅰ", message: "英語Ⅰ は修得済みです。" });
  });

  it("履修案の検査と同じ前提（後期の学生は履修中を修得した前提）で外す", async () => {
    const res = await candidates({ studentId: student.id, answers: {} });
    const body = planCandidatesResponseSchema.parse(await res.json());
    const input = { rules: goldRules, courses: sakuradaiCourses, student, answers: {} };
    const { target, assumptions } = planningTarget(input);
    for (const { name, offeredIn } of sakuradaiCourses) {
      const plan = [{ course: name, term: offeredIn ?? ("前期" as const) }];
      const { issues } = checkPlan(goldRules, sakuradaiCourses, target, plan, {}, assumptions);
      const blocked = issues.some(
        ({ code, course }) => course === name && (code === "ALREADY_EARNED" || code === "DISQUALIFIED_RETAKE"),
      );
      expect(blocked, name).toBe(body.unavailable.some(({ course }) => course === name));
    }
  });

  it("修得していない科目は外さない", async () => {
    const res = await candidates({ studentId: student.id, answers: {} });
    const body = planCandidatesResponseSchema.parse(await res.json());
    const earned = new Set(student.records.map(({ course }) => course));
    const fresh = sakuradaiCourses.filter(({ name }) => !earned.has(name));
    expect(fresh.length).toBeGreaterThan(0);
    for (const { name } of fresh) expect(body.unavailable.map(({ course }) => course)).not.toContain(name);
  });

  it("いない学生は 404、ない対象は 404、形式の違う本文は 400", async () => {
    expect((await candidates({ studentId: "S9999", answers: {} })).status).toBe(404);
    expect((await candidates({ studentId: student.id, answers: {} }, "none")).status).toBe(404);
    expect((await candidates({ answers: {} })).status).toBe(400);
  });
});
