#!/usr/bin/env node
// Claude Code の SessionStart フック。鍵を止める git フックを有効にし、クラウドでは履歴と依存をそろえる。
// Windows でも動くように Node で書く（bash と sha256sum に頼らない）。
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.CLAUDE_PROJECT_DIR || join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const WIN = process.platform === "win32";
const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, encoding: "utf8", shell: WIN && cmd === "npm" });

// AGENTS.md: clone したら core.hooksPath を .githooks にする
run("git", ["config", "core.hooksPath", ".githooks"]);

if (process.env.CLAUDE_CODE_REMOTE !== "true") process.exit(0);

// クラウドの clone は浅い履歴なので、鍵と持ち込みデータの検査のために全履歴を取る
if (run("git", ["rev-parse", "--is-shallow-repository"]).stdout.trim() === "true") {
  run("git", ["fetch", "--quiet", "--unshallow", "origin"]);
}

// package.json と package-lock.json とこのファイルが前回の導入から変わったときだけ入れ直す
const marker = join(root, "node_modules/.session-start.sha256");
const digest = createHash("sha256");
for (const file of [".claude/hooks/session-start.mjs", "package.json", "package-lock.json"]) {
  digest.update(readFileSync(join(root, file)));
}
const expected = digest.digest("hex");
if (existsSync(marker) && readFileSync(marker, "utf8").trim() === expected) process.exit(0);

rmSync(marker, { force: true });
// npm install は古い npm で package-lock.json を書き換えるので ci を使う
const ci = spawnSync("npm", ["ci", "--no-audit", "--no-fund"], { cwd: root, stdio: "inherit", shell: WIN });
if (ci.status !== 0) process.exit(ci.status ?? 1);
writeFileSync(marker, `${expected}\n`);
