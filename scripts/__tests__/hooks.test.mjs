// Claude Code のフックに JSON を渡し、止める（終了コード 2）か通す（0）かを確かめる。
// git の pre-commit フックは、仮のリポジトリで実際にコミットして確かめる。
// 監査の第2.5回の A25-7、A25-8 と、L-12 の事例を含む。
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HOOKS = join(dirname(fileURLToPath(import.meta.url)), "../../.claude/hooks");
const GITHOOKS = join(dirname(fileURLToPath(import.meta.url)), "../../.githooks");
// git のリポジトリでない場所。コミットの前の build と test は走らない
const plain = mkdtempSync(join(tmpdir(), "hook-plain-"));

function run(hook, command, cwd = plain) {
  const result = spawnSync(process.execPath, [join(HOOKS, hook)], {
    input: JSON.stringify({ tool_input: { command }, cwd }),
    encoding: "utf8",
    timeout: 60000,
  });
  return result.status;
}
const guard = (command, cwd) => run("guard-bash.mjs", command, cwd);

const BLOCK = [
  "git add -A",
  "git add .",
  "git add -vA",
  "git add --all",
  "cd x && git add . && git commit -m a",
  "git -C /repo add -A",
  "git rebase main",
  "git -C /repo rebase origin/main",
  "git pull --rebase origin main",
  "git pull -r origin main",
  "git push --force origin main",
  "git push -f origin main",
  "git push -uf origin main",
  "git push --forc origin main",
  "git push --force-with-lease origin main",
  "git push origin +main",
  "git -C /repo push --force origin main",
  // push の前の鍵の検査（pre-push）を飛ばさせない（追加の監査 R-4）
  "git push --no-verify origin main",
  "git push origin main --no-verify",
  "git push --no-verif origin main",
  "git commit --amend",
  "git commit --amen -m x",
  "git commit -n -m x",
  "git commit -nm x",
  "git commit --no-verify -m x",
  "git commit --no-verif -m x",
  "git -c core.hooksPath=/dev/null commit -m x",
  "git reset --hard origin/main",
  "git reset --har HEAD~1",
  "git filter-branch --all",
  "git checkout -b foo",
  "git switch -c foo",
  "git switch --create feature-x",
  "git branch feature-x",
  "git config core.hooksPath /dev/null",
  "git config --unset core.hooksPath",
  'bash -c "git rebase main"',
  "git commit -m \"don't\" && git push -f origin main && echo 'x'",
];

const ALLOW = [
  "git add engine/a.ts docs/PROGRESS.md",
  'git commit -m "git add -A を使わない"',
  "git commit -F - <<'EOF'\ngit rebase の話\nEOF",
  'git commit -F - <<"EOF"\ngit add -A は使わない\nEOF',
  "git commit -m x",
  "git commit -am x",
  "git push -u origin main",
  // push の -n は --dry-run で、フックを飛ばすものではない
  "git push -n origin main",
  "git pull origin main",
  "git fetch origin main && git merge --ff-only origin/main",
  "git checkout main",
  "git switch main",
  "git log --oneline | head -n 5",
  "git branch -a",
  "git branch",
  "git branch -D old-topic",
  "git config core.hooksPath",
  "git config core.hooksPath .githooks",
  "git reset HEAD engine/a.ts",
  "git stash && git stash pop",
  "npm test -- -n 3",
  "echo 'git push -f は使わない'",
];

describe("guard-bash", () => {
  it.each(BLOCK)("止める: %s", (command) => expect(guard(command)).toBe(2));
  it.each(ALLOW)("通す: %s", (command) => expect(guard(command)).toBe(0));
});

describe("pre-commit のコミットされる中身での build と test（A25-7、L-12）", () => {
  // build は engine/ に BROKEN を含むファイルがあれば落ちる。フックは本物の .githooks を使う
  function repo({ test = "exit 0" } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "hook-repo-"));
    const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8", timeout: 60000 });
    git("init", "-q");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    git("config", "core.hooksPath", GITHOOKS);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { build: "node check.js", test } }));
    writeFileSync(
      join(dir, "check.js"),
      'const fs = require("fs");\nprocess.exit(fs.readdirSync("engine").some((f) => fs.readFileSync("engine/" + f, "utf8").includes("BROKEN")) ? 1 : 0);\n',
    );
    mkdirSync(join(dir, "engine"));
    writeFileSync(join(dir, "engine/a.ts"), "export const a = 1;\n");
    writeFileSync(join(dir, "note.md"), "a\n");
    git("add", "package.json", "check.js", "engine/a.ts", "note.md");
    git("commit", "-q", "--no-verify", "-m", "init");
    const head = () => git("rev-parse", "HEAD").stdout.trim();
    return { dir, git, head };
  }
  const BROKEN = "export const a = 'BROKEN';\n";
  const FIXED = "export const a = 2;\n";

  it("索引が壊れていれば、作業ツリーが直っていても止める（2a3628f の形）", () => {
    const { dir, git, head } = repo();
    const before = head();
    writeFileSync(join(dir, "engine/a.ts"), BROKEN);
    git("add", "engine/a.ts");
    writeFileSync(join(dir, "engine/a.ts"), FIXED);
    expect(git("commit", "-q", "-m", "x").status).not.toBe(0);
    expect(head()).toBe(before);
  }, 60000);

  it("索引が通れば、作業ツリーの未ステージの壊れた変更では止めない", () => {
    const { dir, git, head } = repo();
    const before = head();
    writeFileSync(join(dir, "engine/a.ts"), FIXED);
    git("add", "engine/a.ts");
    writeFileSync(join(dir, "engine/a.ts"), BROKEN);
    expect(git("commit", "-q", "-m", "x").status).toBe(0);
    expect(head()).not.toBe(before);
  }, 60000);

  it.each([
    ["commit -a", ["commit", "-q", "-am", "x"]],
    ["commit -- パス", ["commit", "-q", "-m", "x", "--", "engine/a.ts"]],
  ])("%s で入る壊れた変更を止める", (_, args) => {
    const { dir, git } = repo();
    writeFileSync(join(dir, "engine/a.ts"), BROKEN);
    expect(git(...args).status).not.toBe(0);
  }, 60000);

  it("新しく足したコードのファイルも見る", () => {
    const { dir, git } = repo();
    writeFileSync(join(dir, "engine/b.ts"), BROKEN);
    git("add", "engine/b.ts");
    expect(git("commit", "-q", "-m", "x").status).not.toBe(0);
  }, 60000);

  it("コードを含まないコミットは build と test を回さない", () => {
    const { dir, git } = repo({ test: "exit 1" });
    writeFileSync(join(dir, "note.md"), "b\n");
    git("add", "note.md");
    expect(git("commit", "-q", "-m", "x").status).toBe(0);
  }, 60000);
});

describe("after-push", () => {
  const notice = (command) =>
    spawnSync(process.execPath, [join(HOOKS, "after-push.mjs")], {
      input: JSON.stringify({ tool_input: { command } }),
      encoding: "utf8",
    }).stdout;
  it.each(["git push -u origin main", "git -C /repo push origin main"])("push のあとに CI の確認を促す: %s", (command) => {
    expect(notice(command)).toContain("CI");
  });
  it("push でなければ何も言わない", () => expect(notice("git status")).toBe(""));
});
