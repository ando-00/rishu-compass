// 追加の監査（2026-11-05）の R-1。前期の学生の履修案の検査は、履修条件が未確定か未達で記録から外した
// 今年度の登録も、上限と時間割に数える。未回答で通った案が、回答のあとに不合格になってはいけない。
// 同梱の学生は全員後期なので、前期の学生をここで作る。
import { describe, expect, it } from "vitest";
import { sakuradaiCourses } from "../../data/fictional/sakuradai/courses";
import { goldRules } from "../../data/fictional/sakuradai/gold-rules";
import { checkPlan, evaluateStudent, type Answers, type PlanEntry, type Student } from "../../engine";
import { reviewPlan } from "../advisor/advise";
import { planningTarget } from "../advisor/tools";

const READINGS: [string, Answers][] = [
  ["未回答", {}],
  ["修得した全単位を数える", { "seminar-credit-basis": "earned", "retake-disqualified-scope": "include" }],
  ["卒業に数える単位だけを数える", { "seminar-credit-basis": "countable", "retake-disqualified-scope": "exclude" }],
];
const ANSWERED = READINGS[1]![1];

const creditsOf = (name: string) => sakuradaiCourses.find((course) => course.name === name)!.credits;
const termOf = (name: string) => sakuradaiCourses.find((course) => course.name === name)!.offeredIn ?? "前期";

function check(student: Student, plan: PlanEntry[], answers: Answers) {
  const input = { rules: goldRules, courses: sakuradaiCourses, student, answers };
  const { target, assumptions } = planningTarget(input);
  return checkPlan(goldRules, sakuradaiCourses, target, plan, answers, assumptions);
}

// 配当年次の低い順に、合計が count 単位になるまで科目を取る（演習と他学科は除く）
function take(count: number, skip: Set<string>, term?: "前期" | "後期") {
  const names: string[] = [];
  let sum = 0;
  for (const course of [...sakuradaiCourses].sort((a, b) => a.assignedYear - b.assignedYear)) {
    if (sum >= count) break;
    if (skip.has(course.name) || course.name.startsWith("演習") || course.groups.includes("他学科")) continue;
    if (term && course.offeredIn !== term) continue;
    if (sum + course.credits > count) continue;
    names.push(course.name);
    sum += course.credits;
  }
  if (sum !== count) throw new Error(`${count}単位ちょうどにならない: ${sum}`);
  return names;
}

// 4年次前期。演習Ⅰ（通年4単位）と前期の科目を履修中。earned は2年次までに修得した科目
function springStudent(earned: string[]): Student {
  const spring = take(12, new Set(earned), "前期");
  return {
    id: "X0001",
    admissionYear: 2023,
    studentYear: 4,
    currentTerm: "前期",
    yearsEnrolled: 4,
    specialStatuses: [],
    expectedGraduation: { studentYear: 4, term: "後期" },
    records: [
      ...earned.map((name) => ({ course: name, studentYear: 2, term: termOf(name), result: "passed" as const })),
      { course: "演習Ⅰ", studentYear: 4, term: "通年" as const, result: "enrolled" as const },
      ...spring.map((name) => ({ course: name, studentYear: 4, term: "前期" as const, result: "enrolled" as const })),
    ],
  };
}

const REQUIRED = ["基礎演習", "ミクロ経済学Ⅰ", "マクロ経済学Ⅰ", "統計学Ⅰ"];
// 60単位を修得していて、どちらの読み方でも演習Ⅰの条件を満たす学生
const ready = springStudent([...REQUIRED, ...take(52, new Set(REQUIRED))]);
// 58単位で、どちらの読み方でも条件を満たさない学生
const short = springStudent([...REQUIRED, ...take(50, new Set(REQUIRED))]);

// 後期に、時限が重ならず上限にも収まる案を、入るだけ入れる（演習Ⅰを数える読み方で検査する）
function fullAutumnPlan(student: Student) {
  const taken = new Set(student.records.map(({ course }) => course));
  const plan: PlanEntry[] = [];
  for (const course of sakuradaiCourses) {
    if (course.offeredIn !== "後期" || taken.has(course.name) || course.assignedYear > student.studentYear) continue;
    const next = [...plan, { course: course.name, term: "後期" as const }];
    if (check(student, next, ANSWERED).status === "passed") plan.push(next.at(-1)!);
  }
  return plan;
}

// 上の案に、時限は重ならないが上限だけを超える科目を1つ足す
function overPlan(student: Student, full: PlanEntry[]) {
  const used = new Set([...student.records.map(({ course }) => course), ...full.map(({ course }) => course)]);
  for (const course of sakuradaiCourses) {
    if (course.offeredIn !== "後期" || used.has(course.name) || course.assignedYear > student.studentYear) continue;
    const next = [...full, { course: course.name, term: "後期" as const }];
    const codes = check(student, next, ANSWERED).issues.map(({ code }) => code);
    if (codes.length === 1 && codes[0] === "OVER_LIMIT") return next;
  }
  throw new Error("上限だけを超える案を作れない");
}

describe("前期の学生の履修案の検査（R-1）", () => {
  const gate = (student: Student, answers: Answers) =>
    evaluateStudent(goldRules, sakuradaiCourses, student, answers).judgments.find(({ ruleId }) => ruleId === "gate-seminar")?.status;

  it("前提: 演習Ⅰの条件は、未回答では職員確認。60単位の学生は答えれば充足、58単位の学生は充足にならない", () => {
    expect(gate(ready, {})).toBe("needs_staff");
    expect(gate(short, {})).toBe("needs_staff");
    for (const [, answers] of READINGS.slice(1)) {
      expect(gate(ready, answers)).toBe("satisfied");
      expect(gate(short, answers)).not.toBe("satisfied");
    }
  });

  describe.each([
    ["60単位の学生", ready],
    ["58単位の学生", short],
  ])("%s", (_, student) => {
    const full = fullAutumnPlan(student);
    const over = overPlan(student, full);
    const autumnCredits = (plan: PlanEntry[]) => plan.reduce((sum, { course }) => sum + creditsOf(course), 0);

    it("前提: 入るだけ入れた後期の案は22単位で、演習Ⅰの半分の2単位と合わせて上限の24単位", () => {
      expect(autumnCredits(full)).toBe(22);
      expect(autumnCredits(over)).toBe(24);
    });

    it.each(READINGS)("%s: 上限いっぱいの案は通る", (_reading, answers) => {
      expect(check(student, full, answers).status).toBe("passed");
    });

    it.each(READINGS)("%s: 1科目多い案は、演習Ⅰの半分を数えて後期26単位になり、上限を超える", (_reading, answers) => {
      const result = check(student, over, answers);
      expect(result.status).toBe("failed");
      expect(result.issues.find(({ code }) => code === "OVER_LIMIT")?.message).toContain("後期の履修単位 26");
    });

    it.each(READINGS)("%s: Claude の案の検査も同じ前提なので、上限を超える案を画面に返さない", (_reading, answers) => {
      const input = { rules: goldRules, courses: sakuradaiCourses, student, answers };
      expect(reviewPlan(input, over, "下書き", 1, [])).toBeNull();
      expect(reviewPlan(input, full, "下書き", 1, [])?.status).toBe("passed");
    });
  });
});

// 固定のシードで学生を作り、未回答で通った案が、どの回答でも不合格にならないことを確かめる
describe("ランダムな学生（前期を含む）の履修案の検査（R-1）", () => {
  let seed = 20261105;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // 1・2年次配当の科目は配当年次に多めに修得させ、3年次以降の科目は少なめにして後期の候補を残す。
  // 3年次以降の前期の学生の半分強に、演習Ⅰ（通年）を今年度に登録させる
  function randomStudent(index: number): Student {
    const studentYear = 2 + Math.floor(random() * 3);
    const currentTerm = random() < 0.7 ? "前期" : "後期";
    const early = 0.6 + random() * 0.4;
    const records: Student["records"] = [];
    for (const course of sakuradaiCourses) {
      if (course.assignedYear > studentYear || course.name.startsWith("演習")) continue;
      const term = course.offeredIn ?? "前期";
      const year = course.assignedYear <= 2 ? course.assignedYear : studentYear;
      if (random() > (course.assignedYear <= 2 ? early : 0.3)) continue;
      const ongoing = year === studentYear && (currentTerm === "前期" || term !== "前期");
      if (ongoing) {
        // 今年度の登録は、前期と通年だけにして後期を空けておく
        if (term !== "後期" && random() < 0.5) records.push({ course: course.name, studentYear: year, term, result: "enrolled" });
      } else {
        records.push({ course: course.name, studentYear: year, term, result: random() < 0.05 ? "failed" : "passed" });
      }
    }
    if (studentYear >= 3 && currentTerm === "前期" && random() < 0.6) {
      records.push({ course: "演習Ⅰ", studentYear, term: "通年", result: "enrolled" });
    }
    return {
      id: `R${index}`,
      admissionYear: 2023,
      studentYear,
      currentTerm,
      yearsEnrolled: studentYear,
      specialStatuses: [],
      expectedGraduation: { studentYear: 4, term: "後期" },
      records,
    };
  }

  // 未回答の検査で通るあいだ、科目を足していく（上限いっぱいの案になる）
  function greedyPlan(student: Student) {
    const { target } = planningTarget({ rules: goldRules, courses: sakuradaiCourses, student, answers: {} });
    const taken = new Set(target.records.filter(({ result }) => result !== "failed").map(({ course }) => course));
    const plan: PlanEntry[] = [];
    for (const course of sakuradaiCourses) {
      if (taken.has(course.name) || course.assignedYear > target.studentYear || !course.offeredIn) continue;
      if (student.currentTerm === "前期" && course.offeredIn !== "後期") continue;
      const next = [...plan, { course: course.name, term: course.offeredIn }];
      if (check(student, next, {}).status === "passed") plan.push(next.at(-1)!);
    }
    return plan;
  }

  it("未回答で通った案は、どの回答でも不合格にならない", () => {
    const students = Array.from({ length: 60 }, (_, index) => randomStudent(index));
    const flips: string[] = [];
    let passed = 0;
    let withSeminar = 0;
    for (const student of students) {
      const plan = greedyPlan(student);
      if (plan.length === 0) continue;
      passed += 1;
      const enrolledSeminar = student.records.some(({ course, result }) => course === "演習Ⅰ" && result === "enrolled");
      if (student.currentTerm === "前期" && enrolledSeminar) withSeminar += 1;
      for (const [reading, answers] of READINGS.slice(1)) {
        const after = check(student, plan, answers);
        if (after.status === "failed") {
          flips.push(`${student.id}（${student.studentYear}年次${student.currentTerm}）${reading}: ${after.issues.map(({ message }) => message).join(" / ")}`);
        }
      }
    }
    // 空振りしないよう、案が通った学生と、演習Ⅰを履修中の前期の学生がいることを確かめる
    expect(passed).toBeGreaterThan(30);
    expect(withSeminar).toBeGreaterThan(5);
    expect(flips).toEqual([]);
  });
});
