// 追加の監査 R-14。通信と形の失敗を、英語や JSON の文のまま画面に出さない。
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDatasets } from "../api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API の失敗の文", () => {
  it("サーバーに届かないときは日本語で示す", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(fetchDatasets()).rejects.toThrow("サーバーに接続できません");
  });

  it("応答の形が違うときは日本語で示し、検証の詳細を出さない", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ datasets: "x" }), { status: 200 }));
    const failure = await fetchDatasets().catch((cause: unknown) => cause as Error);
    expect((failure as Error).message).toContain("応答の形");
    expect((failure as Error).message).not.toContain("expected");
  });

  it("200 でも JSON でない応答は同じ文にする", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>", { status: 200 }));
    await expect(fetchDatasets()).rejects.toThrow("応答の形");
  });

  it("サーバーが返した理由はそのまま示す", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "ルールに問題があります", problems: ["甲"] }), { status: 422 }));
    await expect(fetchDatasets()).rejects.toThrow("ルールに問題があります\n甲");
  });
});
