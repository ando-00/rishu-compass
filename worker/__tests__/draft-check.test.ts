import { describe, expect, it } from "vitest";
import { exampleCourses } from "../../data/fictional/example/courses";
import { exampleRules } from "../../data/fictional/example/rules";
import { exampleStudents } from "../../data/fictional/example/students";
import { adviseStudent, type AdvisorLoop } from "../advisor/advise";
import { MAX_DRAFT_LENGTH, MAX_REASON_LENGTH, draftProblem } from "../advisor/tools";

const USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

describe("声かけ文と職員に回す理由の検査（A2-8、A2-9）", () => {
  it.each([
    "修得単位 96 です。",
    "修得単位の合計は 96 です。",
    "必要な単位の残りは八です。",
    "単位は合計18です。",
    "必修があと２つ、合わせて3科目不足しています。",
    "２科目足りません。",
    "不足は十八です。",
    "You still need 28 credits.",
    "前年度の GPA：2.4 でした。",
    "ＧＰＡは１．８です。",
    "12 単 位 足りません。",
    "このままでは卒業出来ません。",
    "このままでは卒業できなくなります。",
    "卒業することはできません。",
    "このままでは卒業に間に合いません。",
    "予定どおりの時期に卒業するのが難しい状況です。",
    "卒業が難しくなる可能性があります。",
    "卒業は延期になります。",
    "卒業要件を満たしていません。",
    "今年度の卒業は絶対に無理だと判定しました。",
    "2年次に進級できることが確定しました。",
    "留年になります。",
    "留年です。",
    "学籍番号 S0007 の方へ。",
  ])("「%s」を受け付けない", (text) => {
    expect(draftProblem(text)).not.toBeNull();
  });

  it.each([
    "履修について一緒に確認したいことがあります。",
    "単位について一緒に確認させてください。",
    "来年度の履修登録に向けて、教務の窓口で面談の予約をお願いします。",
    "卒業に向けて、今後の計画を一緒に組み立てたいと考えています。",
    "演習Ⅱは演習Ⅰを修得してから履修する科目です。",
  ])("「%s」は受け付ける", (text) => {
    expect(draftProblem(text)).toBeNull();
  });

  it("長すぎる文を受け付けない", () => {
    expect(draftProblem("あ".repeat(MAX_DRAFT_LENGTH))).toBeNull();
    expect(draftProblem("あ".repeat(MAX_DRAFT_LENGTH + 1))).not.toBeNull();
    expect(draftProblem("あ".repeat(MAX_REASON_LENGTH + 1), MAX_REASON_LENGTH)).not.toBeNull();
  });
});

describe("Claude の周回が途中で終わったとき（A2-5）", () => {
  const input = {
    rules: exampleRules,
    courses: exampleCourses,
    student: exampleStudents.find(({ specialStatuses }) => specialStatuses.length === 0)!,
    answers: {},
    adviceRules: "",
  };
  const ending = (stopReason: string): AdvisorLoop => async () => ({ stopReason, iterations: 1, usage: USAGE });

  it.each(["refusal", "max_tokens", "model_context_window_exceeded"])(
    "%s は職員確認にせず、失敗として返す",
    async (stopReason) => {
      await expect(adviseStudent(ending(stopReason), input)).rejects.toMatchObject({
        kind: stopReason === "refusal" ? "refusal" : "truncated",
      });
    },
  );

  it("周回の上限で終わったときは、職員確認の理由を返す", async () => {
    await expect(adviseStudent(ending("tool_use"), input)).resolves.toMatchObject({ status: "needs_staff" });
  });
});

// 第3回の予行（声かけ文の検査役）で、実際の下書きから見つかった誤検知。
// 「卒業要件を満たせない」の条件つきの否定形は、A2-8 で通すと決めたので止めない（止めるかは H15 で人が決める）
describe("声かけ文の検査の誤検知（第3回の予行）", () => {
  it.each([
    "1科目を落としても困らないよう、余裕を持たせた案です。",
    "不足があるため、3年次のうちに相談してください。",
    "残りは4年次に履修できます。",
    "不足の区分は、来年度の前期に相談しましょう。",
  ])("数値でないものを数値として止めない: %s", (text) => {
    expect(draftProblem(text)).toBeNull();
  });
});

// 監査（2026-11-05）: 学生番号の検査が今の2校の頭文字（S、K、E）だけを見ていた。3校目の番号でも止める
describe("下書きの学生番号は、大学の頭文字によらず止める", () => {
  it.each(["A1234 さんへ", "学籍番号 TU20231 の件です", "ＫＭ０１２３ さん"])("%s", (text) => {
    expect(draftProblem(text)).toContain("学生の番号");
  });
  it("学年や時期の数は止めない", () => {
    expect(draftProblem("2026年度の後期から、一緒に確認しましょう。")).toBeNull();
  });
});
