# 作業ルール

履修コンパスは、履修要項の曖昧な箇所を職員に質問し、その回答を全学生の判定に反映して、声をかける相手と根拠を示す、教務職員向けの道具である。

## 守ること

- 単位の集計、要件の充足、履修案の検査、影響人数の計算に Claude を使わない。すべて `engine/` のコードで行う
- 検査に通らない履修案を画面に出さない
- 未確定のルールを確定として扱わない。未回答の曖昧箇所に関わる判定は「職員確認」を返す。ただし、進級済みの学生の進級条件は進級の事実を優先して充足とする。未確定の区分があっても、確定の区分に不足があれば、卒業要件は「不足」を返す
- 編入、休学、留学、読替、既修得認定、適用外の入学年度の学生は、全判定を「職員確認」にする
- 声かけ文は下書きにとどめる。送信機能を作らない
- 学生が使う画面と相談チャットを作らない
- 実データと職務上知り得た情報を入れない。大学のデータは `data/fictional/` の架空データだけにする
- 正解ルールの内容は人が決める。Claude は質問と清書だけを行い、解釈の案を出さない。`data/fictional/*/gold*` の作り方は `docs/DATA.md` に書く
- 既存コードを流用しない。他の作品のフォルダを読まない
- 大学名、勤務先の略称、個人名、個人のメールを、コード、データ、文書、コミットメッセージに書かない
- API キーは `.dev.vars` にだけ置く。コミットの前に `git diff --cached` を `sk-ant-` で検索する
- 履歴を書き換えない。`rebase`、`squash`、`force push` を使わない
- 公開 URL を作らない。審査員は手元で動かすので、手順を `README.md` に書き、新しいクローンで確かめる。Worker の Claude を呼ぶ経路は `ALLOW_CLAUDE=true` を明示した環境でだけ動く
- 回答者は「教務職員A」のような役割名で保存する。実名を保存しない

## 構成と依存の向き

| 場所 | 中身 |
|---|---|
| `engine/` | 判定エンジン。外部に依存しない |
| `shared/` | 画面と API が共有する型と Zod スキーマ |
| `worker/` | API（Hono）。`engine/` と `shared/` を呼ぶ |
| `src/` | 画面（React） |
| `migrations/` | D1 の表 |
| `data/fictional/` | 架空データ |
| `evals/` | 評価の実行と結果 |
| `scripts/` | 監査の道具。`audit.mjs` が機械検査を繰り返し回す |
| `.claude/` | Claude Code のフックと夜間ループの手順 |

依存は `src`・`worker` → `shared`・`engine` の向きだけにする。`engine/` から他の層を読まない。

## コマンド

| コマンド | 確認 |
|---|---|
| `npm run dev` | 開発サーバー |
| `npm run build` | 型チェックとビルド |
| `npm test` | 判定エンジンのテスト |
| `node scripts/audit.mjs` | 機械検査。`--full` で clean clone と壊す検査も回す |

## 進め方

- 判定エンジンはテストを先に書く
- UI は日本語。ステータスは色と文字を併記する

## コミットと記録

どのセッションも、次のとおりに作業の区切りごとに確認を待たずコミットする。

- 小さくコミットする。メッセージは日本語で「何をしたか」を書く
- `main` に直接コミットする。ブランチを切らない
- コードを変えたら、コミットの前に `npm run build` と `npm test` を通す。通らない状態でコミットしない
- 同じ作業ツリーで別のセッションが動く前提で進める。作業を始める前とコミットの前に `git status` と `git log` を確認する
- 自分が変えたファイルだけをパスで指定して `git add` する。`git add -A` と `git add .` を使わない
- `data/fictional/*/gold*` を清書したときは、Claude の共著の表示を残してコミットする。内容は人の回答から変えない
- 作業の区切りごとに `docs/PROGRESS.md` を更新し、同じコミットに含める。Claude Code をどの作業でどう使ったかも1行書く
- 監査の指摘を直したら、`docs/AUDIT_LOG.md` の状態を同じコミットで更新する
- リポジトリの外の仕様文書に基づく変更は、コミットメッセージと `docs/PROGRESS.md` に文書の名前と版を書く
- 区切りのコミットのあと、`docs/AUDIT.md` の鍵の検査を通して `origin/main` へ push し、CI の結果を確認する。CI が落ちたら次の機能より先に直す
- push が拒まれたら、`rebase` や `force push` をせず原因を確認する
- 鍵は `.githooks/pre-commit` と `.githooks/pre-push` でも止める。clone したら `git config core.hooksPath .githooks` を実行する。Claude Code では `.claude/settings.json` の SessionStart フックがこれを行う
- `.claude/hooks/stop-audit.mjs` が、Claude Code の作業を終える前に `node scripts/audit.mjs` を回し、FAIL があれば終了を止めて直させる。push のあとは `.claude/hooks/after-push.mjs` が CI の確認を促す
- `.claude/hooks/guard-bash.mjs` が、`git add -A`、`rebase`、`pull --rebase`、`force push`、`--amend`、`--no-verify`、`reset --hard`、ブランチの作成、フックの場所の変更を止め、コードを含むコミットの前に `npm run build` と `npm test` を回す。事例は `scripts/__tests__/hooks.test.mjs` にある
- ビルドで `.dev.vars` が `dist/` にコピーされる。`.dev.vars` がある環境の `dist/` を共有も提出もしない
