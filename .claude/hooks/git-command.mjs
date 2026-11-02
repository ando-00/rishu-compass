// シェルのコマンド文字列から git の呼び出しを取り出し、AGENTS.md の git の決まりに反するものを見つける。
// guard-bash.mjs と after-push.mjs が使う。正規表現でなく、引用符とヒアドキュメントを解いてから語に分ける。
// 監査の第2.5回の A25-8: `git -C`、`-c core.hooksPath=…`、短いオプションのまとめ、長いオプションの省略、
// `bash -c "…"` の中、引用符の対応ずれで、止めるべき操作を通していた。

// ヒアドキュメントの本文を外す（コミットメッセージの中の語で止めないため）
function stripHeredocs(text) {
  return text.replace(/<<-?\s*(["']?)([A-Za-z_][\w]*)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\s|$)/g, " ");
}

// 1つのコマンド行を、区切り（; && || | 改行）ごとの語の並びにする。引用符の中は1語として残す。
export function tokenize(text) {
  const segments = [];
  let words = [];
  let word = "";
  let quoted = false;
  const pushWord = () => {
    if (word !== "" || quoted) words.push(word);
    word = "";
    quoted = false;
  };
  const pushSegment = () => {
    pushWord();
    if (words.length > 0) segments.push(words);
    words = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      word += end === -1 ? text.slice(i + 1) : text.slice(i + 1, end);
      quoted = true;
      i = end === -1 ? text.length : end;
    } else if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') {
        if (text[j] === "\\" && j + 1 < text.length) {
          word += text[j + 1];
          j += 2;
        } else {
          word += text[j];
          j += 1;
        }
      }
      quoted = true;
      i = j;
    } else if (ch === "\\" && i + 1 < text.length) {
      word += text[i + 1];
      i += 1;
    } else if (ch === "\n" || ch === ";" || ch === "|" || ch === "&" || ch === "(" || ch === ")") {
      pushSegment();
    } else if (ch === " " || ch === "\t") {
      pushWord();
    } else {
      word += ch;
    }
  }
  pushSegment();
  return segments;
}

const SHELLS = new Set(["bash", "sh", "zsh", "dash"]);

// git の呼び出しを { globals, configs, sub, args } の並びで返す。`bash -c "…"` と `eval "…"` の中も見る。
export function gitCalls(text, depth = 0) {
  const calls = [];
  for (const words of tokenize(stripHeredocs(text))) {
    for (let i = 0; i < words.length; i += 1) {
      const name = words[i].split("/").pop();
      if (depth < 3 && SHELLS.has(name) && words[i + 1] === "-c" && words[i + 2] !== undefined) {
        calls.push(...gitCalls(words[i + 2], depth + 1));
        break;
      }
      if (depth < 3 && name === "eval" && words[i + 1] !== undefined) {
        calls.push(...gitCalls(words.slice(i + 1).join(" "), depth + 1));
        break;
      }
      if (name !== "git") continue;
      const configs = [];
      let j = i + 1;
      while (j < words.length && words[j].startsWith("-")) {
        const option = words[j];
        if (option === "-C" || option === "--git-dir" || option === "--work-tree" || option === "--namespace") {
          j += 2;
        } else if (option === "-c") {
          configs.push(words[j + 1] ?? "");
          j += 2;
        } else if (option.startsWith("--config-env")) {
          configs.push(option);
          j += option.includes("=") ? 1 : 2;
        } else {
          j += 1;
        }
      }
      calls.push({ configs, sub: words[j] ?? "", args: words.slice(j + 1) });
      break;
    }
  }
  return calls;
}

// 短いオプションのまとめ（-uf）と、長いオプションの省略（--forc）を解く
function hasShort(args, letter) {
  return args.some((arg) => /^-[A-Za-z]+$/.test(arg) && arg.slice(1).includes(letter));
}
function hasLong(args, full, minLength = 5) {
  return args.some((arg) => {
    const name = arg.split("=")[0];
    return name.startsWith("--") && name.length >= Math.min(minLength, full.length) && full.startsWith(name);
  });
}

const BRANCH_QUERY = ["-d", "-D", "--delete", "-l", "--list", "-a", "--all", "-r", "--remotes", "-v", "-vv", "--show-current", "--contains", "--merged", "--no-merged", "--points-at", "--format", "--sort", "-u", "--set-upstream-to", "--unset-upstream", "--edit-description"];

// 決まりに反する理由を返す。反しなければ null。
export function violation({ configs, sub, args }) {
  for (const config of configs) {
    const [key, value] = config.split("=");
    if (key?.toLowerCase().endsWith("core.hookspath") && value !== ".githooks") {
      return "core.hooksPath は .githooks のままにする（-c でフックを外さない）";
    }
  }
  const positional = args.filter((arg) => !arg.startsWith("-"));
  switch (sub) {
    case "add":
      if (hasShort(args, "A") || hasLong(args, "--all") || positional.some((p) => p === "." || p === ":/" || p === ":" || p === "./")) {
        return "git add -A / git add . は使わない。自分が変えたファイルをパスで指定する";
      }
      return null;
    case "rebase":
      return "rebase は使わない（履歴を書き換えない）";
    case "pull":
      if (hasShort(args, "r") || hasLong(args, "--rebase")) return "pull --rebase は使わない（履歴を書き換えない）";
      return null;
    case "push":
      if (hasShort(args, "f") || hasLong(args, "--force") || hasLong(args, "--force-with-lease") || hasLong(args, "--force-if-includes") || positional.some((p) => p.startsWith("+"))) {
        return "force push は使わない。拒まれたら原因を確認する";
      }
      return null;
    case "commit":
      if (hasLong(args, "--amend")) return "--amend は使わない（履歴を書き換えない）";
      if (hasShort(args, "n") || hasLong(args, "--no-verify", 6)) return "--no-verify は使わない。鍵の検査を飛ばさない";
      return null;
    case "reset":
      if (hasLong(args, "--hard", 4)) return "reset --hard は使わない。同じ作業ツリーの別のセッションの変更を消す";
      return null;
    case "filter-branch":
    case "filter-repo":
      return "履歴を書き換えない";
    case "checkout":
      if (hasShort(args, "b") || hasShort(args, "B") || hasLong(args, "--orphan")) return "ブランチを切らない。main に直接コミットする";
      return null;
    case "switch":
      if (hasShort(args, "c") || hasShort(args, "C") || hasLong(args, "--create") || hasLong(args, "--force-create") || hasLong(args, "--orphan")) {
        return "ブランチを切らない。main に直接コミットする";
      }
      return null;
    case "branch":
      if (positional.length > 0 && !args.some((arg) => BRANCH_QUERY.includes(arg.split("=")[0]))) {
        return "ブランチを切らない。main に直接コミットする";
      }
      if (hasShort(args, "m") || hasShort(args, "M") || hasLong(args, "--move")) return "ブランチの名前を変えない";
      return null;
    case "config": {
      const at = args.findIndex((arg) => arg.toLowerCase() === "core.hookspath");
      if (at === -1) return null;
      if (args.some((arg) => arg.startsWith("--unset"))) return "core.hooksPath は .githooks のままにする";
      const value = args[at + 1];
      if (value !== undefined && value !== ".githooks") return "core.hooksPath は .githooks のままにする";
      return null;
    }
    default:
      return null;
  }
}
