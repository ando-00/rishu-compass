import type { Database, ParamsObject, SqlValue } from "sql.js";

// 公開デモで、Worker のコードが使う D1 の部分（prepare、bind、all、run）を
// ブラウザの中の SQLite で動かす。
export function createBrowserD1(sqlite: Database): D1Database {
  const execute = (query: string, params: SqlValue[]) => {
    const statement = sqlite.prepare(query);
    try {
      statement.bind(params);
      const results: ParamsObject[] = [];
      while (statement.step()) results.push(statement.getAsObject());
      return results;
    } finally {
      statement.free();
    }
  };
  const bound = (query: string, params: SqlValue[]) => ({
    all: async () => ({ results: execute(query, params), success: true }),
    run: async () => {
      execute(query, params);
      return { success: true };
    },
  });
  const db = {
    prepare: (query: string) => ({
      ...bound(query, []),
      bind: (...params: SqlValue[]) => bound(query, params),
    }),
  };
  return db as unknown as D1Database;
}
