import { describe, expect, it } from "vitest";
import { overviewResponseSchema } from "../../shared/api";
import { goldRules } from "../../data/fictional/kamome/gold-rules";
import app from "../index";

async function kamome(answers: Record<string, string>) {
  const res = await app.request("/api/datasets/kamome/overview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
  });
  expect(res.status).toBe(200);
  return overviewResponseSchema.parse(await res.json());
}

const unreflectable = goldRules.ambiguities.filter(({ options }) => options.every(({ patches }) => patches === null));

describe("判定に反映できない回答", () => {
  it("回答しても、止まったままの学生を職員確認の一覧から外さない", async () => {
    const before = await kamome({});
    expect(unreflectable.length).toBeGreaterThan(0);
    for (const ambiguity of unreflectable) {
      const after = await kamome({ [ambiguity.id]: ambiguity.options[0]!.id });
      expect(after.summary).toEqual(before.summary);
    }
  });

  it("すべて回答しても一覧は変わらない", async () => {
    const before = await kamome({});
    const answers = Object.fromEntries(unreflectable.map(({ id, options }) => [id, options[0]!.id]));
    const after = await kamome(answers);
    expect(after.summary).toEqual(before.summary);
  });
});
