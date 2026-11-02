#!/usr/bin/env node
// Claude Code の PostToolUse フック。git push のあとに、CI の結果を確かめるよう Claude へ伝える。
// AGENTS.md: push のあと CI の結果を確認し、落ちたら次の機能より先に直す。
import { readFileSync } from "node:fs";
import { gitCalls } from "./git-command.mjs";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const command = String(input?.tool_input?.command ?? "");
if (!gitCalls(command).some((call) => call.sub === "push")) process.exit(0);

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext:
      "push した。CI（GitHub Actions）の結果を確かめること。gh が使えないときは GitHub の MCP の actions_list（list_workflow_runs）で origin/main の最新の実行を見る。落ちていたら次の作業より先に直す。",
  },
}));
