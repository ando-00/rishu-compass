// README.md の「試す手順」を、clean clone（.dev.vars なし）とヘッドレスの Chromium で最後まで通す。
// Claude を呼ばない。作業ツリーのファイルを書き換えない（結果は evals/tmp/e2e/ に出す）。
//
// 使い方: node scripts/e2e-readme.mjs
// 終了コード: 0 は全手順が通った、1 はどこかで落ちた、3 は Playwright がなく確かめられない（未検証）
//
// Playwright は依存に入れていない。手元で入れてある環境（グローバルや NODE_PATH）のものを使う。
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WIN = process.platform === "win32";
const NPM = WIN ? "npm.cmd" : "npm";
const started = new Date();
const OUT = join(ROOT, "evals/tmp/e2e", started.toISOString().replace(/[:.]/g, "-"));
mkdirSync(OUT, { recursive: true });

const log = [];
const say = (line) => {
  log.push(line);
  console.log(line);
};

let playwright;
try {
  playwright = createRequire(import.meta.url)("playwright");
} catch {
  say("未検証: Playwright が見つからない。グローバルに入れるか NODE_PATH で指定する");
  finish(3);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// Linux では /proc から、ポートで待ち受けているプロセスを探す。他の OS では null（PID の確認は未検証）
function listeningPids(port) {
  if (process.platform !== "linux") return null;
  const hex = port.toString(16).toUpperCase().padStart(4, "0");
  const inodes = new Set();
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 10) continue;
      if (cols[1].endsWith(`:${hex}`) && cols[3] === "0A") inodes.add(cols[9]);
    }
  }
  const pids = new Set();
  for (const pid of readdirSync("/proc").filter((name) => /^\d+$/.test(name))) {
    try {
      for (const fd of readdirSync(`/proc/${pid}/fd`)) {
        const target = readlinkSync(`/proc/${pid}/fd/${fd}`);
        const match = /^socket:\[(\d+)\]$/.exec(target);
        if (match && inodes.has(match[1])) pids.add(Number(pid));
      }
    } catch {
      // 他のユーザーのプロセスや、終わったプロセスは読めない
    }
  }
  return [...pids];
}

function isDescendant(pid, ancestor) {
  let current = pid;
  for (let i = 0; i < 64 && current > 1; i += 1) {
    if (current === ancestor) return true;
    try {
      const stat = readFileSync(`/proc/${current}/stat`, "utf8");
      current = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
    } catch {
      return false;
    }
  }
  return current === ancestor;
}

let server;
let work;
let browser;
let failed = false;

function finish(code) {
  writeFileSync(join(OUT, "report.md"), `# README の手順 ${started.toISOString()}\n\n\`\`\`text\n${log.join("\n")}\n\`\`\`\n`);
  writeFileSync(join(ROOT, "evals/tmp/e2e/latest.md"), readFileSync(join(OUT, "report.md"), "utf8"));
  process.exit(code);
}

async function cleanup() {
  await browser?.close().catch(() => {});
  if (server?.pid) {
    try {
      if (WIN) spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"]);
      else process.kill(-server.pid, "SIGTERM");
    } catch {
      // すでに終わっている
    }
  }
  if (work) rmSync(work, { recursive: true, force: true, maxRetries: 3 });
}

async function main() {
  // 1. clean clone。node_modules は手元のものをつなぐ（npm ci は scripts/audit.mjs --full が別に確かめる）
  work = mkdtempSync(join(tmpdir(), "rishu-e2e-"));
  const clone = join(work, "clone");
  const head = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  spawnSync("git", ["clone", "--quiet", "--no-local", ROOT, clone]);
  spawnSync("git", ["checkout", "--quiet", head], { cwd: clone });
  if (existsSync(join(clone, ".dev.vars"))) throw new Error("clean clone に .dev.vars がある");
  symlinkSync(join(ROOT, "node_modules"), join(clone, "node_modules"), WIN ? "junction" : "dir");
  say(`対象コミット ${head}、clean clone、.dev.vars なし`);

  // 2. 空いているポートで起動し、応答したのが自分の起動したサーバーかを確かめる
  const port = await freePort();
  const serverLog = [];
  server = spawn(NPM, ["run", "dev", "--", "--port", String(port), "--strictPort", "--host", "127.0.0.1"], {
    cwd: clone,
    detached: !WIN,
    shell: WIN,
    env: { ...process.env, ANTHROPIC_API_KEY: "", ALLOW_CLAUDE: "" },
  });
  server.stdout.on("data", (chunk) => serverLog.push(String(chunk)));
  server.stderr.on("data", (chunk) => serverLog.push(String(chunk)));
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 120 && !ready; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (server.exitCode !== null) break;
    ready = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false);
  }
  writeFileSync(join(OUT, "server.log"), serverLog.join(""));
  if (!ready) throw new Error(`サーバーが起動しない（server.log を見る）`);
  const pids = listeningPids(port);
  if (pids === null) say(`未検証: ポート ${port} の PID（この OS では調べない）。--strictPort で起動した`);
  else if (pids.length === 0 || !pids.every((pid) => isDescendant(pid, server.pid))) {
    throw new Error(`ポート ${port} で待ち受けているのが自分の起動したサーバーでない: ${pids.join(",")}`);
  } else say(`PASS 起動: ポート ${port}、PID ${pids.join(",")} は起動したプロセス ${server.pid} の子`);

  // 3. README の手順
  browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
  page.setDefaultTimeout(30000);
  await page.goto(base);

  let n = 0;
  const step = async (title, action) => {
    n += 1;
    try {
      const note = await action();
      await page.screenshot({ path: join(OUT, `${String(n).padStart(2, "0")}.png`), fullPage: true });
      say(`PASS 手順${title}${note ? `: ${note}` : ""}`);
    } catch (error) {
      failed = true;
      await page.screenshot({ path: join(OUT, `${String(n).padStart(2, "0")}-failed.png`), fullPage: true }).catch(() => {});
      say(`FAIL 手順${title}: ${String(error?.message ?? error).split("\n")[0]}`);
      throw error;
    }
  };
  const tab = (name) => page.getByRole("navigation", { name: "画面の切り替え" }).getByRole("button", { name, exact: true });
  const summary = async (label) => {
    const cell = page.locator(".summary-cell").filter({ has: page.getByText(label, { exact: true }) });
    const text = await cell.locator(".summary-value").innerText();
    return Number(text.replace(/[^0-9]/g, ""));
  };

  await step("1 対象がさくら台大学（架空）で、要項の取り込みを開く", async () => {
    const select = page.getByLabel("対象");
    await select.waitFor();
    await page.waitForFunction(() => (document.querySelector("select")?.options.length ?? 0) > 0);
    const selected = await select.evaluate((el) => el.options[el.selectedIndex]?.text ?? "");
    if (!selected.includes("さくら台大学")) throw new Error(`対象が「${selected}」`);
    const source = await page.getByTestId("rule-source").innerText();
    if (!source.includes("正解ルールで判定しています")) throw new Error(`判定に使うルールの表示が「${source}」`);
    await tab("要項の取り込み").click();
  });
  await step("2 先に確認事項を開くと、正解ルールの未回答が2件（第13条と第6条）", async () => {
    await tab("確認事項").click();
    await page.getByRole("heading", { name: /未回答の確認事項（2件）/ }).waitFor();
    const body = await page.locator("main").innerText();
    for (const word of ["第13条", "第6条"]) if (!body.includes(word)) throw new Error(`${word} が見当たらない`);
    await tab("要項の取り込み").click();
  });
  await step("3 記録を読み込む", async () => {
    await page.getByRole("button", { name: "記録を読み込む" }).first().click();
    await page.getByRole("button", { name: /このルール案を確定する/ }).waitFor();
  });
  await step("4 根拠の文、検査用ケース、職員に確認する箇所が見える", async () => {
    const body = await page.locator("main").innerText();
    const missing = ["第6条", "検査用ケース"].filter((word) => !body.includes(word));
    if (missing.length > 0) throw new Error(`見当たらない: ${missing.join("、")}`);
  });
  await step("5 このルール案を確定する", async () => {
    await page.getByRole("button", { name: /このルール案を確定する/ }).click();
    await page.getByRole("button", { name: "確定を取り消す" }).waitFor();
    const source = await page.getByTestId("rule-source").innerText();
    if (!/職員が確定したルール案（第\d+版）で判定しています/.test(source)) throw new Error(`判定に使うルールの表示が「${source}」`);
  });
  let before = 0;
  await step("6 確定すると未回答は第6条の1件だけになり（第13条は Claude が見逃した）、読み方ごとの人数が出る", async () => {
    await tab("確認事項").click();
    await page.getByRole("heading", { name: /未回答の確認事項（1件）/ }).waitFor();
    await page.getByRole("button", { name: /卒業に必要な単位に算入される単位だけを数える/ }).waitFor();
    before = await summary("声かけ");
    return `回答前の声かけ ${before}人、職員確認 ${await summary("職員確認")}人、対応なし ${await summary("対応なし")}人`;
  });
  await step("7 「卒業に必要な単位に算入される単位だけを数える」で声かけが増える", async () => {
    await page.getByRole("button", { name: /卒業に必要な単位に算入される単位だけを数える/ }).click();
    await page.getByText(/直前 \d+人/).first().waitFor();
    const after = await summary("声かけ");
    if (!(after > before)) throw new Error(`声かけが ${before}人 から ${after}人`);
    await page.getByText(/回答の経過（\d+件）/).first().waitFor();
    return `声かけ ${before}人 → ${after}人`;
  });
  await step("8 声かけの一覧に理由と根拠の条文がある", async () => {
    await tab("声かけ").click();
    await page.getByText("S0095").first().waitFor();
    const body = await page.locator("main").innerText();
    if (!/第\d+条/.test(body)) throw new Error("条文が見当たらない");
  });
  await step("9 S0095 を開くと区分別の不足と根拠がある", async () => {
    await page.getByText("S0095").first().click();
    await page.getByRole("heading", { name: "履修案", exact: true }).waitFor();
    await page.getByRole("heading", { name: /履修の記録（\d+件）/ }).waitFor();
    const body = await page.locator("main").innerText();
    if (!/第\d+条/.test(body)) throw new Error("根拠の条文が見当たらない");
  });
  await step("10 履修案の記録を読み込むと、検査を通った案と下書きが出る", async () => {
    const panel = page.locator("div").filter({ has: page.getByRole("heading", { name: "履修案", exact: true }) }).last();
    await panel.getByRole("button", { name: "記録を読み込む" }).click();
    const result = panel.locator(".plan-result");
    await result.waitFor();
    await result.getByRole("heading", { name: "声かけ文の下書き" }).waitFor();
    const text = await result.innerText();
    if (!/通過/.test(text)) throw new Error("検査に通過の表示が見当たらない");
  });

  const errors = consoleErrors.filter((text) => !/favicon/.test(text));
  if (errors.length > 0) {
    failed = true;
    say(`FAIL コンソールのエラー ${errors.length}件: ${errors.slice(0, 3).join(" / ")}`);
  } else say("PASS コンソールのエラーなし");
}

try {
  await main();
} catch (error) {
  failed = true;
  if (!log.some((line) => line.startsWith("FAIL"))) say(`FAIL ${String(error?.message ?? error).split("\n")[0]}`);
} finally {
  await cleanup();
}
say(`${failed ? "FAIL" : "PASS"} README の手順（画面と記録: ${OUT.slice(ROOT.length + 1)}）`);
finish(failed ? 1 : 0);
