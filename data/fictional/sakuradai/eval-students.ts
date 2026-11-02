import type { CourseRecord, Student, Term } from "../../../engine/model";
import { ADMISSION_YEARS } from "../students";
import { sakuradaiCourses } from "./courses";

// 評価用の10名。仕様メモ v1 第3節の型ごとに履修記録を組んだ。
// 正解（不足単位、伝える要点、職員に回すか）は作り手が書くのでここには持たない。
// ルール変換の修正に使わない。画面の対象にも入れない。

const BASIC_REQUIRED = ["大学基礎論", "情報リテラシー", "英語Ⅰ", "英語Ⅱ"];
const BASIC_SELECTIVE = ["日本語表現", "数学基礎", "統計リテラシー"];
const BASIC_ELECTIVE = ["心理学入門", "社会学入門", "歴史学入門", "文学入門", "生物学入門"];
const MAJOR_FIRST = ["基礎演習", "経済学入門", "ミクロ経済学Ⅰ", "マクロ経済学Ⅰ", "統計学Ⅰ"];
const MAJOR_SECOND = ["ミクロ経済学Ⅱ", "マクロ経済学Ⅱ", "統計学Ⅱ", "経済史"];
const MAJOR_THIRD = ["計量経済学", "演習Ⅰ"];
const SELECTIVE = [
  "財政学Ⅰ",
  "金融論Ⅰ",
  "国際経済学Ⅰ",
  "労働経済学",
  "産業組織論",
  "公共経済学",
  "経済政策論",
  "地域経済論",
];
const ELECTIVE_SECOND = [
  "経済数学",
  "経済思想史",
  "社会保障論",
  "農業経済論",
  "交通経済論",
  "都市経済論",
  "開発経済学",
  "行動経済学",
  "ゲーム理論",
  "情報経済論",
  "消費者行動論",
  "経済地理",
  "人口経済論",
  "経済法",
  "データ分析入門",
];
const ELECTIVE_THIRD = [
  "財政学Ⅱ",
  "金融論Ⅱ",
  "国際経済学Ⅱ",
  "アジア経済論",
  "欧州経済論",
  "米国経済論",
  "経済統計",
  "経済時事研究",
  "政策分析",
  "企業金融論",
  "国際金融論",
  "観光経済論",
  "医療経済論",
];
const OUTSIDE = ["経営学入門", "会計学入門", "マーケティング論", "経営戦略論", "組織論", "簿記"];

const YEAR_ONE = [...BASIC_REQUIRED, ...BASIC_SELECTIVE, ...BASIC_ELECTIVE, ...MAJOR_FIRST];

type YearPlan = { taken: string[]; failed?: string[] };

function recordsOf(plans: YearPlan[], studentYear: number, currentTerm: Term): CourseRecord[] {
  return plans.flatMap(({ taken, failed = [] }, index) => {
    const year = index + 1;
    return [...taken, ...failed].map((course) => {
      const term = sakuradaiCourses.find(({ name }) => name === course)?.offeredIn ?? "前期";
      const settled = year < studentYear || (term === "前期" && currentTerm === "後期");
      if (!settled) return { course, studentYear: year, term, result: "enrolled" as const };
      const result = failed.includes(course) ? ("failed" as const) : ("passed" as const);
      return { course, studentYear: year, term, result };
    });
  });
}

function evalStudent(
  number: number,
  studentYear: number,
  plans: YearPlan[],
  overrides: Partial<Student> = {},
): Student {
  const currentTerm = overrides.currentTerm ?? "後期";
  return {
    id: `E${String(number).padStart(4, "0")}`,
    admissionYear: ADMISSION_YEARS[4 - studentYear]!,
    studentYear,
    currentTerm,
    yearsEnrolled: studentYear,
    expectedGraduation: { studentYear: 4, term: "後期" },
    previousGpa: 2.6,
    specialStatuses: [],
    records: recordsOf(plans, studentYear, currentTerm),
    ...overrides,
  };
}

const ON_TRACK_SECOND: YearPlan = {
  taken: [...MAJOR_SECOND, ...SELECTIVE, ...ELECTIVE_SECOND.slice(0, 10)],
};
const ON_TRACK_THIRD: YearPlan = {
  taken: [...MAJOR_THIRD, ...ELECTIVE_SECOND.slice(10), ...ELECTIVE_THIRD.slice(0, 8)],
};

export const sakuradaiEvalStudents: { type: string; student: Student }[] = [
  {
    type: "順調（4年次）",
    student: evalStudent(1, 4, [
      { taken: YEAR_ONE },
      ON_TRACK_SECOND,
      ON_TRACK_THIRD,
      { taken: ["演習Ⅱ", ...ELECTIVE_THIRD.slice(8)] },
    ]),
  },
  {
    type: "順調（2年次）",
    student: evalStudent(2, 2, [{ taken: YEAR_ONE }, ON_TRACK_SECOND]),
  },
  {
    type: "区分の偏り: 修得は足りるが選択必修が不足",
    student: evalStudent(3, 4, [
      { taken: YEAR_ONE },
      { taken: [...MAJOR_SECOND, ...SELECTIVE.slice(0, 7), ...ELECTIVE_SECOND.slice(0, 10)] },
      { ...ON_TRACK_THIRD, taken: [...ON_TRACK_THIRD.taken, "経済英語", "地域調査実習"] },
      { taken: ["演習Ⅱ", ...ELECTIVE_THIRD.slice(8)] },
    ]),
  },
  {
    type: "必修の落とし: 再履修が必要",
    student: evalStudent(4, 3, [
      { taken: YEAR_ONE },
      {
        taken: ["ミクロ経済学Ⅱ", "マクロ経済学Ⅱ", "統計学Ⅱ", ...SELECTIVE, ...ELECTIVE_SECOND.slice(0, 10)],
        failed: ["経済史"],
      },
      ON_TRACK_THIRD,
    ]),
  },
  {
    type: "先修未修得: Ⅰを落としてⅡを履修できない",
    student: evalStudent(5, 2, [
      { taken: YEAR_ONE.filter((name) => name !== "ミクロ経済学Ⅰ"), failed: ["ミクロ経済学Ⅰ"] },
      {
        taken: [
          "マクロ経済学Ⅱ",
          "統計学Ⅱ",
          "経済史",
          ...SELECTIVE,
          ...ELECTIVE_SECOND.slice(0, 10),
        ],
      },
    ]),
  },
  {
    type: "上限に当たる: 緩和の条件を確認する",
    student: evalStudent(
      6,
      3,
      [
        { taken: YEAR_ONE.slice(0, 16) },
        { taken: [...YEAR_ONE.slice(16), ...MAJOR_SECOND, ...SELECTIVE, ...ELECTIVE_SECOND.slice(0, 4)] },
        { taken: MAJOR_THIRD },
      ],
      { previousGpa: 3.2 },
    ),
  },
  {
    type: "進級ぎりぎり: 履修中をすべて修得すれば第6条の単位に届く",
    student: evalStudent(7, 2, [
      { taken: YEAR_ONE },
      { taken: [...MAJOR_SECOND, ...SELECTIVE, ...ELECTIVE_SECOND.slice(0, 1)] },
    ]),
  },
  {
    type: "今年度の卒業が難しい: 残りの単位が上限を超える",
    student: evalStudent(8, 4, [
      { taken: YEAR_ONE },
      { taken: [...MAJOR_SECOND, ...SELECTIVE.slice(0, 6)] },
      { taken: ["計量経済学", ...ELECTIVE_SECOND.slice(0, 6)] },
      { taken: ["演習Ⅰ", ...SELECTIVE.slice(6)] },
    ]),
  },
  {
    type: "第6条の境界: 修得60単位、うち他学科12単位",
    student: evalStudent(9, 3, [
      { taken: YEAR_ONE },
      { taken: [...MAJOR_SECOND, ...OUTSIDE, ...SELECTIVE.slice(0, 3)] },
      { taken: [...MAJOR_THIRD, ...SELECTIVE.slice(3, 7)] },
    ]),
  },
  {
    type: "要項の外の事情: 留学",
    student: evalStudent(
      10,
      3,
      [{ taken: YEAR_ONE }, ON_TRACK_SECOND, ON_TRACK_THIRD],
      { specialStatuses: ["留学"] },
    ),
  },
];
