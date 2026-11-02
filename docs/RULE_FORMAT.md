# ルールの書き方

要項を、判定エンジンが読める形に書き直すための説明です。型は `engine/rules.ts` にあります。

## 始め方

1. `data/fictional/example/rules.ts` を `data/fictional/sakuradai/gold-rules.ts` にコピーする
2. 1行目を `import type { RuleSet } from "../../../engine/rules";` に変える
3. `exampleRules` を `goldRules` に変え、要項を見ながら中身を書き換える

書き間違えると VS Code に赤線が出ます。`npm run build` でも確認できます。

`gold-rules.ts` を置くと、`npm run dev` の画面の「対象」に大学が増えます。コードの変更はいりません。`id` の参照先が存在しないなどの問題があると、判定を止めて、問題の一覧を画面に出します。

`gold-rules.ts` の内容は人が決めます。Claude に清書させるときは、質問と清書だけを任せ、解釈の案は出させません。Claude の共著の表示を残してコミットし、経緯を `docs/DATA.md` に書きます。

## 全体

| 項目 | 書くこと |
|---|---|
| `id` `name` | 要項の識別子と名前 |
| `admissionYears` | この要項を適用する入学年度。要項に書かれていなければ、架空の年度を決める |
| `graduation` | 卒業に必要な在学年数（`minYears`）と合計単位（`totalCredits`） |
| `categories` | 区分ごとの要件 |
| `gates` | 科目の履修条件と進級条件 |
| `loadLimits` | 履修上限 |
| `courseCountLimits` | 科目数の上限（なければ `[]`） |
| `prerequisites` | 先修条件 |
| `enrollment` | 履修の基本ルール（なければ項目ごと消す） |
| `retake` | 失格の再履修（なければ項目ごと消す） |
| `ambiguities` | 曖昧な箇所 |

## すべてのルールに共通

| 項目 | 必須 | 書くこと |
|---|---|---|
| `id` | ○ | ルールの名前。半角英数字とハイフン。重複させない |
| `clause` | ○ | 根拠の条文。画面に根拠として表示する |
| `sourceQuote` | ○ | 根拠の文。要項の原文をそのまま書く。言い換えると根拠の検査に落ちる |
| `status` | | 確定できないルールは `"needs_review"` にする。このルールの判定は「職員確認」になる |
| `when` | | 適用する学生の条件。全学生に適用するなら書かない |
| `ambiguityIds` | | 関係する曖昧箇所の `id`。未回答の間、このルールの判定は「職員確認」になる |

`when` に書けるのは、`major`（専攻）、`hasMinor`（副専攻の有無）、`minStudentYear`（この年次以上）、`minPreviousGpa`（前年度の GPA がこの値以上）です。

## categories（区分）

| 項目 | 書くこと |
|---|---|
| `name` | 区分の名前 |
| `groups` | この区分に入る科目群。`区分/小区分` の形で書く |
| `minCredits` | 最低単位 |
| `requireAll` | 指定の科目をすべて修得する区分なら `true` |
| `maxCredits` | 算入できる単位の上限 |
| `overflowTo` | 超過分の算入先の区分 `id`。算入先がなければ `null` |
| `subLimits` | 区分の一部にかかる上限。なければ書かない |

超過分の扱いは、次の3通りです。

| 要項の内容 | 書き方 |
|---|---|
| 超過分を別の区分へ移す | `overflowTo` に移す先の区分 `id` を書く |
| 超過分を卒業単位に数えない | `overflowTo: null` にして、`maxCredits` に数える上限を書く |
| 算入に上限がない | `overflowTo: null` にして、`maxCredits` を書かない |

## gates（履修条件・進級条件）

| 項目 | 書くこと |
|---|---|
| `name` | 条件の名前 |
| `target` | 科目なら `{ kind: "course", courses: [...] }`、進級なら `{ kind: "promotion", toYear: 2 }` |
| `checkAtEndOfYear` | 何年次の終わりに判定するか |
| `minCredits` | 必要な単位。なければ書かない |
| `creditBasis` | 修得した全単位で数えるなら `"earned"`、卒業に算入される単位だけなら `"countable"` |
| `requiredCourses` | 修得が必要な科目。なければ `[]` |
| `requiredMayBeEnrolled` | 必要な科目は履修中でもよいなら `true`。修得が必要なら書かない |
| `retryAfterMet` | 判定の時点で満たせなくても、後から満たせば認めるなら `true` |

## loadLimits（履修上限）

上から順に見て、条件に合う**最後のもの**を使います。通常の上限を先に、緩和の上限を後に書いてください。

| 項目 | 書くこと |
|---|---|
| `maxPerYear` | 年間の上限。なければ書かない |
| `maxPerTerm` | 学期の上限 |
| `retakeExclusion` | 上限から除く再履修。除かないなら `"none"`、不合格の科目だけなら `"failed"`、失格の科目も除くなら `"failed_or_disqualified"` |

集中講義は常に上限に含めます。通年の科目は、単位の半分を前期と後期に数えます。

## courseCountLimits（科目数の上限）

`group` の科目群を、1学期に `maxPerTerm` 科目までに制限します。

## prerequisites（先修条件）

| 項目 | 書くこと |
|---|---|
| `course` | 条件のかかる科目 |
| `conditions` | 先修条件。「ANDの組をORで並べる」形で書く（下の表） |
| `allowSameTerm` | 先修科目と同じ学期に履修してよいなら `true` |

| 要項の文 | 書き方 |
|---|---|
| Ⅰ を修得 | `[["Ⅰ"]]` |
| A または B を修得 | `[["A"], ["B"]]` |
| A かつ B を修得 | `[["A", "B"]]` |
| A または（B かつ C）を修得 | `[["A"], ["B", "C"]]` |

## enrollment（履修の基本）

| 項目 | 書くこと |
|---|---|
| `forbidBeforeAssignedYear` | 配当年次より前の履修を禁じるなら `true` |
| `forbidRetakeOfPassed` | 修得済みの科目の再履修を禁じるなら `true` |

## retake（失格の再履修）

要項に定めがなければ項目ごと消す。曖昧箇所として扱うと、未回答の間は失格の記録がある学生の該当の科目だけが職員確認になる。

| 項目 | 書くこと |
|---|---|
| `forbidDisqualified` | 失格の科目の再履修を禁じるなら `true` |

## ambiguities（曖昧な箇所）

| 項目 | 書くこと |
|---|---|
| `id` | 曖昧箇所の名前。関係するルールの `ambiguityIds` に同じ値を書く |
| `clause` | 根拠の条文 |
| `sourceQuote` | 根拠の文。要項の原文をそのまま書く |
| `question` | 職員に尋ねる質問 |
| `options` | 回答の選択肢 |

選択肢の `patches` には、その回答を選んだときに変わる値を書きます。`ruleId` のルールの `field` を `value` に変えます。今のルールと同じ値でも、選択肢ごとに必ず書いてください。

ルールの差分で表せない候補は `patches: null` にします。画面には「人数は計算できない」と出ます。回答しても判定に反映できないので、関わる判定は「職員確認」のまま残ります。`patches: []` は書かないでください。

## 形式で表せないとき

表せない要件や曖昧箇所があっても、無理に当てはめないでください。`patches` を `null` にするか、`gold-rules.ts` にコメントで残してもらえれば、形式の側を増やします。
