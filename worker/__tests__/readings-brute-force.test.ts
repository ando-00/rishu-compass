import { describe, expect, it } from "vitest";
import { exampleCourses } from "../../data/fictional/example/courses";
import { exampleRules } from "../../data/fictional/example/rules";
import { exampleStudents } from "../../data/fictional/example/students";
import { goldRules as kamomeGold } from "../../data/fictional/kamome/gold-rules";
import { goldRules as sakuradaiGold } from "../../data/fictional/sakuradai/gold-rules";
import { evaluatePrepared, prepareRules, validateRuleSet, type Answers, type Course, type RuleSet, type Student } from "../../engine";
import { findRecordedProposal, findSource } from "../datasets";
import { acceptRules, needsReviewIds } from "../ruleSets";

// 未確定のルールを確定として扱わない（AGENTS.md）。未回答のまま職員確認以外の判定を出したなら、
// その判定は、どの読み方で回答しても同じ状態か、職員確認になる。第2.5回で監査役が手元で確かめた総当たりを、
// 正解ルールに加え、見本と Claude の変換の記録（確定の前と、要確認を全て認めて確定した後）でも回す。
// 読み方は、各曖昧箇所の各候補を1件だけ答えたものと、全ての曖昧箇所を先頭の候補、最後の候補で答えたもの。

function readings(rules: RuleSet): Answers[] {
  const single = rules.ambiguities.flatMap((ambiguity) =>
    ambiguity.options.map((option) => ({ [ambiguity.id]: option.id })),
  );
  const all = (pick: "first" | "last") =>
    Object.fromEntries(
      rules.ambiguities.map((ambiguity) => [ambiguity.id, (pick === "first" ? ambiguity.options[0] : ambiguity.options.at(-1))!.id]),
    );
  return rules.ambiguities.length > 0 ? [...single, all("first"), all("last")] : [];
}

function mismatches(rules: RuleSet, courses: Course[], students: Student[]) {
  const base = prepareRules(rules, courses, {});
  const resolved = readings(rules).map((answers) => ({ answers, prepared: prepareRules(rules, courses, answers) }));
  const found: string[] = [];
  let compared = 0;
  for (const student of students) {
    const unanswered = evaluatePrepared(base, student).judgments.filter(({ status }) => status !== "needs_staff");
    for (const { answers, prepared } of resolved) {
      const judgments = evaluatePrepared(prepared, student).judgments;
      for (const judgment of unanswered) {
        const other = judgments.find(({ ruleId }) => ruleId === judgment.ruleId);
        compared += 1;
        if (!other || other.status === judgment.status || other.status === "needs_staff") continue;
        found.push(`${student.id} ${judgment.ruleId}: 未回答 ${judgment.status}、${JSON.stringify(answers)} で ${other.status}`);
      }
    }
  }
  return { found, compared };
}

const recorded = (id: string) => {
  const proposal = findRecordedProposal(id);
  if (!proposal) throw new Error(`記録がありません: ${id}`);
  return proposal.rules;
};

const cases: [string, RuleSet, Course[], Student[]][] = [
  ["さくら台の正解ルール", sakuradaiGold, findSource("sakuradai")!.courses, findSource("sakuradai")!.students],
  ["かもめの正解ルール", kamomeGold, findSource("kamome")!.courses, findSource("kamome")!.students],
  ["見本", exampleRules, exampleCourses, exampleStudents],
  ...(["sakuradai", "kamome"] as const).flatMap((id): [string, RuleSet, Course[], Student[]][] => {
    const { courses, students } = findSource(id)!;
    const rules = recorded(id);
    return [
      [`${id} の変換の記録（確定前）`, rules, courses, students],
      [`${id} の変換の記録（要確認を全て認めて確定）`, acceptRules(rules, needsReviewIds(rules)), courses, students],
    ];
  }),
];

describe.each(cases)("%s", (_, rules, courses, students) => {
  it("ルールの検査に通る（通らなければ判定に使われない）", () => {
    expect(validateRuleSet(rules, courses)).toEqual([]);
  });

  it("未回答のまま出した判定は、どの読み方でも同じ状態か職員確認になる", () => {
    const { found, compared } = mismatches(rules, courses, students);
    expect(compared).toBeGreaterThan(0);
    expect(found).toEqual([]);
  });
});
