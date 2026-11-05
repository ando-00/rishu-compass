#!/usr/bin/env node
// pre-commit から呼ぶ。コードを含むコミットは、コミットされる中身（索引）を一時フォルダに書き出し、
// そこで npm run build と npm test を回して、通らなければ止める（人の判断 H21、監査の記録 L-12）。
// 作業ツリーで回すと、ステージしていない変更で通ってしまう。commit -a や commit -- <path> のときは、
// git が渡す一時的な索引（GIT_INDEX_FILE）を読むので、実際にコミットされる中身を見る。
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, rmdirSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WIN = process.platform === "win32";
const git = (args) => spawnSync("git", args, { encoding: "utf8" });

const CODE = (file) =>
  (/^(engine|shared|worker|src|evals|scripts|migrations|data|\.claude|\.githooks)\//.test(file) && !file.startsWith("evals/results/") && !file.startsWith("evals/tmp/")) ||
  /^(package(-lock)?\.json|tsconfig[^/]*\.json|vite\.config\.ts|vitest\.config\.ts|wrangler\.jsonc|index\.html)$/.test(file);

// 日本語のファイル名が引用符つきで出ないようにする
const files = git(["-c", "core.quotePath=false", "diff", "--cached", "--name-only"]).stdout.split("\n").filter(Boolean);
if (!files.some(CODE)) process.exit(0);

const root = git(["rev-parse", "--show-toplevel"]).stdout.trim();
// 小文字のドライブ名（c:\）から vitest を動かすと全テストが落ちる（L-13）ので、大文字にそろえる
const work = mkdtempSync(join(tmpdir(), "rishu-staged-")).replace(/^[a-z]:/, (drive) => drive.toUpperCase());
const modules = join(work, "node_modules");
let status = 0;
try {
  const exported = git(["checkout-index", "--all", "--force", `--prefix=${work.replace(/\\/g, "/")}/`]);
  if (exported.status !== 0) throw new Error(`索引を書き出せない: ${exported.stderr}`);
  if (existsSync(join(root, "node_modules"))) symlinkSync(join(root, "node_modules"), modules, WIN ? "junction" : "dir");

  // テストの中で別のリポジトリの git を動かすので、このコミットの git の環境変数を渡さない
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  for (const script of ["build", "test"]) {
    const result = spawnSync(WIN ? "npm.cmd" : "npm", ["run", script], { cwd: work, env, encoding: "utf8", shell: WIN });
    if (result.status !== 0) {
      const tail = `${result.stdout ?? ""}${result.stderr ?? ""}`.split("\n").slice(-40).join("\n");
      process.stderr.write(`pre-commit: コミットする中身で npm run ${script} が通らないので止めた\n${tail}\n`);
      status = 1;
      break;
    }
  }
} catch (error) {
  process.stderr.write(`pre-commit: ${error?.message ?? error}\n`);
  status = 1;
} finally {
  // node_modules へのリンクを先に外し、リンク先を消さないようにする
  if (existsSync(modules)) {
    try {
      unlinkSync(modules);
    } catch {
      rmdirSync(modules);
    }
  }
  rmSync(work, { recursive: true, force: true, maxRetries: 3 });
}
process.exit(status);
