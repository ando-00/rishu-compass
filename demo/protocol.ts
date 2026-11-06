// 公開デモの画面と、ブラウザの中で動く API の間のやり取り。
export type DemoRequest = { id: number; url: string; method: string; headers: [string, string][]; body: string | null };
export type DemoResponse = { id: number; status: number; headers: [string, string][]; body: string };
