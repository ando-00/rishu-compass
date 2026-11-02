/// <reference types="node" />
import { DatabaseSync } from "node:sqlite";

const migrations = import.meta.glob<string>("../../migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
});

// D1 のうち使う部分だけを SQLite で動かす。表は本物のマイグレーションから作る。
export function createTestDb() {
  const sqlite = new DatabaseSync(":memory:");
  for (const path of Object.keys(migrations).sort()) sqlite.exec(migrations[path]!);
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
