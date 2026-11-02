#!/usr/bin/env node
// Claude Code の PreToolUse フック。AGENTS.md の git の決まりに反するコマンドを止め、
// コードを含むコミットの前に build と test を通す。
// 止めるときは終了コード 2 で理由を標準エラーに書く。Claude にはその理由が渡る。
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const raw = String(input?.tool_input?.command ?? "");
const cwd = input?.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

// コミットメッセージなど引用符の中は見ない
const command = raw
  .replace(/<<-?\s*'?(\w+)'?[\s\S]*?\n\1\b/g, " ")
  .replace(/'[^']*'/g, "''")
  .replace(/"(?:\\.|[^"\\])*"/g, '""');

const rules = [
  [/\bgit\s+add\b[^;&|\n]*(\s-A\b|\s--all\b|\s\.(\s|$)|\s:\/)/, "git add -A / git add . は使わない。自分が変えたファイルをパスで指定する"],
  [/\bgit\s+rebase\b/, "rebase は使わない（履歴を書き換えない）"],
  [/\bgit\s+push\b[^;&|\n]*(\s-f\b|\s--force\b|\s--force-with-lease\b|\s\+\S)/, "force push は使わない。拒まれたら原因を確認する"],
  [/\bgit\s+commit\b[^;&|\n]*\s--amend\b/, "--amend は使わない（履歴を書き換えない）"],
  [/\bgit\s+commit\b[^;&|\n]*(\s--no-verify\b|\s-n\b)/, "--no-verify は使わない。鍵の検査を飛ばさない"],
  [/\bgit\s+reset\b[^;&|\n]*\s--hard\b/, "reset --hard は使わない。同じ作業ツリーの別のセッションの変更を消す"],
  [/\bgit\s+filter-(branch|repo)\b/, "履歴を書き換えない"],
  [/\bgit\s+(checkout\s+-[bB]|switch\s+-[cC])\b/, "ブランチを切らない。main に直接コミットする"],
  [/\bgit\s+config\b[^;&|\n]*core\.hooksPath(?!\s+\.githooks)/, "core.hooksPath は .githooks のままにする"],
];

for (const [pattern, reason] of rules) {
  if (pattern.test(command)) {
    process.stderr.write(`guard-bash: ${reason}\n`);
    process.exit(2);
  }
}

// コードを含むコミットは、build と test が通らなければ止める
if (/\bgit\s+commit\b/.test(command)) {
  const staged = spawnSync("git", ["diff", "--cached", "--name-only"], { cwd, encoding: "utf8" }).stdout ?? "";
  const files = staged.split("\n").filter(Boolean);
  const code = files.filter((f) =>
    /^(engine|shared|worker|src|evals|scripts|migrations)\//.test(f) && !f.startsWith("evals/results/")
    || /^(package(-lock)?\.json|tsconfig[^/]*\.json|vite\.config\.ts|vitest\.config\.ts|wrangler\.jsonc|index\.html)$/.test(f),
  );
  if (code.length > 0) {
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
