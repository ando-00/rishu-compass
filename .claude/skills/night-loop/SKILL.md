---
name: night-loop
description: 履修コンパスの夜間ループの1周。機械検査とテストを回し、落ちていれば先に直し、docs/BACKLOG.md の「判断不要」の作業を1件進めてコミットと push をする。人の判断が要るものは進めずに記録する。定期の自動起動から呼ばれるほか、「/loop /night-loop」で繰り返せる。
---

# 夜間ループの1周

`AGENTS.md` の決まりがすべて優先する。この手順は、その決まりを1周ぶんの順番に並べたもの。

## 自動で回る仕組み

| 仕組み | 何をするか |
|---|---|
| 定期の起動（claude.ai のスケジュール） | 毎晩決まった時刻に新しいクラウドセッションを起こし、この手順を1周回させる |
| SessionStart フック | フックの場所の設定、依存の導入、浅い履歴の取得 |
| PreToolUse フック | 履歴を書き換える git 操作を止める |
| git の pre-commit フック | 鍵を止め、コードを含むコミットは、コミットされる中身で build と test を回す |
| PostToolUse フック | push のあとに CI の確認を促す |
| Stop フック | 終える前に `node scripts/audit.mjs` を回し、FAIL があれば終了を止めて直させる（3回まで。鍵の検出は止めずに人へ知らせる） |

無人で起動したときは、人に質問しない。判断が要るものは `docs/BACKLOG.md` の「人の判断」に書いて終える。やることがなければ（未着手がなく、検査に FAIL がなく、CI が緑）、何もコミットせずに短く報告して終える。

## 0. 始める前

0. 今の時刻を JST で確かめる。2026-11-08 16:00 以降なら、検査もコミットも push もせず、「提出の後なので止まった」と短く報告して終える。提出したリポジトリを締切の後に変えない
1. `git status` と `git log --oneline -5` を見る。別のセッションの変更があれば触らない
2. `git fetch origin main` のあと、遅れていれば `git merge --ff-only origin/main`。早送りできなければ止めて報告する（rebase、reset、force push はしない）
3. `git config core.hooksPath` が `.githooks` であることを確かめる

## 1. 検査（毎周）

```sh
node scripts/audit.mjs            # 速い検査。build と test を含む。約1分
```

- 最初の周と、作業を3件終えるごとに `node scripts/audit.mjs --full` を回す（clean clone、壊す検査、評価の検査し直し。約30〜60分。バックグラウンドで回してよい）
- 結果は `evals/tmp/audit/latest.md`
- CI は GitHub の MCP（`actions_list`）で origin/main の最新の結果を見る。`gh` が使えないときの代わり

## 2. 落ちていたら先に直す

順番: CI が赤 → `FAIL` → 前の周の作業の続き → 新しい作業。

- `FAIL` の原因が自分の変更でなく、別のセッションの未コミットの変更なら、直さずに記録して次へ進む
- 鍵の検出（K1〜K5）は直さずに止めて報告する。履歴を書き換えないので人が判断する
- `WARN` と `未検証` は直さなくてよい。`docs/BACKLOG.md` に足す価値があるものだけ足す
- 同じ `FAIL` を2周続けて直せなければ、ループを止めて報告する

## 3. 作業を1件進める

1. `docs/BACKLOG.md` の「判断不要」から、状態が「未着手」の一番上を選び、状態を「作業中（日時）」にする
2. 判定エンジンはテストを先に書く
3. 途中で解釈や方針の判断が要ると分かったら、作業を止める。「人の判断」に質問と選択肢を書き、その作業の状態を「止めた（理由）」にする。解釈の案を出さない
4. 終わったら状態を「済（コミット）」にする

## 4. コミットと push

1. 自分が変えたファイルだけをパスで `git add` する
2. `docs/PROGRESS.md` に1行足す。Claude Code をどう使ったかも書く（「夜間ループで」と分かるように）
3. 監査の指摘を直したら `docs/AUDIT_LOG.md` の状態も同じコミットで変える
4. `git commit`。コードを含むと、フックが `npm run build` と `npm test` を回し、落ちれば止める
5. `git push -u origin main`。pre-push フックが鍵を検査する。拒まれたら原因を確かめ、rebase と force push をしない
6. CI の結果を見る。赤なら次の周で最初に直す

## 5. 周の終わり

- 「判断不要」に未着手がなく、検査に `FAIL` もなければ、`--full` を1回回して結果を `docs/PROGRESS.md` に1行書き、ループを止める（`/loop` なら次の起床を予約しない）
- 1周の報告は短くする: 検査の要約（FAIL / WARN / 未検証 / PASS）、進めた作業、止めた作業と理由、人の判断に移したもの

## やらないこと

- Claude の API を呼ぶ評価（`npm run eval:extract`、`npm run eval:advise`、`record:*`）。費用がかかり、鍵も要る
- `data/fictional/*/gold*`、要項、`data/fictional/advice-rules.md` の変更
- `AGENTS.md` の「守ること」と `docs/AUDIT.md` の重大度の変更
- 監査のサブエージェントの回。`docs/AUDIT.md` は3回と定めている
- 公開 URL、送信の機能、学生の画面、相談チャット
- 他の作品のフォルダを読むこと
- 新しい依存の追加と更新
