# ルールの書き方

要項を、判定エンジンが読める形に書き直すための説明です。型は `engine/rules.ts` にあります。

## 始め方

1. `engine/__tests__/fixtures/example-rules.ts` を `data/fictional/sakuradai/gold-rules.ts` にコピーする
2. 1行目を `import type { RuleSet } from "../../../engine/rules";` に変える
3. `exampleRules` を `goldRules` に変え、要項を見ながら中身を書き換える

書き間違えると VS Code に赤線が出ます。`npm run build` でも確認できます。

`gold-rules.ts` は人が書きます。Claude には書かせません。

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
| `ambiguities` | 曖昧な箇所 |

## すべてのルールに共通

| 項目 | 必須 | 書くこと |
|---|---|---|
| `id` | ○ | ルールの名前。半角英数字とハイフン。重複させない |
| `clause` | ○ | 根拠の条文。画面に根拠として表示する |
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
| `maxCredits` | 算入できる単位の上限。なければ書かない |
| `overflowTo` | 超過分の算入先の区分 `id`。算入しないなら `null` |
| `subLimits` | 区分の一部にかかる上限。なければ書かない |

## gates（履修条件・進級条件）

| 項目 | 書くこと |
|---|---|
| `name` | 条件の名前 |
| `target` | 科目なら `{ kind: "course", courses: [...] }`、進級なら `{ kind: "promotion", toYear: 2 }` |
| `checkAtEndOfYear` | 何年次の終わりに判定するか |
| `minCredits` | 必要な単位。なければ書かない |
| `creditBasis` | 修得した全単位で数えるなら `"earned"`、卒業に算入される単位だけなら `"countable"` |
| `requiredCourses` | 修得が必要な科目。なければ `[]` |
| `retryAfterMet` | 判定の時点で満たせなくても、後から満たせば認めるなら `true` |

## loadLimits（履修上限）

上から順に見て、条件に合う**最後のもの**を使います。通常の上限を先に、緩和の上限を後に書いてください。

| 項目 | 書くこと |
|---|---|
| `maxPerYear` | 年間の上限。なければ書かない |
| `maxPerTerm` | 学期の上限 |
| `countsRetakes` | 再履修科目を上限に含めるなら `true` |
| `countsIntensive` | 集中講義を上限に含めるなら `true` |
| `splitsYearLong` | 通年の科目の単位を前期と後期に半分ずつ数えるなら `true` |

## courseCountLimits（科目数の上限）

`group` の科目群を、1学期に `maxPerTerm` 科目までに制限します。

## prerequisites（先修条件）

| 項目 | 書くこと |
|---|---|
| `course` | 条件のかかる科目 |
| `anyOf` | 先修科目。複数書くと、どれか1つの修得で足りる |
| `allowSameTerm` | 先修科目と同じ学期に履修してよいなら `true` |

## enrollment（履修の基本）

| 項目 | 書くこと |
|---|---|
| `forbidBeforeAssignedYear` | 配当年次より前の履修を禁じるなら `true` |
| `forbidRetakeOfPassed` | 修得済みの科目の再履修を禁じるなら `true` |

## ambiguities（曖昧な箇所）

| 項目 | 書くこと |
|---|---|
| `id` | 曖昧箇所の名前。関係するルールの `ambiguityIds` に同じ値を書く |
| `clause` | 根拠の条文 |
| `question` | 職員に尋ねる質問 |
| `options` | 回答の選択肢 |

選択肢の `patches` には、その回答を選んだときに変わる値を書きます。`ruleId` のルールの `field` を `value` に変えます。

## 形式で表せないとき

表せない要件や曖昧箇所があっても、無理に当てはめないでください。`patches` を `[]` にするか、`gold-rules.ts` にコメントで残してもらえれば、形式の側を増やします。
