import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_HANDBOOK_LENGTH, proposalResponseSchema, sourcesResponseSchema } from "../../shared/api";
import { createClaudeModel } from "../rule-extraction/claude";
import app from "../index";

vi.mock("../rule-extraction/claude", () => ({ createClaudeModel: vi.fn() }));

const OPEN = { ALLOW_CLAUDE: "true", ANTHROPIC_API_KEY: "test-key" };

const USAGE = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };

function postExtract(id: string, body: unknown, env?: Record<string, string>) {
  return app.request(
    `/api/sources/${id}/extract`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
  );
}

function mockReply(reply: Partial<Awaited<ReturnType<ReturnType<typeof createClaudeModel>>>>) {
  vi.mocked(createClaudeModel).mockReturnValue(
    vi.fn().mockResolvedValue({ stopReason: "end_turn", text: "", model: "fake", usage: USAGE, ...reply }),
  );
}

beforeEach(() => {
  vi.mocked(createClaudeModel).mockReset();
});

describe("GET /api/sources", () => {
  it("開けていない環境では変換を使えないと返す", async () => {
    const res = await app.request("/api/sources");
    const body = sourcesResponseSchema.parse(await res.json());
    expect(body.extractionEnabled).toBe(false);
    expect(body.sources.map(({ id }) => id)).toEqual(["sakuradai", "kamome"]);
  });

  it("開けた環境では変換を使えると返す", async () => {
    const res = await app.request("/api/sources", undefined, OPEN);
    expect(sourcesResponseSchema.parse(await res.json()).extractionEnabled).toBe(true);
  });
});

describe("POST /api/sources/:id/extract", () => {
  it.each([
    ["設定がない", undefined],
    ["鍵だけある", { ANTHROPIC_API_KEY: "test-key" }],
    ["許可だけある", { ALLOW_CLAUDE: "true" }],
    ["許可の値が違う", { ALLOW_CLAUDE: "1", ANTHROPIC_API_KEY: "test-key" }],
  ])("%s環境では Claude を呼ばない", async (_name, env) => {
    const res = await postExtract("sakuradai", { handbook: "第1条" }, env);
    expect(res.status).toBe(403);
    expect(createClaudeModel).not.toHaveBeenCalled();
  });

  it("存在しない大学は 404 を返す", async () => {
    for (const id of ["unknown", "constructor"]) {
      expect((await postExtract(id, { handbook: "第1条" }, OPEN)).status).toBe(404);
    }
    expect(createClaudeModel).not.toHaveBeenCalled();
  });

  it("空の要項と長すぎる要項は呼ばずに拒む", async () => {
    for (const handbook of ["   ", "あ".repeat(MAX_HANDBOOK_LENGTH + 1)]) {
      expect((await postExtract("sakuradai", { handbook }, OPEN)).status).toBe(400);
    }
    expect(createClaudeModel).not.toHaveBeenCalled();
  });

  it("失敗は内容を推測せずに失敗として返す", async () => {
    mockReply({ stopReason: "max_tokens" });
    const res = await postExtract("sakuradai", { handbook: "第1条" }, OPEN);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: expect.stringContaining("途中で終わりました") });
  });

  it("問題が残る案は影響人数を計算せず、問題を返す", async () => {
    const quote = "ない文";
    const base = { clause: "第1条", sourceQuote: quote, status: "confirmed", when: [], ambiguityIds: [] };
    const output = {
      graduation: { ...base, id: "graduation", minYears: 4, totalCredits: 124 },
      categories: [],
      gates: [],
      loadLimits: [],
      courseCountLimits: [],
      prerequisites: [],
      enrollment: null,
      ambiguities: [],
      notes: [],
    };
    mockReply({ text: JSON.stringify(output) });
    const res = await postExtract("sakuradai", { handbook: "第1条" }, OPEN);
    expect(res.status).toBe(200);
    const body = proposalResponseSchema.parse(await res.json());
    expect(body.impacts).toBeNull();
    expect(body.problems.length).toBeGreaterThan(0);
    expect(body.attempts).toHaveLength(4);
  });
});
