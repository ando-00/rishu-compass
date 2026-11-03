#!/usr/bin/env node
// Claude Code の PreToolUse フック。AGENTS.md の git の決まりに反するコマンドを止める。
// 止めるときは終了コード 2 で理由を標準エラーに書く。Claude にはその理由が渡る。
import { readFileSync } from "node:fs";
import { gitCalls, violation } from "./git-command.mjs";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const raw = String(input?.tool_input?.command ?? "");

const calls = gitCalls(raw);
for (const call of calls) {
  const reason = violation(call);
  if (reason) {
    process.stderr.write(`guard-bash: ${reason}\n`);
    process.exit(2);
  }
}

// コードを含むコミットの build と test は、git の pre-commit フック（.githooks/staged-check.mjs）が、
// コミットされる中身で回す。このフックはコマンドの実行の前に動くので、何がコミットされるかを確かめられない（L-12）。

process.exit(0);
