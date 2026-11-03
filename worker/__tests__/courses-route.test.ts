import { describe, expect, it } from "vitest";
import { exampleCourses } from "../../data/fictional/example/courses";
import { coursesResponseSchema } from "../../shared/api";
import app from "../index";

describe("GET /api/datasets/:id/courses（履修案の検査の候補。B32）", () => {
  it("対象の大学の科目データの名前、単位、配当年次、開講学期を返す", async () => {
    const res = await app.request("/api/datasets/example/courses");
    expect(res.status).toBe(200);
    const body = coursesResponseSchema.parse(await res.json());
    expect(body.courses.map((course) => course.name)).toEqual(exampleCourses.map((course) => course.name));
    const [first] = body.courses;
    const source = exampleCourses[0]!;
    expect(first).toEqual({
      name: source.name,
      credits: source.credits,
      assignedYear: source.assignedYear,
      ...(source.offeredIn ? { offeredIn: source.offeredIn } : {}),
    });
  });

  it("開講学期の指定がある科目には、その学期を添える", async () => {
    const res = await app.request("/api/datasets/example/courses");
    const body = coursesResponseSchema.parse(await res.json());
    const withTerm = exampleCourses.filter((course) => course.offeredIn);
    expect(withTerm.length).toBeGreaterThan(0);
    for (const source of withTerm) {
      expect(body.courses.find((course) => course.name === source.name)?.offeredIn).toBe(source.offeredIn);
    }
  });

  it("ない対象は 404", async () => {
    const res = await app.request("/api/datasets/none/courses");
    expect(res.status).toBe(404);
  });
});
