/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { URL } from "node:url";
import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { goldRules } from "../../data/fictional/sakuradai/gold-rules";
import app from "../../worker/index";
import { createBrowserD1 } from "../d1";

const MIGRATIONS = new URL("../../migrations/", import.meta.url);

async function demoEnv() {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  for (const name of readdirSync(MIGRATIONS).sort()) sqlite.exec(readFileSync(new URL(name, MIGRATIONS), "utf8"));
  return { DB: createBrowserD1(sqlite) } as unknown as Env;
}

const post = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const firstAnswer = () => {
  const ambiguity = goldRules.ambiguities[0]!;
  return { ambiguityId: ambiguity.id, optionId: ambiguity.options[0]!.id, respondent: "教務職員A" };
};

describe("公開デモのブラウザの DB", () => {
  it("回答を記録して読み直せる。取り消しも D1 と同じように最新の行で決まる", async () => {
    const env = await demoEnv();
    const answer = firstAnswer();
    expect((await app.request("/api/datasets/sakuradai/answers", post(answer), env)).status).toBe(200);
    const saved = (await (await app.request("/api/datasets/sakuradai/answers", {}, env)).json()) as { records: unknown[] };
    expect(saved.records).toHaveLength(1);
    await app.request("/api/datasets/sakuradai/answers", post({ ...answer, optionId: null }), env);
    const cleared = (await (await app.request("/api/datasets/sakuradai/answers", {}, env)).json()) as {
      records: unknown[];
      history: unknown[];
    };
    expect(cleared.records).toHaveLength(0);
    expect(cleared.history).toHaveLength(2);
  });

  it("RETURNING を使うルール案の保存で番号が返り、次の案は別の番号になる", async () => {
    const env = await demoEnv();
    const load = async () => {
      const res = await app.request("/api/sources/sakuradai/proposals/recorded", post({}), env);
      expect(res.status).toBe(200);
      return ((await res.json()) as { proposalId: number }).proposalId;
    };
    const first = await load();
    expect(first).toBeGreaterThan(0);
    expect(await load()).toBe(first + 1);
  });

  it("DB はタブごとに別なので、1人の回答が別の人に見えない", async () => {
    const [mine, other] = [await demoEnv(), await demoEnv()];
    await app.request("/api/datasets/sakuradai/answers", post(firstAnswer()), mine);
    const seen = (await (await app.request("/api/datasets/sakuradai/answers", {}, other)).json()) as { records: unknown[] };
    expect(seen.records).toHaveLength(0);
  });

  it("API キーを渡さないので、Claude を呼ぶ経路は動かない", async () => {
    const res = await app.request("/api/sources/sakuradai/extract", post({}), await demoEnv());
    expect(res.status).toBe(403);
  });
});
