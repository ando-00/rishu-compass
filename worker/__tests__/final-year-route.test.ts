import { describe, expect, it } from "vitest";
import { overviewResponseSchema } from "../../shared/api";
import { exampleRules } from "../../data/fictional/example/rules";
import { exampleStudents } from "../../data/fictional/example/students";
import app from "../index";

async function overview(answers: Record<string, string>) {
  const res = await app.request("/api/datasets/example/overview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
  });
  expect(res.status).toBe(200);
  return overviewResponseSchema.parse(await res.json());
}

describe("overview の最終年次の内訳（B33）", () => {
  it("最終年次の人数が、学生の一覧で minYears 以上の年次の人数と一致する", async () => {
    const result = await overview({});
    const expected = exampleStudents.filter((s) => s.studentYear >= exampleRules.graduation.minYears).length;
    expect(result.finalYear.studentCount).toBe(expected);
    expect(result.finalYear.minYears).toBe(exampleRules.graduation.minYears);
  });

  it("どの行も、5状態の人数と当てはまらない人数の合計が最終年次の人数になる", async () => {
    const result = await overview({});
    for (const row of result.finalYear.rows) {
      const sum = Object.values(row.counts).reduce((a, b) => a + b, 0) + row.notApplicable;
      expect(sum).toBe(result.finalYear.studentCount);
    }
  });

  it("学生 ID を含まない（人数だけを返す）", async () => {
    const result = await overview({});
    const text = JSON.stringify(result.finalYear);
    for (const student of exampleStudents) expect(text).not.toContain(student.id);
  });
});
