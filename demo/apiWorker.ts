import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import app from "../worker/index";
import { createBrowserD1 } from "./d1";
import type { DemoRequest, DemoResponse } from "./protocol";

// 公開デモの API。手元で動かす版と同じ Hono のアプリを、ブラウザの Web Worker で動かす。
// DB はこのタブのメモリの中だけにあるので、訪問者の間で混ざらず、再読み込みで最初に戻る。
// API キーを渡さないので、Claude を呼ぶ経路は動かない。
const migrations = import.meta.glob<string>("../migrations/*.sql", { query: "?raw", import: "default", eager: true });

const env = initSqlJs({ locateFile: () => wasmUrl }).then((SQL) => {
  const sqlite = new SQL.Database();
  for (const name of Object.keys(migrations).sort()) sqlite.exec(migrations[name]!);
  return { DB: createBrowserD1(sqlite) };
});

const scope = globalThis as unknown as {
  onmessage: (event: { data: DemoRequest }) => void;
  postMessage: (message: DemoResponse) => void;
};

scope.onmessage = async ({ data: { id, url, method, headers, body } }) => {
  try {
    const response = await app.fetch(new Request(url, { method, headers, body }), (await env) as Env);
    scope.postMessage({ id, status: response.status, headers: [...response.headers], body: await response.text() });
  } catch (cause) {
    console.error("公開デモの API で失敗しました", cause instanceof Error ? cause.message : "");
    scope.postMessage({
      id,
      status: 500,
      headers: [["content-type", "application/json"]],
      body: JSON.stringify({ error: "公開デモの処理に失敗しました。再読み込みしてください。" }),
    });
  }
};
