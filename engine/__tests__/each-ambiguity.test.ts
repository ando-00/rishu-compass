import { describe, expect, it } from "vitest";
import { kamomeCourses } from "../../data/fictional/kamome/courses";
import { goldRules as kamomeRules } from "../../data/fictional/kamome/gold-rules";
import { kamomeStudents } from "../../data/fictional/kamome/students";
import { sakuradaiCourses } from "../../data/fictional/sakuradai/courses";
import { goldRules as sakuradaiRules } from "../../data/fictional/sakuradai/gold-rules";
import { sakuradaiStudents } from "../../data/fictional/sakuradai/students";
import { evaluatePrepared, exclusionReason, prepareRules } from "../evaluate";
import type { Answers, Course, Student } from "../model";
import { checkPlan, type PlanEntry } from "../plan";
import type { RuleSet } from "../rules";

// 監査の第2.5回の A25-6。全ての曖昧箇所について1件ずつ、未回答なら関係する判定が職員確認になることを確かめる。
// 例外は AGENTS.md の2つ: 進級済みの学生の進級条件と、確定の区分に不足がある学生の卒業要件の「不足」。

type School = { name: string; rules: RuleSet; courses: Course[]; students: Student[] };
const SCHOOLS: School[] = [
  { name: "さくら台", rules: sakuradaiRules, courses: sakuradaiCourses, students: sakuradaiStudents },
  { name: "かもめ", rules: kamomeRules, courses: kamomeCourses, students: kamomeStudents },
];

function allRules(rules: RuleSet) {
  return [
    rules.graduation,
    ...rules.categories,
    ...rules.gates,
    ...rules.loadLimits,
    ...rules.courseCountLimits,
    ...rules.prerequisites,
    ...(rules.enrollment ? [rules.enrollment] : []),
    ...(rules.retake ? [rules.retake] : []),
  ];
}

// 曖昧箇所に関わるルール: ambiguityIds に載るものと、選択肢の差分が書き換えるもの
function linkedRuleIds(rules: RuleSet, ambiguityId: string) {
  const ambiguity = rules.ambiguities.find((a) => a.id === ambiguityId)!;
  const ids = new Set(allRules(rules).filter((r) => r.ambiguityIds?.includes(ambiguityId)).map((r) => r.id));
  for (const option of ambiguity.options) for (const patch of option.patches ?? []) ids.add(patch.ruleId);
  return ids;
}

// この曖昧箇所だけを未回答にし、他は最初の選択肢で答える
function answersExcept(rules: RuleSet, ambiguityId: string): Answers {
  return Object.fromEntries(
    rules.ambiguities.filter((a) => a.id !== ambiguityId).map((a) => [a.id, a.options[0]!.id]),
  );
}

// 判定を持たないルール（履修上限、先修、履修の基本、科目数、失格の再履修）には、履修案の検査で確かめる案を作る
function probePlan(rules: RuleSet, courses: Course[], ruleIds: Set<string>, student: Student): PlanEntry[] {
  const names = new Set<string>();
  for (const rule of rules.prerequisites) if (ruleIds.has(rule.id)) names.add(rule.course);
  // 失格の再履修は、学生が失格した科目を案に入れたときだけ検査する
  if (rules.retake && ruleIds.has(rules.retake.id)) {
    const passed = new Set(student.records.filter((r) => r.result === "passed").map((r) => r.course));
    for (const r of student.records) if (r.result === "disqualified" && !passed.has(r.course)) names.add(r.course);
  }
  for (const rule of rules.courseCountLimits) {
    if (!ruleIds.has(rule.id)) continue;
    const inGroup = courses.find((c) => c.groups.includes(rule.group));
    if (inGroup) names.add(inGroup.name);
  }
  if (names.size === 0) names.add(courses[0]!.name);
  return [...names].map((course) => ({ course, term: courses.find((c) => c.name === course)?.offeredIn === "後期" ? "後期" : "前期" }));
}

for (const school of SCHOOLS) {
  describe(`${school.name}: 曖昧箇所ごとに、未回答なら関係する判定が職員確認になる`, () => {
    const { rules, courses, students } = school;
    const prepared0 = prepareRules(rules, courses, {});
    const normal = students.filter((s) => !exclusionReason(prepared0, s)).slice(0, 80);
    expect(normal.length).toBeGreaterThan(0);

    it.each(rules.ambiguities.map((a) => a.id))("%s", (ambiguityId) => {
      const linked = linkedRuleIds(rules, ambiguityId);
      expect(linked.size).toBeGreaterThan(0);
      const answers = answersExcept(rules, ambiguityId);
      const prepared = prepareRules(rules, courses, answers);
      expect(prepared.problem).toBeNull();
      expect(prepared.unresolved.has(ambiguityId)).toBe(true);

      let judged = 0;
      for (const student of normal) {
        const { judgments } = evaluatePrepared(prepared, student);
        for (const j of judgments) {
          if (!linked.has(j.ruleId)) continue;
          judged += 1;
          const promoted =
            j.kind === "gate" &&
            rules.gates.find((g) => g.id === j.ruleId)?.target.kind === "promotion" &&
            j.status === "satisfied";
          const shortGraduation = j.kind === "graduation" && j.status === "short" && (j.shortCategories?.length ?? 0) > 0;
          if (promoted || shortGraduation) continue;
          expect({ student: student.id, rule: j.ruleId, status: j.status, ids: j.ambiguityIds }).toMatchObject({
            status: "needs_staff",
          });
          expect(j.ambiguityIds).toContain(ambiguityId);
        }
      }
      if (judged === 0) {
        // 判定を持たないルール。履修案の検査が、違反の有無にかかわらず職員確認にすることを確かめる。
        // 検査の対象になる案を組める学生（失格の記録がある学生など）が見つかるまで順に試す
        let found = false;
        const tried: string[] = [];
        for (const student of students.filter((s) => !exclusionReason(prepared0, s))) {
          const plan = probePlan(rules, courses, linked, student);
          const { issues } = checkPlan(rules, courses, student, plan, answers);
          tried.push(`${student.id}:${issues.map((i) => i.code).join("/")}`);
          if (issues.some((i) => i.code === "PENDING_RULE" && i.ambiguityIds.includes(ambiguityId))) {
            found = true;
            break;
          }
        }
        expect({ ambiguityId, linked: [...linked], tried: tried.slice(-3) }).toMatchObject({ ambiguityId });
        expect(found).toBe(true);
      }
    });

    it.each(rules.ambiguities.filter((a) => a.options[0]!.patches !== null).map((a) => a.id))(
      "%s に答えると、その曖昧箇所では止まらなくなる",
      (ambiguityId) => {
        const answered = { ...answersExcept(rules, ambiguityId), [ambiguityId]: rules.ambiguities.find((a) => a.id === ambiguityId)!.options[0]!.id };
        const prepared = prepareRules(rules, courses, answered);
        expect(prepared.unresolved.has(ambiguityId)).toBe(false);
        for (const student of normal) {
          for (const j of evaluatePrepared(prepared, student).judgments) {
            expect(j.ambiguityIds).not.toContain(ambiguityId);
          }
        }
      },
    );
  });
}
