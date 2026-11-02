/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { URL } from "node:url";

// import.meta.glob の一覧は Vitest のキャッシュに残り、足したマイグレーションが見えないので、毎回読む。
const MIGRATIONS = new URL("../../migrations/", import.meta.url);

// D1 のうち使う部分だけを SQLite で動かす。表は本物のマイグレーションから作る。
export function createTestDb() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of readdirSync(MIGRATIONS).sort()) {
    sqlite.exec(readFileSync(new URL(name, MIGRATIONS), "utf8"));
  }
  const bound = (query: string, params: (string | null)[]) => ({
    all: async () => ({ results: sqlite.prepare(query).all(...params) }),
    run: async () => {
      sqlite.prepare(query).run(...params);
      return { success: true };
    },
  });
  const db = {
    prepare: (query: string) => ({
      ...bound(query, []),
      bind: (...params: (string | null)[]) => bound(query, params),
    }),
  };
  return { db: db as unknown as D1Database, sqlite };
}
