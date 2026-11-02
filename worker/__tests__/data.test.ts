import { describe, expect, it } from "vitest";
import { exampleCourses } from "../../data/fictional/example/courses";
import { exampleRules } from "../../data/fictional/example/rules";
import { exampleStudents } from "../../data/fictional/example/students";
import { kamomeCourses } from "../../data/fictional/kamome/courses";
import { kamomeStudents } from "../../data/fictional/kamome/students";
import { sakuradaiCourses } from "../../data/fictional/sakuradai/courses";
import { sakuradaiEvalStudents } from "../../data/fictional/sakuradai/eval-students";
import { sakuradaiStudents } from "../../data/fictional/sakuradai/students";
import { generateStudents } from "../../data/fictional/students";
import { validateRuleSet, type Course, type CourseRecord, type Student } from "../../engine";

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

describe.each([
  ["さくら台", sakuradaiCourses, ["月", "火", "水", "木", "金"], 5],
  ["かもめ", kamomeCourses, ["月", "火", "水", "木", "金", "土"], 6],
] as const)("%sの開講学期と時間割", (_, courses, days, periods) => {
  const required = courses.filter((c) => c.groups.some((group) => group.endsWith("/必修")));
  const termsOf = (course: Course): (string | undefined)[] =>
    course.offeredIn === "通年" ? ["前期", "後期"] : [course.offeredIn];

  it("すべての科目に開講学期と概要があり、集中講義のほかは時限がある", () => {
    for (const course of courses) {
      expect(course.offeredIn).toBeDefined();
      expect(course.summary).toMatch(/^.{5,30}$/);
      expect(course.slots ?? []).toHaveLength(course.intensive ? 0 : 1);
    }
  });

  it("時限が大学の時間割の範囲に収まる", () => {
    for (const slot of courses.flatMap((course) => course.slots ?? [])) {
      expect(days).toContain(slot.day);
      expect(slot.period).toBeGreaterThanOrEqual(1);
      expect(slot.period).toBeLessThanOrEqual(periods);
    }
  });

  it("必修どうしは、再履修があるので配当年次にかかわらず時限が重ならない", () => {
    for (const course of required) {
      for (const other of required) {
        if (course === other) continue;
        if (!termsOf(course).some((term) => termsOf(other).includes(term))) continue;
        const [a, b] = [course.slots?.[0], other.slots?.[0]];
        expect(`${a?.day}${a?.period}`).not.toBe(`${b?.day}${b?.period}`);
      }
    }
  });

  it("「○○Ⅰ」は「○○Ⅱ」より前の学期にある", () => {
    for (const second of courses.filter((course) => course.name.endsWith("Ⅱ"))) {
      const first = courses.find((course) => course.name === `${second.name.slice(0, -1)}Ⅰ`);
      if (first?.offeredIn === "通年") continue;
      expect(first?.offeredIn).toBe("前期");
      expect(second.offeredIn).toBe("後期");
    }
  });
});

describe("かもめのクォーターの科目", () => {
  it("別のクォーターの科目を同じ時限に置く", () => {
    const quarters = kamomeCourses.flatMap((course) =>
      (course.slots ?? []).filter((slot) => slot.quarter).map((slot) => ({ course, slot })),
    );
    expect(quarters.length).toBeGreaterThan(0);
    for (const { course, slot } of quarters.filter(({ slot }) => slot.quarter === 1)) {
      const partner = quarters.find(
        (other) =>
          other.slot.quarter === 2 &&
          other.slot.day === slot.day &&
          other.slot.period === slot.period &&
          other.course.offeredIn === course.offeredIn,
      );
      expect(partner).toBeDefined();
    }
  });
});

describe("さくら台の評価用の学生", () => {
  const courseOf = (name: string) => sakuradaiCourses.find((course) => course.name === name);
  const creditsOf = (record: CourseRecord) => courseOf(record.course)?.credits ?? 0;

  describe.each(sakuradaiEvalStudents)("$type", ({ student }) => {
    it("履修記録が開講学期と配当年次に合う", () => {
      for (const { course, term, studentYear } of student.records) {
        expect(courseOf(course)?.offeredIn, course).toBe(term);
        expect(courseOf(course)?.assignedYear, course).toBeLessThanOrEqual(studentYear);
      }
    });

    it("同じ科目を二度修得せず、先修科目を前の学期までに修得している", () => {
      const passed = student.records.filter((record) => record.result !== "failed");
      expect(new Set(passed.map((record) => record.course)).size).toBe(passed.length);
      for (const { course, studentYear } of passed) {
        const first = course.endsWith("Ⅱ") ? `${course.slice(0, -1)}Ⅰ` : null;
        if (!first) continue;
        const done = student.records.find((r) => r.course === first && r.result === "passed");
        expect(done, course).toBeDefined();
        expect(done!.studentYear, course).toBeLessThanOrEqual(studentYear);
      }
    });

    it("学期と年間の履修上限を超えていない", () => {
      for (let year = 1; year <= student.studentYear; year += 1) {
        const inYear = student.records.filter((record) => record.studentYear === year);
        const load = (term: string) =>
          inYear
            .filter((record) => record.term === term)
            .reduce((sum, record) => sum + creditsOf(record), 0);
        const whole = load("通年") / 2;
        expect(load("前期") + whole, `${year}年前期`).toBeLessThanOrEqual(24);
        expect(load("後期") + whole, `${year}年後期`).toBeLessThanOrEqual(24);
        expect(load("前期") + load("後期") + whole * 2, `${year}年`).toBeLessThanOrEqual(48);
      }
    });
  });

  it("id が重複せず、表示用の学生と重ならない", () => {
    const ids = sakuradaiEvalStudents.map(({ student }) => student.id);
    expect(new Set(ids).size).toBe(10);
    expect(ids.filter((id) => sakuradaiStudents.some((student) => student.id === id))).toEqual([]);
  });

  it("第6条の境界の型は、2年次の終わりに修得60単位、うち他学科12単位", () => {
    const { student } = sakuradaiEvalStudents.find(({ type }) => type.startsWith("第6条"))!;
    const early = student.records.filter((r) => r.studentYear <= 2 && r.result === "passed");
    expect(early.reduce((sum, record) => sum + creditsOf(record), 0)).toBe(60);
    const outside = early.filter((r) => courseOf(r.course)?.groups.includes("他学科"));
    expect(outside.reduce((sum, record) => sum + creditsOf(record), 0)).toBe(12);
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
