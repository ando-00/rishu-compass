import { describe, expect, it } from "vitest";
import { exampleCourses } from "../../data/fictional/example/courses";
import { exampleRules } from "../../data/fictional/example/rules";
import { sakuradaiCourses } from "../../data/fictional/sakuradai/courses";
import { goldRules as sakuradaiRules } from "../../data/fictional/sakuradai/gold-rules";
import { sakuradaiStudents } from "../../data/fictional/sakuradai/students";
import type { Answers } from "../model";
import { checkPlan, unavailableCourses } from "../plan";
import { disqualified, enrolled, failed, makeStudent, passed } from "./helpers";

// B41: 履修案の検査の候補から、検査で必ず落ちる科目（修得済み、履修中、失格の再履修）を外す
const ANSWERED: Answers = { "ambiguity-seminar-credits": "include" };
const RETAKE = "retake-disqualified-scope";

function names(list: ReturnType<typeof unavailableCourses>) {
  return list.map(({ course }) => course);
}

describe("unavailableCourses（履修案の候補から外す科目。B41）", () => {
  const student = makeStudent({
    studentYear: 2,
    currentTerm: "前期",
    records: [...passed(["入門A"]), ...failed(["入門B"]), ...enrolled(["基礎C"], 2)],
  });

  it("第13条で再び履修できない修得済みの科目を外し、理由に検査と同じ文を添える", () => {
    const list = unavailableCourses(exampleRules, exampleCourses, student, ANSWERED);
    expect(list).toContainEqual({ course: "入門A", message: "入門A は修得済みです。" });
  });

  it("履修中の科目を外す", () => {
    expect(names(unavailableCourses(exampleRules, exampleCourses, student, ANSWERED))).toContain("基礎C");
  });

  it("不合格の科目は再び履修できるので残す", () => {
    expect(names(unavailableCourses(exampleRules, exampleCourses, student, ANSWERED))).not.toContain("入門B");
  });

  it("記録のない科目は外さない", () => {
    expect(names(unavailableCourses(exampleRules, exampleCourses, student, ANSWERED))).toEqual(["入門A", "基礎C"]);
  });

  it("修得済みの再履修を禁じない要項なら、修得済みの科目も外さない", () => {
    const rules = { ...exampleRules, enrollment: { ...exampleRules.enrollment!, forbidRetakeOfPassed: false } };
    expect(names(unavailableCourses(rules, exampleCourses, student, ANSWERED))).not.toContain("入門A");
  });

  describe("失格の科目は第13条の回答に従う", () => {
    const course = sakuradaiCourses.find(({ assignedYear }) => assignedYear === 1)!.name;
    const target = makeStudent({ studentYear: 2, currentTerm: "前期", records: disqualified([course]) });

    it("未回答なら外さない（検査が職員確認を出す）", () => {
      expect(names(unavailableCourses(sakuradaiRules, sakuradaiCourses, target, {}))).not.toContain(course);
    });

    it("「含む（再び履修できる）」なら外さない", () => {
      const list = unavailableCourses(sakuradaiRules, sakuradaiCourses, target, { [RETAKE]: "include" });
      expect(names(list)).not.toContain(course);
    });

    it("「含まない（再び履修できない）」なら外す", () => {
      const list = unavailableCourses(sakuradaiRules, sakuradaiCourses, target, { [RETAKE]: "exclude" });
      expect(list).toContainEqual({ course, message: `${course} は失格のため再び履修できません。` });
    });
  });

  it("全判定を職員確認にする学生（編入など）は、候補から外さない", () => {
    const transfer = { ...student, specialStatuses: ["編入" as const] };
    expect(unavailableCourses(exampleRules, exampleCourses, transfer, ANSWERED)).toEqual([]);
  });

  it("さくら台の全学生で、外した科目は検査で必ず落ち、残した科目は修得済み・失格の理由で落ちない", () => {
    const answers = { [RETAKE]: "exclude" };
    const codes = ["ALREADY_EARNED", "DISQUALIFIED_RETAKE"];
    for (const each of sakuradaiStudents.slice(0, 30)) {
      const removed = new Set(names(unavailableCourses(sakuradaiRules, sakuradaiCourses, each, answers)));
      for (const { name, offeredIn } of sakuradaiCourses) {
        const plan = [{ course: name, term: offeredIn ?? ("前期" as const) }];
        const { issues } = checkPlan(sakuradaiRules, sakuradaiCourses, each, plan, answers);
        const blocked = issues.some((issue) => issue.course === name && codes.includes(issue.code));
        expect(blocked, `${each.id} ${name}`).toBe(removed.has(name));
      }
    }
  });
});
