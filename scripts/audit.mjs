// docs/AUDIT.md の機械検査を、何度でも同じ手順で回す。
// Claude を呼ばない。作業ツリーのファイルを書き換えない（結果は evals/tmp/audit/ に出す）。
//
// 使い方:
//   node scripts/audit.mjs          # 速い検査: 鍵、名前、依存の向き、作らないもの、履歴、build、test
//   node scripts/audit.mjs --full   # 上に加えて、clean clone での ci/build/test、README の手順の画面操作、壊す検査、評価の検査し直し、npm audit
//   --skip-build                    # build と test を飛ばす（CI では別の手順で回す）
//   --ci                            # GitHub Actions 用。core.hooksPath と CI の結果は見ない
//
// 終了コード: FAIL が1件でもあれば 1。WARN と 未検証 は 0。
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Windows のドライブ名を大文字にそろえる。小文字の c:\ から vitest を動かすと、同じモジュールを2回読んで全テストが落ちる
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..").replace(/^[a-z]:/, (drive) => drive.toUpperCase());
const FULL = process.argv.includes("--full");
const SKIP_BUILD = process.argv.includes("--skip-build");
const CI = process.argv.includes("--ci");
const OUT_DIR = join(ROOT, "evals/tmp/audit");
const KEY = "sk-ant-[A-Za-z0-9_-]{20,}";
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const WIN = process.platform === "win32";

// 表示だけに関わり、すり抜けてよいと記録した壊す箇所（docs/AUDIT_LOG.md の A0-21）
const KNOWN_SURVIVORS = new Set([
  "outreach: 声かけを先に並べる",
  "outreach: 高年次を先に並べる",
  "outreach: 根拠に職員確認を含める",
  "model: 副専攻の既定値",
]);

/** @type {{ id: string, status: "PASS" | "FAIL" | "WARN" | "未検証" | "INFO", title: string, detail: string }[]} */
const results = [];
const record = (id, status, title, detail = "") => {
  results.push({ id, status, title, detail: detail.trim() });
  console.log(`${status.padEnd(4)} ${id} ${title}${status === "PASS" ? "" : detail ? `\n${indent(detail.trim())}` : ""}`);
};
const indent = (text) => text.split("\n").slice(0, 30).map((line) => `     ${line}`).join("\n");

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: options.cwd ?? ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeout ?? 10 * 60 * 1000,
    shell: options.shell ?? false,
    env: { ...process.env, ...options.env },
  });
  return { status: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}`, stdout: result.stdout ?? "" };
}
const git = (args, options) => run("git", args, options);
const lines = (text) => text.split("\n").map((l) => l.trimEnd()).filter(Boolean);

/** 出力が空であることを期待する検査 */
function expectEmpty(id, title, output, { warn = false } = {}) {
  const found = lines(output);
  if (found.length === 0) record(id, "PASS", title);
  else record(id, warn ? "WARN" : "FAIL", title, found.join("\n"));
}

// ---- 鍵 ----
function checkKeys() {
  if (git(["rev-parse", "--is-shallow-repository"]).stdout.trim() === "true") {
    record("K0", "未検証", "履歴が浅い clone", "鍵と持ち込みデータの履歴の検査が一部だけになる。git fetch --unshallow origin main で全履歴を取る");
  }
  const revs = lines(git(["rev-list", "--all"]).stdout);
  let hits = [];
  for (let i = 0; i < revs.length; i += 200) {
    hits = hits.concat(lines(git(["grep", "-lE", KEY, ...revs.slice(i, i + 200)]).stdout));
  }
  expectEmpty("K1", "鍵: 全ての履歴", hits.join("\n"));
  expectEmpty("K2", "鍵: 索引", git(["grep", "-nE", "--cached", KEY]).stdout);
  const messages = lines(git(["log", "--all", "--format=%h %B"]).stdout).filter((l) => new RegExp(KEY).test(l));
  expectEmpty("K3", "鍵: コミットメッセージ", messages.join("\n"));
  const dist = join(ROOT, "dist/client");
  if (existsSync(dist)) {
    // Windows でも動くように、grep を使わず Node で読む
    const pattern = new RegExp(`${KEY}|ANTHROPIC_API_KEY`);
    const hits = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (pattern.test(readFileSync(path, "latin1"))) hits.push(path.slice(ROOT.length + 1));
      }
    };
    walk(dist);
    expectEmpty("K4", "鍵: dist/client", hits.join("\n"));
  } else {
    record("K4", "未検証", "鍵: dist/client", "dist/client がない（build のあとに検査する）");
  }
  const tracked = lines(git(["ls-files"]).stdout).filter((f) => /(^|\/)\.dev\.vars$/.test(f));
  expectEmpty("K5", ".dev.vars が追跡されていない", tracked.join("\n"));
}

// ---- 名前 ----
function checkNames() {
  // 作成者とコミット者のメールは、名前の一覧がなくても確かめられる。noreply の宛先だけを許す
  const people = lines(git(["log", "--all", "--format=%h %ae %ce"]).stdout);
  const personal = people.filter((line) =>
    line.split(" ").slice(1).some((mail) => !/^(noreply@anthropic\.com|[0-9]+\+[A-Za-z0-9-]+@users\.noreply\.github\.com)$/.test(mail)),
  );
  expectEmpty("N3", "名前: 作成者とコミット者のメールが noreply だけ", personal.map((l) => l.split(" ")[0]).join("\n"));
  const list = join(homedir(), ".claude/rishu-compass-denylist.txt");
  if (!existsSync(list)) {
    record("N1", "未検証", "名前: 作業ツリーとコミットメッセージ", `${list} がない。人が作る（docs/AUDIT.md）`);
    return;
  }
  expectEmpty("N1", "名前: 作業ツリー", git(["grep", "-n", "-i", "-F", "-f", list]).stdout);
  // 本文と、作成者・コミット者の名前とメール（トレーラーは本文に含まれる）
  const log = git(["log", "--all", "--format=%h %an %ae %cn %ce%n%h %B"]).stdout;
  const words = lines(readFileSync(list, "utf8")).map((w) => w.toLowerCase());
  const hits = lines(log).filter((line) => words.some((w) => line.toLowerCase().includes(w)));
  expectEmpty("N2", "名前: コミットメッセージと作成者欄", hits.map((l) => l.slice(0, 12)).join("\n"));
}

// ---- 依存の向き、作らないもの、型の抜け道 ----
function checkCode() {
  const engineImports = git(["grep", "-nE", 'from "([^.]|\\.\\./\\.\\./)', "--", "engine/*.ts", ":!engine/__tests__"]).stdout;
  expectEmpty("D1", "依存の向き: engine は外を読まない", engineImports);
  const toWorker = git(["grep", "-nE", 'from "(\\.\\./)+worker', "--", "src", "shared"]).stdout;
  expectEmpty("D2", "依存の向き: src と shared は worker を読まない", toWorker);
  const toSrc = git(["grep", "-nE", 'from "(\\.\\./)+src', "--", "engine", "shared", "worker"]).stdout;
  expectEmpty("D3", "依存の向き: engine、shared、worker は src を読まない", toSrc);

  const sdk = lines(git(["grep", "-n", "@anthropic-ai/sdk", "--", ":!package.json", ":!package-lock.json", ":!docs", ":!scripts/audit.mjs"]).stdout)
    .filter((l) => !l.startsWith("worker/"));
  expectEmpty("X1", "作らない: SDK は worker/ の中だけ", sdk.join("\n"));
  const send = git(["grep", "-nEi", "mailto:|send_email|nodemailer|resend|sendgrid", "--", "src", "worker", "shared", "engine", "wrangler.jsonc"]).stdout;
  expectEmpty("X2", "作らない: 送信の機能", send);
  const routes = lines(git(["grep", "-nE", "app\\.(get|post|put|delete|patch|all)\\(|\\.route\\(|\\.(get|post|put|delete|patch)\\(\"/", "--", "worker", ":!worker/__tests__"]).stdout);
  const suspicious = routes.filter((l) => /chat|send|mail|student-view|\/me\b|login/i.test(l));
  if (suspicious.length > 0) record("X3", "FAIL", "作らない: 学生向けと送信の経路", suspicious.join("\n"));
  else record("X3", "INFO", `経路 ${routes.length} 件。学生向けと送信を示す名前はない。新しい経路は人が読む`, routes.map((l) => l.replace(/\s+/g, " ").slice(0, 140)).join("\n"));
  const chatUi = git(["grep", "-nEi", "チャット|chat", "--", "src", ":!src/__tests__"]).stdout;
  expectEmpty("X4", "作らない: 画面に相談チャット", chatUi);

  const escapes = git(["grep", "-nE", "\\bas any\\b|: any\\b|@ts-ignore|@ts-expect-error", "--", "*.ts", "*.tsx"]).stdout;
  expectEmpty("T1", "型の抜け道", escapes, { warn: true });
}

// ---- 正解ルールと履歴 ----
function checkHistory() {
  expectEmpty("G1", "正解ルール: 画面から読まない", git(["grep", "-n", "gold", "--", "src"]).stdout);
  const workerGold = lines(git(["grep", "-ln", "gold", "--", "worker", ":!*.test.ts"]).stdout).filter((f) => f !== "worker/datasets.ts");
  expectEmpty("G2", "正解ルール: worker で読むのは worker/datasets.ts だけ", workerGold.join("\n"));
  const goldLog = lines(git(["log", "--format=%h|%(trailers:key=Co-Authored-By,valueonly,separator=%x2C)", "--", "data/fictional/*/gold*"]).stdout);
  const noCoauthor = goldLog.filter((l) => !/Claude/i.test(l.split("|")[1] ?? ""));
  expectEmpty("G3", "正解ルール: 全てのコミットに Claude の共著の表示", noCoauthor.join("\n"), { warn: true });
  const handbook = lines(git(["log", "--format=%h", "--", "data/fictional/sakuradai/handbook.md", "data/fictional/kamome/handbook.md", "data/fictional/advice-rules.md"]).stdout);
  if (handbook.length === 1 && handbook[0].startsWith("46e408f")) record("G4", "PASS", "持ち込みデータ: 46e408f のあと変えていない");
  else if (handbook.length === 0) record("G4", "未検証", "持ち込みデータ", "履歴が浅い clone では確かめられない");
  else record("G4", "FAIL", "持ち込みデータ: 46e408f のあとに変更がある", handbook.join("\n"));
  // git stash は reflog に「reset: moving to HEAD」を残すが、履歴は書き換えない（監査の第2.5回の A25-9）
  const reflog = lines(git(["reflog"]).stdout).filter(
    (l) => /rebase|reset|amend/.test(l) && !/reset: moving to HEAD$/.test(l),
  );
  expectEmpty("H1", "履歴: reflog に rebase、reset、amend がない", reflog.join("\n"));
  const ancestor = git(["merge-base", "--is-ancestor", "origin/main", "HEAD"]);
  if (ancestor.status === 0) record("H2", "PASS", "履歴: origin/main が HEAD の祖先");
  else record("H2", "FAIL", "履歴: origin/main が HEAD の祖先でない", "push の前に原因を確かめる。rebase と force push はしない");
  // 最初のコミットがイベントの開始（docs/DATA.md）より後。浅い clone では最初のコミットが読めないので未検証
  const START = Date.parse("2026-11-02T12:30:00+09:00");
  const first = lines(git(["log", "--reverse", "--format=%aI"]).stdout)[0];
  if (git(["rev-parse", "--is-shallow-repository"]).stdout.trim() === "true") record("H5", "未検証", "最初のコミットが開始時刻より後", "浅い clone");
  else if (first && Date.parse(first) > START) record("H5", "PASS", `最初のコミット ${first} は開始時刻より後`);
  else record("H5", "FAIL", "最初のコミットが開始時刻より前か、読めない", first ?? "");
  const ahead = lines(git(["rev-list", "origin/main..HEAD"]).stdout).length;
  record("H3", ahead === 0 ? "PASS" : "WARN", `push していないコミット ${ahead} 件`);
  if (CI) return;
  const hooks = git(["config", "core.hooksPath"]).stdout.trim();
  record("H4", hooks === ".githooks" ? "PASS" : "FAIL", "core.hooksPath が .githooks", hooks ? `今の値: ${hooks}` : "未設定。git config core.hooksPath .githooks");
}

// ---- フォルダ構成 ----
function checkFolders() {
  const expected = new Set(["engine", "shared", "worker", "src", "migrations", "data", "evals", "scripts", "docs", ".github", ".githooks", ".claude"]);
  const top = new Set(lines(git(["ls-files"]).stdout).filter((f) => f.includes("/")).map((f) => f.split("/")[0]));
  const extra = [...top].filter((d) => !expected.has(d));
  expectEmpty("F1", "最上位のフォルダが AGENTS.md の表と合う", extra.join("\n"));
  const ignored = [".dev.vars", "dist/", "node_modules/", "worker-configuration.d.ts"];
  const gi = readFileSync(join(ROOT, ".gitignore"), "utf8");
  expectEmpty("F2", "生成物と秘密が .gitignore にある", ignored.filter((p) => !gi.includes(p)).join("\n"));
  const empty = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if ([".git", "node_modules", "dist", ".wrangler", "tmp"].includes(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (readdirSync(path).length === 0) empty.push(path.slice(ROOT.length + 1));
        else walk(path);
      }
    }
  };
  walk(ROOT);
  expectEmpty("F3", "空のフォルダがない", empty.join("\n"), { warn: true });
}

// ---- build と test ----
function checkBuild(cwd, prefix, label) {
  for (const script of ["build", "test"]) {
    const r = run(NPM, ["run", script], { cwd, shell: WIN });
    const tail = lines(r.out).slice(-25).join("\n");
    if (r.status === 0) {
      const summary = lines(r.out).filter((l) => /Tests\s+\d+|Test Files/.test(l)).join(" / ");
      record(`${prefix}-${script}`, "PASS", `${label}: npm run ${script}${summary ? ` (${summary.replace(/\s+/g, " ")})` : ""}`);
    } else {
      record(`${prefix}-${script}`, "FAIL", `${label}: npm run ${script}`, tail);
      return false;
    }
  }
  return true;
}

// ---- --full: clean clone、壊す検査、評価、npm audit ----
function linkModules(target) {
  symlinkSync(join(ROOT, "node_modules"), join(target, "node_modules"), WIN ? "junction" : "dir");
}

function checkCleanClone(work) {
  const clone = join(work, "clone");
  const r = git(["clone", "--quiet", "--no-local", ROOT, clone]);
  if (r.status !== 0) {
    record("C0", "FAIL", "clean clone を作れない", r.out);
    return null;
  }
  git(["checkout", "--quiet", git(["rev-parse", "HEAD"]).stdout.trim()], { cwd: clone });
  if (existsSync(join(clone, ".dev.vars"))) record("C0", "FAIL", "clean clone に .dev.vars がある");
  const ci = run(NPM, ["ci", "--no-audit", "--no-fund"], { cwd: clone, shell: WIN });
  if (ci.status !== 0) {
    record("C-ci", "FAIL", "clean clone: npm ci", lines(ci.out).slice(-20).join("\n"));
    return null;
  }
  record("C-ci", "PASS", "clean clone（.dev.vars なし）: npm ci");
  const lock = git(["status", "--porcelain"], { cwd: clone }).stdout;
  expectEmpty("C-lock", "clean clone: npm ci のあとに変わったファイルがない", lock);
  return checkBuild(clone, "C", "clean clone（.dev.vars なし）") ? clone : null;
}

function checkEvals(clone) {
  for (const script of ["eval:recheck", "eval:score"]) {
    const r = run(NPM, ["run", "--silent", script], { cwd: clone, shell: WIN });
    const name = script.replace(":", "-");
    writeFileSync(join(OUT_DIR, `${name}.latest.txt`), r.out);
    const previousPath = join(OUT_DIR, `${name}.previous.txt`);
    if (r.status !== 0) {
      record(`E-${name}`, "FAIL", `npm run ${script}（Claude を呼ばない）`, lines(r.out).slice(-20).join("\n"));
      continue;
    }
    const normalize = (text) => text.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, "<time>").replace(/\S*evals\/results\/score\/[^\s"]+/g, "<file>");
    const previous = existsSync(previousPath) ? readFileSync(previousPath, "utf8") : null;
    if (previous !== null && normalize(previous) !== normalize(r.out)) {
      record(`E-${name}`, "WARN", `npm run ${script} の出力が前回と変わった`, `前回: ${previousPath}\n今回: ${join(OUT_DIR, `${name}.latest.txt`)}\n数字が変わったなら docs/EVALUATION.md と README.md を確かめる`);
    } else {
      record(`E-${name}`, "PASS", `npm run ${script}${previous === null ? "（初回。次回から前回と比べる）" : "（前回と同じ）"}`);
    }
    writeFileSync(previousPath, r.out);
    if (script === "eval:recheck") checkReadmeNumbers(r.out);
  }
}

// README の評価の表の数字が、保存した結果を今のコードで検査し直した値（eval:recheck の最新の回）と合うか
function checkReadmeNumbers(recheckOutput) {
  const latest = {};
  let school = null;
  let inLatest = false;
  for (const line of recheckOutput.split("\n")) {
    const head = /^(\w+): 全\d+回/.exec(line);
    if (head) {
      school = head[1];
      inLatest = false;
      latest[school] = {};
      continue;
    }
    if (line.startsWith("最新:")) inLatest = true;
    const item = inLatest && school ? /^\s+(.+?): (\d+\/\d+)/.exec(line) : null;
    if (item) latest[school][item[1]] = item[2];
  }
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  const rows = {
    "ルール変換の項目の一致": "項目の一致",
    "曖昧箇所の検出": "曖昧箇所の検出",
    "全学生の判定の一致（未回答）": "判定の一致（未回答）",
    "根拠の文の実在": "根拠の文の実在",
  };
  const problems = [];
  for (const [label, key] of Object.entries(rows)) {
    const row = readme.split("\n").find((line) => line.startsWith(`| ${label} |`));
    if (!row) {
      problems.push(`README に「${label}」の行がない`);
      continue;
    }
    const [sakuradai, kamome] = row.split("|").slice(2, 4).map((cell) => cell.trim());
    for (const [name, shown] of [["sakuradai", sakuradai], ["kamome", kamome]]) {
      const actual = latest[name]?.[key];
      if (actual !== shown) problems.push(`${label}（${name}）: README ${shown}、eval:recheck ${actual ?? "なし"}`);
    }
  }
  if (problems.length > 0) record("E3", "FAIL", "README の評価の表が eval:recheck の最新の回と合わない", problems.join("\n"));
  else record("E3", "PASS", `README の評価の表の ${Object.keys(rows).length} 行が eval:recheck の最新の回と合う`);
  record("E4", "INFO", "README の「仕込んだ曖昧さの検出」の行は、仕込みの一覧がリポジトリにないので照合しない");
}

function checkMutation(work) {
  const copy = join(work, "mutate");
  mkdirSync(copy);
  for (const entry of ["engine", "data", "worker", "shared", "evals", "src", "migrations", "vitest.config.ts", "package.json"]) {
    cpSync(join(ROOT, entry), join(copy, entry), { recursive: true, filter: (p) => !p.includes(`${"evals"}/tmp`) });
  }
  linkModules(copy);
  const r = run(process.execPath, [join(ROOT, "scripts/mutate.mjs"), copy], { timeout: 3 * 60 * 60 * 1000 });
  const log = existsSync(join(copy, "mutants.out")) ? readFileSync(join(copy, "mutants.out"), "utf8") : r.out;
  writeFileSync(join(OUT_DIR, "mutants.latest.txt"), log);
  const done = lines(log).find((l) => l.startsWith("DONE"));
  if (!done) {
    record("M1", "FAIL", "壊す検査が最後まで動かない", lines(log).slice(-10).join("\n"));
    return;
  }
  const survivors = lines(log).filter((l) => l.startsWith("SURVIVED ")).map((l) => l.slice("SURVIVED ".length));
  const skipped = lines(log).filter((l) => l.startsWith("SKIP "));
  const unknown = survivors.filter((s) => !KNOWN_SURVIVORS.has(s));
  if (unknown.length > 0) record("M1", "FAIL", `壊す検査: 記録にないすり抜け ${unknown.length} 件（${done}）`, unknown.join("\n"));
  else record("M1", "PASS", `壊す検査: すり抜けは表示だけの既知のものだけ（${done}）`);
  if (skipped.length > 0) record("M2", "WARN", `壊す検査: コードが変わって壊す箇所が見つからない ${skipped.length} 件。scripts/mutate.mjs を今のコードに合わせる`, skipped.join("\n"));
  else record("M2", "PASS", "壊す検査: SKIP なし");
}

function checkReadme() {
  const r = run(process.execPath, [join(ROOT, "scripts/e2e-readme.mjs")], { timeout: 15 * 60 * 1000 });
  const tail = lines(r.out).slice(-14).join("\n");
  if (r.status === 0) record("U1", "PASS", "README の手順1〜10 を clean clone とヘッドレスの Chromium で通した（evals/tmp/e2e/latest.md）");
  else if (r.status === 3) record("U1", "未検証", "README の手順", tail);
  else record("U1", "FAIL", "README の手順が画面で通らない（evals/tmp/e2e/latest.md）", tail);
}

function checkNpmAudit() {
  const r = run(NPM, ["audit", "--omit=dev", "--json"], { shell: WIN, timeout: 120000 });
  try {
    const json = JSON.parse(r.stdout);
    const v = json.metadata?.vulnerabilities ?? {};
    const serious = (v.high ?? 0) + (v.critical ?? 0);
    const text = Object.entries(v).map(([k, n]) => `${k}=${n}`).join(" ");
    record("P1", serious > 0 ? "WARN" : "PASS", `npm audit --omit=dev: ${text}`, serious > 0 ? "依存の更新は監査の対象外。人が判断する" : "");
  } catch {
    record("P1", "未検証", "npm audit --omit=dev", lines(r.out).slice(-5).join("\n"));
  }
}

function checkCi() {
  const r = run("gh", ["run", "list", "--branch", "main", "--limit", "1", "--json", "status,conclusion,headSha"], { timeout: 60000 });
  try {
    const [latest] = JSON.parse(r.stdout);
    const head = git(["rev-parse", "origin/main"]).stdout.trim();
    if (!latest) throw new Error("no runs");
    const same = latest.headSha === head;
    const ok = latest.conclusion === "success";
    // 最新の push の実行がまだ一覧にないか、走っている途中なら WARN。終わって赤なら FAIL
    const status = !same || latest.status !== "completed" ? "WARN" : ok ? "PASS" : "FAIL";
    record("CI", status, `CI: ${latest.status} ${latest.conclusion ?? ""} ${latest.headSha.slice(0, 7)}${same ? "" : `（origin/main は ${head.slice(0, 7)}。実行の完了を待つ）`}`);
  } catch {
    record("CI", "未検証", "CI の結果", "gh で取れない。GitHub の Actions で origin/main の最新の結果を確かめる");
  }
}

// ---- 実行 ----
mkdirSync(OUT_DIR, { recursive: true });
const started = new Date();
const head = git(["rev-parse", "--short", "HEAD"]).stdout.trim();
console.log(`監査 ${FULL ? "--full" : "quick"} 対象 ${head} ${started.toISOString()}`);
const dirty = git(["status", "--porcelain"]).stdout;
if (dirty.trim()) record("W0", "INFO", "作業ツリーに未コミットの変更がある（別のセッションの変更かもしれない）", dirty);

checkKeys();
checkNames();
checkCode();
checkHistory();
checkFolders();
if (!SKIP_BUILD) {
  checkBuild(ROOT, "B", "作業ツリー");
  checkKeys(); // build で dist/client ができたあとにもう一度
}
if (FULL) {
  const work = mkdtempSync(join(tmpdir(), "rishu-audit-"));
  try {
    const clone = checkCleanClone(work);
    if (clone) checkEvals(clone);
    checkReadme();
    checkMutation(work);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  checkNpmAudit();
}
if (!CI) checkCi();

// 同じ ID の再検査は最後の結果を使う
const finalResults = [...new Map(results.map((r) => [r.id, r])).values()];
const count = (s) => finalResults.filter((r) => r.status === s).length;
const minutes = ((Date.now() - started.getTime()) / 60000).toFixed(1);
const summary = `FAIL ${count("FAIL")} / WARN ${count("WARN")} / 未検証 ${count("未検証")} / PASS ${count("PASS")}`;
const stamp = started.toISOString().replace(/[:.]/g, "-");
const report = [
  `# 機械検査 ${FULL ? "--full" : "quick"} ${started.toISOString()}`,
  "",
  `対象コミット: ${head}　所要: ${minutes} 分`,
  "",
  summary,
  "",
  "| ID | 結果 | 検査 |",
  "|---|---|---|",
  ...finalResults.map((r) => `| ${r.id} | ${r.status} | ${r.title.replace(/\|/g, "\\|")} |`),
  "",
  ...finalResults.filter((r) => r.detail && r.status !== "PASS").flatMap((r) => [`## ${r.id} ${r.title}`, "", "```text", r.detail, "```", ""]),
].join("\n");
writeFileSync(join(OUT_DIR, `${stamp}.md`), report);
writeFileSync(join(OUT_DIR, "latest.md"), report);
console.log(`\n${summary}（${minutes} 分）\n記録: evals/tmp/audit/latest.md`);
process.exit(count("FAIL") > 0 ? 1 : 0);
