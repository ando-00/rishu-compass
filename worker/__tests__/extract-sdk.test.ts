// 本物の SDK を偽の fetch の上で動かし、失敗が種類どおりに返ることを確かめる。API は呼ばない。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClaudeModel } from "../rule-extraction/claude";
import { extractRules } from "../rule-extraction/extract";
import app from "../index";

const KEY = "test-key-should-not-leak";
const OPEN = { ALLOW_CLAUDE: "true", ANTHROPIC_API_KEY: KEY };

const VALID = JSON.stringify({
  rules: [
    {
      kind: "graduation",
      id: "graduation",
      clause: "第1条",
      sourceQuote: "第1条",
      status: "confirmed",
      when: [],
      ambiguityIds: [],
      detail: JSON.stringify({ minYears: 4, totalCredits: 124 }),
    },
  ],
  ambiguities: [],
  notes: [],
});

function sse(text: string | null, stopReason: string) {
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const events: [string, object][] = [
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage,
        },
      },
    ],
    ...(text === null
      ? []
      : ([
          ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
          [
            "content_block_delta",
            { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
          ],
          ["content_block_stop", { type: "content_block_stop", index: 0 }],
        ] as [string, object][])),
    [
      "message_delta",
      { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 1 } },
    ],
    ["message_stop", { type: "message_stop" }],
  ];
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

function streamResponse(body: string) {
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function postExtract() {
  return app.request(
    "/api/sources/sakuradai/extract",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handbook: "第1条" }) },
    OPEN,
  );
}

function fakeFetch(reply: (call: number) => Response | Promise<Response>) {
  let calls = 0;
  const fake = vi.fn(async () => reply(++calls));
  vi.stubGlobal("fetch", fake);
  return fake;
}

let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("要項の変換: 本物の SDK の失敗の形", () => {
  it("本物の SDK でも正しい応答は読める（比較の基準）", async () => {
    fakeFetch(() => streamResponse(sse(VALID, "end_turn")));
    const res = await postExtract();
    expect(res.status).toBe(200);
  });

  it.each([
    ["max_tokens で切れた JSON", '{"rules":[{"kind":"gradua', "max_tokens", 502, "途中で終わりました"],
    ["文章を返した refusal", "申し訳ありませんが対応できません", "refusal", 502, "断りました"],
    ["途中まで書いて refusal", '{"rules":[', "refusal", 502, "断りました"],
    ["JSON でない end_turn", "これは JSON ではありません", "end_turn", 502, "JSON"],
    ["スキーマに合わない end_turn", '{"rules":"x"}', "end_turn", 502, "形式"],
  ])("%s は失敗として種類どおりに返す", async (_name, text, stopReason, status, message) => {
    fakeFetch(() => streamResponse(sse(text, stopReason)));
    const res = await postExtract();
    const body = await res.text();
    expect({ status: res.status, body }).toMatchObject({ status, body: expect.stringContaining(message) });
  });

  it("本文のない refusal は「断りました」で返す（比較の基準）", async () => {
    fakeFetch(() => streamResponse(sse(null, "refusal")));
    const res = await postExtract();
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("断りました");
  });

  it("3回のうち1回だけ切れても、残り2回で案を返す", async () => {
    fakeFetch((call) =>
      streamResponse(call === 1 ? sse('{"rules":[', "max_tokens") : sse(VALID, "end_turn")),
    );
    const res = await postExtract();
    expect(res.status).toBe(200);
  });

  it("切れた応答の本文をログへ残さない", async () => {
    fakeFetch(() => streamResponse(sse("学生S0007の秘密の本文です", "end_turn")));
    await postExtract();
    const logged = errors.mock.calls.flat().map(String).join("\n");
    expect(logged).not.toContain("S0007");
    expect(logged).not.toContain("学生");
  });

  it("途中で別のモデルへ引き継いだ成功の応答は読める", async () => {
    // fallback の前は断ったモデルの途中の本文で、応答は引き継いだモデルの全文になる。
    const usage = { input_tokens: 1, output_tokens: 1 };
    const events: [string, object][] = [
      ["message_start", { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage } }],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "途中まで" } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ["content_block_start", { type: "content_block_start", index: 1, content_block: { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-5" } } }],
      ["content_block_stop", { type: "content_block_stop", index: 1 }],
      ["content_block_start", { type: "content_block_start", index: 2, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: VALID } }],
      ["content_block_stop", { type: "content_block_stop", index: 2 }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }],
      ["message_stop", { type: "message_stop" }],
    ];
    const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
    fakeFetch(() => streamResponse(body));
    expect((await postExtract()).status).toBe(200);
  });

});

describe("要項の変換: HTTP の失敗", () => {
  it("429 は 429 で返す", async () => {
    fakeFetch(
      () =>
        new Response(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow" } }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after-ms": "1" },
        }),
    );
    const res = await postExtract();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: expect.stringContaining("上限") });
  });

  it("529 と 500 は 502 で返す", async () => {
    fakeFetch(
      () =>
        new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "busy" } }), {
          status: 529,
          headers: { "content-type": "application/json", "retry-after-ms": "1" },
        }),
    );
    expect((await postExtract()).status).toBe(502);
  });

  it("401 の応答に鍵が混ざらない", async () => {
    fakeFetch(
      () =>
        new Response(
          JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }),
          { status: 401, headers: { "content-type": "application/json" } },
        ),
    );
    const res = await postExtract();
    const body = await res.text();
    expect(res.status).toBe(502);
    expect(body).not.toContain(KEY);
    expect(errors.mock.calls.flat().map(String).join("\n")).not.toContain(KEY);
  });

  it("ストリームの途中の error イベントは 502 で返す", async () => {
    const body =
      `event: message_start\ndata: ${JSON.stringify({
        type: "message_start",
        message: {
          id: "m",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      })}\n\n` +
      `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "busy" } })}\n\n`;
    fakeFetch(() => streamResponse(body));
    expect((await postExtract()).status).toBe(502);
  });

  it("接続の失敗は 502 で返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    vi.useFakeTimers();
    const pending = postExtract();
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await pending).status).toBe(502);
  });

  it("応答が来ないと 504 で返す", async () => {
    // fetch が signal で止まるまで待つ、本物と同じ振る舞いの偽物。
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: unknown, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            );
          }),
      ),
    );
    vi.useFakeTimers();
    const pending = postExtract();
    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
    expect((await pending).status).toBe(504);
  });

});
