#!/usr/bin/env node
// Claude Code の PreToolUse フック。AGENTS.md の git の決まりに反するコマンドを止め、
// コードを含むコミットの前に build と test を通す。
// 止めるときは終了コード 2 で理由を標準エラーに書く。Claude にはその理由が渡る。
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { gitCalls, violation } from "./git-command.mjs";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const raw = String(input?.tool_input?.command ?? "");
const cwd = input?.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

const calls = gitCalls(raw);
for (const call of calls) {
  const reason = violation(call);
  if (reason) {
    process.stderr.write(`guard-bash: ${reason}\n`);
    process.exit(2);
  }
}

// コードを含むコミットは、build と test が通らなければ止める。
// 判定はコマンドを実行する前の状態で行うので、索引だけでなく、未ステージの変更（commit -a、
// add && commit、commit -- <path>）と、同じコマンドで足す新しいファイルも見る（監査の第2.5回の A25-7）。
const CODE = (file) =>
  (/^(engine|shared|worker|src|evals|scripts|migrations)\//.test(file) && !file.startsWith("evals/results/") && !file.startsWith("evals/tmp/")) ||
  /^(package(-lock)?\.json|tsconfig[^/]*\.json|vite\.config\.ts|vitest\.config\.ts|wrangler\.jsonc|index\.html)$/.test(file);

if (calls.some((call) => call.sub === "commit")) {
  const list = (args) => (spawnSync("git", args, { cwd, encoding: "utf8" }).stdout ?? "").split("\n").filter(Boolean);
  const files = [
    ...list(["diff", "--cached", "--name-only"]),
    ...list(["diff", "--name-only"]),
    ...(calls.some((call) => call.sub === "add") ? list(["ls-files", "--others", "--exclude-standard"]) : []),
  ];
  if (files.some(CODE)) {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    for (const script of ["build", "test"]) {
      const result = spawnSync(npm, ["run", script], { cwd, encoding: "utf8", shell: process.platform === "win32" });
      if (result.status !== 0) {
        const tail = `${result.stdout ?? ""}${result.stderr ?? ""}`.split("\n").slice(-40).join("\n");
        process.stderr.write(`guard-bash: npm run ${script} が通らないのでコミットを止めた\n${tail}\n`);
        process.exit(2);
      }
    }
  }
}

process.exit(0);
