#!/bin/bash
# セッションの開始時に、鍵を止める git フックを有効にし、クラウドでは依存を入れる。
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}"

# AGENTS.md: clone したら core.hooksPath を .githooks にする
git config core.hooksPath .githooks

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# クラウドの clone は浅い履歴なので、鍵と持ち込みデータの検査のために全履歴を取る
if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  git fetch --quiet --unshallow origin || true
fi

# package.json と package-lock.json が前回の導入から変わったときだけ入れ直す
hashes=node_modules/.session-start.sha256
if ! sha256sum --check --status "$hashes" 2>/dev/null; then
  rm -f "$hashes"
  # npm install は古い npm で package-lock.json を書き換えるので ci を使う
  npm ci --no-audit --no-fund
  sha256sum .claude/hooks/session-start.sh package.json package-lock.json > "$hashes" || rm -f "$hashes"
fi
