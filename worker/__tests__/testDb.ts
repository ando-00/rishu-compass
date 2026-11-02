/// <reference types="node" />
import { DatabaseSync } from "node:sqlite";
import migration from "../../migrations/0001_ambiguity_answers.sql?raw";

// D1 のうち使う部分だけを SQLite で動かす。表は本物のマイグレーションから作る。
export function createTestDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(migration);
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
