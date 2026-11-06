// シェルのコマンド文字列から git の呼び出しを取り出し、AGENTS.md の git の決まりに反するものを見つける。
// guard-bash.mjs と after-push.mjs が使う。正規表現でなく、引用符とヒアドキュメントを解いてから語に分ける。
// 監査の第2.5回の A25-8: `git -C`、`-c core.hooksPath=…`、短いオプションのまとめ、長いオプションの省略、
// `bash -c "…"` の中、引用符の対応ずれで、止めるべき操作を通していた。

// ヒアドキュメントの本文を外す（コミットメッセージの中の語で止めないため）
function stripHeredocs(text) {
  // 開始行の後ろに続くコマンドは残す（`<<'EOF' && git push -f`。追加の監査 R-15）
  return text.replace(/<<-?\s*(["']?)([A-Za-z_][\w]*)\1([^\n]*)\n[\s\S]*?\n\s*\2(?=\s|$)/g, (_, _quote, _tag, rest) => ` ${rest} `);
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
    } else if (ch === "\n" || ch === ";" || ch === "|" || ch === "&" || ch === "(" || ch === ")" || ch === "`") {
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
// 別のシェルの「続きを実行する」オプション
const OTHER_SHELLS = { cmd: /^\/c$/i, powershell: /^-c(ommand)?$/i, pwsh: /^-c(ommand)?$/i };

// git の呼び出しを { globals, configs, sub, args } の並びで返す。`bash -c "…"` と `eval "…"` の中も見る。
export function gitCalls(text, depth = 0) {
  const calls = [];
  for (const words of tokenize(stripHeredocs(text))) {
    for (let i = 0; i < words.length; i += 1) {
      const name = words[i].split(/[\\/]/).pop().replace(/\.exe$/i, "");
      // -lc、-ic のようにまとめた形も見る
      if (depth < 3 && SHELLS.has(name) && /^-[A-Za-z]*c[A-Za-z]*$/.test(words[i + 1] ?? "") && words[i + 2] !== undefined) {
        calls.push(...gitCalls(words[i + 2], depth + 1));
        break;
      }
      if (depth < 3 && OTHER_SHELLS[name?.toLowerCase()]?.test(words[i + 1] ?? "")) {
        calls.push(...gitCalls(words.slice(i + 2).join(" "), depth + 1));
        break;
      }
      if (depth < 3 && name === "eval" && words[i + 1] !== undefined) {
        calls.push(...gitCalls(words.slice(i + 1).join(" "), depth + 1));
        break;
      }
      if (name !== "git") continue;
      // 環境変数で渡す設定（GIT_CONFIG_KEY_0=core.hooksPath）。値は別の変数なので、書いてあれば止める
      const configs = words
        .slice(0, i)
        .filter((word) => /^GIT_CONFIG_(KEY_\d+|PARAMETERS)=.*hookspath/i.test(word))
        .map(() => "core.hookspath=環境変数");
      let j = i + 1;
      while (j < words.length && words[j].startsWith("-")) {
        const option = words[j];
        if (option === "-C" || option === "--git-dir" || option === "--work-tree" || option === "--namespace") {
          j += 2;
        } else if (option === "-c") {
          configs.push(words[j + 1] ?? "");
          j += 2;
        } else if (option.startsWith("--config-env")) {
          configs.push(option.includes("=") ? option.slice(option.indexOf("=") + 1) : (words[j + 1] ?? ""));
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
function hasLong(args, full, minLength = 4) {
  return args.some((arg) => {
    const name = arg.split("=")[0];
    return name.startsWith("--") && name.length >= Math.min(minLength, full.length) && full.startsWith(name);
  });
}

// -v、--format、--sort は一覧の形を変えるだけで、名前を渡すとブランチを作る（git 2.54 で確かめた）
const BRANCH_QUERY = ["-d", "-D", "--delete", "-l", "--list", "-a", "--all", "-r", "--remotes", "--show-current", "--contains", "--merged", "--no-merged", "--points-at", "-u", "--set-upstream-to", "--unset-upstream", "--edit-description"];

// git commit の -a。-ma は「a」というメッセージで、-m -a の -a も -m の値なので、値を取るオプションの先は見ない
function commitAll(args) {
  for (let i = 0; i < args.length; i += 1) {
    const match = /^-([A-Za-z]+)$/.exec(args[i]);
    if (!match) continue;
    const at = match[1].search(/[mFCct]/);
    const flags = at === -1 ? match[1] : match[1].slice(0, at);
    if (flags.includes("a")) return true;
    if (at === match[1].length - 1) i += 1;
  }
  return false;
}

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
      // push の -n は --dry-run なので、長い形だけを見る（追加の監査 R-4）
      if (hasLong(args, "--no-verify", 6)) return "--no-verify は使わない。push の前の鍵の検査を飛ばさない";
      return null;
    case "commit":
      if (hasLong(args, "--amend")) return "--amend は使わない（履歴を書き換えない）";
      // 同じ作業ツリーの別のセッションの変更が混ざるので止める（H35）
      if (hasLong(args, "--all", 5) || commitAll(args)) {
        return "git commit -a は使わない。自分が変えたファイルを git add でパス指定する";
      }
      if (hasShort(args, "n") || hasLong(args, "--no-verify", 6)) return "--no-verify は使わない。鍵の検査を飛ばさない";
      return null;
    case "reset":
      if (hasLong(args, "--hard", 4)) return "reset --hard は使わない。同じ作業ツリーの別のセッションの変更を消す";
      return null;
    case "filter-branch":
    case "filter-repo":
      return "履歴を書き換えない";
    case "checkout":
      if (hasShort(args, "b") || hasShort(args, "B") || hasShort(args, "t") || hasLong(args, "--track") || hasLong(args, "--orphan")) return "ブランチを切らない。main に直接コミットする";
      return null;
    case "worktree":
      // 名前を渡さなくても、worktree add は新しいブランチを作る
      if (args[0] === "add" && !args.includes("--detach") && !args.includes("-d")) return "ブランチを切らない。main に直接コミットする";
      return null;
    case "merge":
      if (hasLong(args, "--squash")) return "squash は使わない";
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
      if (args.some((arg) => arg.startsWith("--unset") || arg === "unset")) return "core.hooksPath は .githooks のままにする";
      const value = args[at + 1];
      if (value !== undefined && value !== ".githooks") return "core.hooksPath は .githooks のままにする";
      return null;
    }
    default:
      return null;
  }
}
