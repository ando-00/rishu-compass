// 機械検査やフックのスクリプトは `npm test` から読まれないものがあり、構文エラーがコミット前の検査を通った
// （独立の全体監査 V-19、V-20）。node --check で、実行せずに構文だけを確かめる。
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const files = ["scripts", ".claude/hooks", ".githooks"]
  .map((dir) => join(ROOT, dir))
  .filter((dir) => existsSync(dir))
  .flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith(".mjs"))
      .map((name) => join(dir, name)),
  );

describe("スクリプトの構文", () => {
  it("機械検査のスクリプトが一覧に入っている", () => {
    expect(files.some((file) => file.endsWith("audit.mjs"))).toBe(true);
  });

  it.each(files)("%s", (file) => {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
