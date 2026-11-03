#!/usr/bin/env node
// Claude Code の Stop フック。作業を終える前に速い機械検査（scripts/audit.mjs）を回し、
// FAIL があれば終了を止めて、直すように Claude へ返す。
//
// - 前回通った時点から HEAD とコードの差分が変わっていなければ回さない（何もしていない周で待たせない）
// - 同じセッションで止めるのは3回まで。それでも直らなければ、止めずに人へ知らせる
// - 鍵の検出（K で始まる検査）は Claude に直させない。履歴を書き換えないので人が判断する
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
// VS Code は c:\ と小文字で渡すことがある。小文字のまま vitest を動かすと全テストが落ちるので大文字にそろえる
const root = (process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()).replace(/^[a-z]:/, (drive) => drive.toUpperCase());
const stateDir = join(root, "evals/tmp/audit");
const statePath = join(stateDir, "stop-hook.json");
const MAX_BLOCKS = 3;

const git = (args) => spawnSync("git", args, { cwd: root, encoding: "utf8" }).stdout ?? "";
const CODE = ["engine", "shared", "worker", "src", "evals", "scripts", "migrations", "data", ".claude", ".githooks", ".github",
  "package.json", "package-lock.json", "vitest.config.ts", "vite.config.ts", "wrangler.jsonc", "index.html"];
const fingerprint = createHash("sha256")
  .update(git(["rev-parse", "HEAD"]))
  .update(git(["diff", "HEAD", "--", ...CODE, ":!evals/tmp", ":!evals/results"]))
  .update(git(["ls-files", "--others", "--exclude-standard", "--", ...CODE]))
  .digest("hex");

let state = {};
try {
  state = JSON.parse(readFileSync(statePath, "utf8"));
} catch {
  state = {};
}
const save = () => {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
};

if (state.passed === fingerprint) process.exit(0);

const result = spawnSync(process.execPath, [join(root, "scripts/audit.mjs")], {
  cwd: root,
  encoding: "utf8",
  timeout: 9 * 60 * 1000,
  maxBuffer: 64 * 1024 * 1024,
});
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
const fails = output.split("\n").filter((line) => line.startsWith("FAIL ") && !/^FAIL \d+ \//.test(line));

if (result.status === 0) {
  state = { passed: fingerprint };
  save();
  process.exit(0);
}

// 失敗の行と、その下の字下げされた詳細を返す
const details = [];
let keep = false;
for (const line of output.split("\n")) {
  if (line.startsWith("FAIL ") && !/^FAIL \d+ \//.test(line)) keep = true;
  else if (!line.startsWith("     ")) keep = false;
  if (keep) details.push(line);
}
const detail = details.slice(0, 60).join("\n") || output.split("\n").slice(-30).join("\n");

const session = input.session_id ?? "unknown";
const blocks = state.session === session ? (state.blocks ?? 0) : 0;
const keyFail = fails.some((line) => /^FAIL K\d/.test(line));

if (keyFail || blocks >= MAX_BLOCKS) {
  state = { session, blocks };
  save();
  const why = keyFail
    ? "鍵らしい文字列を検出した。履歴を書き換えないので Claude は直さず、人が判断する"
    : `${MAX_BLOCKS}回止めても直らなかった`;
  console.log(JSON.stringify({ systemMessage: `機械検査に FAIL がある（${why}）。evals/tmp/audit/latest.md を見てください。\n${detail}` }));
  process.exit(0);
}

state = { session, blocks: blocks + 1 };
save();
console.log(JSON.stringify({
  decision: "block",
  reason: [
    `終える前の機械検査（node scripts/audit.mjs）に FAIL がある（${blocks + 1}/${MAX_BLOCKS} 回目）。`,
    "AGENTS.md の決まりに従って原因を確かめて直し、build と test を通してからコミットする。",
    "別のセッションの未コミットの変更が原因なら直さず、その旨を docs/BACKLOG.md に書いて終える。",
    "",
    detail,
  ].join("\n"),
}));
process.exit(0);
