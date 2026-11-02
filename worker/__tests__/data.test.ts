import { describe, expect, it } from "vitest";
import { exampleCourses } from "../../data/fictional/example/courses";
import { exampleRules } from "../../data/fictional/example/rules";
import { exampleStudents } from "../../data/fictional/example/students";
import { kamomeCourses } from "../../data/fictional/kamome/courses";
import { kamomeStudents } from "../../data/fictional/kamome/students";
import { sakuradaiCourses } from "../../data/fictional/sakuradai/courses";
import { sakuradaiStudents } from "../../data/fictional/sakuradai/students";
import { generateStudents } from "../../data/fictional/students";
import { validateRuleSet, type Course, type Student } from "../../engine";

const datasets: [string, Course[], Student[]][] = [
  ["見本", exampleCourses, exampleStudents],
  ["さくら台", sakuradaiCourses, sakuradaiStudents],
  ["かもめ", kamomeCourses, kamomeStudents],
];

describe("科目データ", () => {
  it("さくら台の科目数と単位数が要項の科目表と合う", () => {
    expect(sakuradaiCourses).toHaveLength(76);
    expect(sakuradaiCourses.reduce((sum, course) => sum + course.credits, 0)).toBe(156);
  });

  it("かもめの科目数と単位数が手引きの科目表と合う", () => {
    expect(kamomeCourses).toHaveLength(85);
    expect(kamomeCourses.reduce((sum, course) => sum + course.credits, 0)).toBe(174);
  });
});

describe("第6条の読み方で判定が変わる型", () => {
  const credits = new Map(sakuradaiCourses.map((course) => [course.name, course]));
  const boundary = sakuradaiStudents.filter((student) => {
    const passed = student.records.filter((r) => r.result === "passed" && r.studentYear <= 2);
    const earned = passed.reduce((sum, r) => sum + (credits.get(r.course)?.credits ?? 0), 0);
    const outside = passed.filter((r) => credits.get(r.course)?.groups.includes("他学科"));
    return student.studentYear >= 3 && earned >= 60 && earned <= 61 && outside.length === 6;
  });

  it("修得60〜61単位、うち他学科12単位の3年生を一定数入れる", () => {
    expect(boundary.length).toBeGreaterThanOrEqual(5);
  });

  it("仕様の指定必修を修得している", () => {
    for (const student of boundary) {
      const passed = new Set(student.records.filter((r) => r.result === "passed").map((r) => r.course));
      for (const name of ["基礎演習", "ミクロ経済学Ⅰ", "マクロ経済学Ⅰ", "統計学Ⅰ"]) {
        expect(passed.has(name)).toBe(true);
      }
    }
  });
});

describe("見本のルール", () => {
  it("見本の科目データと参照が合う", () => {
    expect(validateRuleSet(exampleRules, exampleCourses)).toEqual([]);
  });
});

describe.each(datasets)("%sの学生データ", (_, courses, students) => {
  const names = new Set(courses.map((course) => course.name));

  it("学生の id が重複しない", () => {
    expect(new Set(students.map((student) => student.id)).size).toBe(students.length);
  });

  it("履修記録の科目がすべて科目データにある", () => {
    const records = students.flatMap((student) => student.records);
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((record) => names.has(record.course))).toBe(true);
  });

  it("同じ科目を二度修得していない", () => {
    for (const student of students) {
      const passed = student.records.filter((record) => record.result === "passed");
      expect(new Set(passed.map((record) => record.course)).size).toBe(passed.length);
    }
  });

  it("学生に氏名の項目がない", () => {
    for (const student of students) {
      expect(Object.keys(student).filter((key) => /name|mail|phone/i.test(key))).toEqual([]);
    }
  });

  it("特別な状態の学生と適用外の入学年度の学生を含む", () => {
    expect(students.some((student) => student.specialStatuses.length > 0)).toBe(true);
    const inRange = (student: Student) => student.admissionYear === 2027 - student.studentYear;
    expect(students.some((student) => !inRange(student))).toBe(true);
  });
});

describe("generateStudents", () => {
  it("同じ設定からは同じ学生を作る", () => {
    const config = {
      prefix: "T",
      seed: 1,
      count: 12,
      firstYearAdmission: 2026,
      courses: exampleCourses,
      loadByYear: [8, 8, 8, 4] as [number, number, number, number],
      requiredGroups: () => ["基礎/必修"],
      electiveGroups: () => ["甲専攻/選択"],
    };
    expect(generateStudents(config)).toEqual(generateStudents(config));
  });
});
