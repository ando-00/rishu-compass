import { describe, expect, it } from "vitest";
import { z } from "zod";
import adviceRules from "../../data/fictional/advice-rules.md?raw";
import { exampleCourses } from "../../data/fictional/example/courses";
import { exampleRules } from "../../data/fictional/example/rules";
import type { Student } from "../../engine";
import { makeStudent, numberedNames, passed, enrolled } from "../../engine/__tests__/helpers";
import { adviseStudent, DRAFT_LABEL, type AdvisorLoop } from "../advisor/advise";
import { createAdvisorTools, draftProblem, type AdvisorInput } from "../advisor/tools";

const ANSWERS = { "ambiguity-seminar-credits": "include" };
const BASIC = ["入門A", "入門B", "基礎C", "基礎D", "基礎E"];
const USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
const DRAFT = "履修について一緒に確認したいことがあります。窓口へお越しください。";
const GOOD_PLAN = [{ course: "専門01", term: "前期" }];

const second = makeStudent({
  studentYear: 2,
  records: [...passed(BASIC), ...enrolled(["応用B"], 2)],
});

function input(overrides: Partial<AdvisorInput> = {}): AdvisorInput {
  return {
    rules: exampleRules,
    courses: exampleCourses,
    student: second,
    answers: ANSWERS,
    adviceRules,
    ...overrides,
  };
}

// 手順どおりに道具を呼ぶ見本の Claude。
function scriptedLoop(steps: [string, unknown][], stopReason = "end_turn") {
  const seen: string[] = [];
  const loop: AdvisorLoop = async ({ tools }) => {
    for (const [name, toolInput] of steps) {
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(name);
      seen.push(tool.run(toolInput));
    }
    return { stopReason, iterations: steps.length, usage: USAGE };
  };
  return { loop, seen };
}

function runTool(name: string, toolInput: unknown, overrides?: Partial<AdvisorInput>) {
  const { tools } = createAdvisorTools(input(overrides));
  const tool = tools.find((candidate) => candidate.name === name);
  return JSON.parse(tool!.run(toolInput));
}

describe("履修案の結果", () => {
  it("検査に通った案と、下書きと分かる声かけ文を返す", async () => {
    const { loop } = scriptedLoop([["submit_plan", { plan: GOOD_PLAN, draft: DRAFT }]]);
    const result = await adviseStudent(loop, input());
    expect(result).toMatchObject({
      status: "passed",
      plan: [{ course: "専門01", term: "前期", credits: 2 }],
      totalCredits: 2,
      planningYear: 3,
    });
    if (result.status !== "passed") throw new Error(result.reason);
    expect(result.draft.startsWith(DRAFT_LABEL)).toBe(true);
    expect(result.draft).toContain(DRAFT);
  });

  it("検査に通らない案は受け付けず、職員確認にする", async () => {
    const bad = { plan: [{ course: "存在しない科目", term: "前期" }], draft: DRAFT };
    const { loop, seen } = scriptedLoop([["submit_plan", bad]]);
    const result = await adviseStudent(loop, input());
    expect(result.status).toBe("needs_staff");
    expect(JSON.stringify(result)).not.toContain("存在しない科目");
    expect(JSON.parse(seen[0]!)).toMatchObject({ accepted: false, status: "failed" });
  });

  it("違反を直した案は受け付ける", async () => {
    const { loop } = scriptedLoop([
      ["submit_plan", { plan: [{ course: "入門A", term: "前期" }], draft: DRAFT }],
      ["submit_plan", { plan: GOOD_PLAN, draft: DRAFT }],
    ]);
    expect((await adviseStudent(loop, input())).status).toBe("passed");
  });

  it("検査に落ちて直した経過を、engine の検査の文で返す", async () => {
    const bad = [{ course: "入門A", term: "前期" }];
    const { loop } = scriptedLoop([
      ["validate_plan", { plan: bad }],
      ["submit_plan", { plan: GOOD_PLAN, draft: DRAFT }],
    ]);
    const { issues } = runTool("validate_plan", { plan: bad });
    const result = await adviseStudent(loop, input());
    if (result.status !== "passed") throw new Error(result.reason);
    expect(result.corrections).toEqual([
      { stage: "plan", messages: [`${issues[0].message}（${issues[0].clause}）`] },
    ]);
  });

  it("下書きの表現で落ちた経過も返す", async () => {
    const { loop } = scriptedLoop([
      ["submit_plan", { plan: GOOD_PLAN, draft: "卒業できません。" }],
      ["submit_plan", { plan: GOOD_PLAN, draft: DRAFT }],
    ]);
    const result = await adviseStudent(loop, input());
    if (result.status !== "passed") throw new Error(result.reason);
    // 経過には検査の文だけを残し、Claude の書いた表現を写さない（A2-11）
    expect(result.corrections).toEqual([{ stage: "draft", messages: [expect.stringContaining("下書きに")] }]);
    expect(JSON.stringify(result.corrections)).not.toContain("卒業できません");
  });

  it("同じ案を検査と提出で続けて落としても、経過は1回に数える", async () => {
    const bad = [{ course: "入門A", term: "前期" }];
    const { loop } = scriptedLoop([
      ["validate_plan", { plan: bad }],
      ["submit_plan", { plan: bad, draft: DRAFT }],
      ["submit_plan", { plan: GOOD_PLAN, draft: DRAFT }],
    ]);
    const result = await adviseStudent(loop, input());
    if (result.status !== "passed") throw new Error(result.reason);
    expect(result.corrections).toHaveLength(1);
  });

  it("最初の検査で通れば、経過は空になる", async () => {
    const { loop } = scriptedLoop([
      ["validate_plan", { plan: GOOD_PLAN }],
      ["submit_plan", { plan: GOOD_PLAN, draft: DRAFT }],
    ]);
    const result = await adviseStudent(loop, input());
    if (result.status !== "passed") throw new Error(result.reason);
    expect(result.corrections).toEqual([]);
  });

  it("科目名が \\uXXXX の文字列で届いても、元の文字に戻して検査する", async () => {
    const escaped = [{ course: "\\u5c02\\u958001", term: "前期" }];
    expect(runTool("validate_plan", { plan: escaped }).status).toBe("passed");

    const { loop } = scriptedLoop([["submit_plan", { plan: escaped, draft: DRAFT }]]);
    const result = await adviseStudent(loop, input());
    expect(result).toMatchObject({ status: "passed", plan: [{ course: "専門01" }], corrections: [] });
  });

  it("空の案と空の下書きは提出できない", async () => {
    const { tools, state } = createAdvisorTools(input());
    const submit = tools.find((tool) => tool.name === "submit_plan")!;
    expect(() => submit.run({ plan: [], draft: DRAFT })).toThrow();
    expect(() => submit.run({ plan: GOOD_PLAN, draft: "  " })).toThrow();
    expect(state.submitted).toBeNull();
  });

  it("未回答の曖昧箇所に関わる案は受け付けない", async () => {
    const ready = makeStudent({
      studentYear: 2,
      records: passed([...BASIC, ...numberedNames("専門", 13)], 1),
    });
    const { loop } = scriptedLoop([
      ["submit_plan", { plan: [{ course: "ゼミ", term: "通年" }], draft: DRAFT }],
    ]);
    const result = await adviseStudent(loop, input({ student: ready, answers: {} }));
    expect(result.status).toBe("needs_staff");
  });

  it("周回が尽きて提出がなければ職員確認にする", async () => {
    const { loop } = scriptedLoop([["check_requirements", {}]], "tool_use");
    const result = await adviseStudent(loop, input());
    expect(result).toMatchObject({ status: "needs_staff", iterations: 1 });
  });

  it("職員に回したときは理由を返す", async () => {
    const { loop } = scriptedLoop([["escalate_to_staff", { reason: "再履修の扱いを確認したい" }]]);
    expect(await adviseStudent(loop, input())).toMatchObject({
      status: "needs_staff",
      reason: "再履修の扱いを確認したい",
    });
  });

  it("職員に回した後の提出は受け付けない", async () => {
    const { loop } = scriptedLoop([
      ["escalate_to_staff", { reason: "確認したい" }],
      ["submit_plan", { plan: GOOD_PLAN, draft: DRAFT }],
    ]);
    expect((await adviseStudent(loop, input())).status).toBe("needs_staff");
  });

  it("提出の後に職員に回したら案を出さない", async () => {
    const { loop } = scriptedLoop([
      ["submit_plan", { plan: GOOD_PLAN, draft: DRAFT }],
      ["escalate_to_staff", { reason: "やはり確認したい" }],
    ]);
    expect(await adviseStudent(loop, input())).toMatchObject({
      status: "needs_staff",
      reason: "やはり確認したい",
    });
  });

  it("Claude が例外を投げたら、案にせずそのまま止める", async () => {
    const loop: AdvisorLoop = async () => {
      throw new Error("API の失敗");
    };
    await expect(adviseStudent(loop, input())).rejects.toThrow("API の失敗");
  });
});

describe("適用外の学生", () => {
  it.each<[string, Partial<Student>]>([
    ["編入", { specialStatuses: ["編入"] }],
    ["休学", { specialStatuses: ["休学"] }],
    ["留学", { specialStatuses: ["留学"] }],
    ["読替", { specialStatuses: ["読替"] }],
    ["既修得認定", { specialStatuses: ["既修得認定"] }],
    ["適用外の入学年度", { admissionYear: 2010 }],
  ])("%sは Claude を呼ばず職員確認にする", async (_, overrides) => {
    let called = false;
    const loop: AdvisorLoop = async () => {
      called = true;
      return { stopReason: "end_turn", iterations: 1, usage: USAGE };
    };
    const result = await adviseStudent(loop, input({ student: { ...second, ...overrides } }));
    expect(result).toMatchObject({ status: "needs_staff", iterations: 0 });
    expect(called).toBe(false);
  });
});

describe("声かけ文の検査", () => {
  it("問題の表現を理由に示す", () => {
    expect(draftProblem("あと12単位です。")).toContain("12単位");
    expect(draftProblem("このままでは卒業できません。")).toContain("卒業できません");
  });

  it.each([
    "あと12単位で足ります。",
    "残り１２ 単位です。",
    "このままでは卒業できません。",
    "卒業できます。",
    "卒業不可です。",
    "卒業が確定しました。",
    "留年します。",
  ])("「%s」は受け付けない", (draft) => {
    expect(draftProblem(draft)).not.toBeNull();
  });

  it.each([
    "卒業に向けて履修を一緒に確認したいです。",
    "予定どおり卒業できるよう、今後の履修を相談しましょう。",
    "この不足が残ると卒業要件を満たせないので確認が必要です。",
    "留年しないように計画を立てましょう。",
    "第2条の区分について確認したいことがあります。",
    "2年次の履修について相談しましょう。",
  ])("「%s」は受け付ける", (draft) => {
    expect(draftProblem(draft)).toBeNull();
  });

  it("問題のある下書きの案は提出できない", async () => {
    const { loop, seen } = scriptedLoop([
      ["submit_plan", { plan: GOOD_PLAN, draft: "あと8単位で卒業できます。" }],
    ]);
    expect((await adviseStudent(loop, input())).status).toBe("needs_staff");
    expect(JSON.parse(seen[0]!)).toMatchObject({ accepted: false });
  });
});

describe("道具", () => {
  it("入力のスキーマに strict で使えない制約がない", () => {
    for (const { name, inputSchema } of createAdvisorTools(input()).tools) {
      expect(JSON.stringify(z.toJSONSchema(inputSchema)), name).not.toMatch(
        /minItems|maxItems|minLength|maxLength|pattern/,
      );
    }
  });

  it("check_requirements は engine の判定と案を組む年次を返す", () => {
    const result = runTool("check_requirements", {});
    expect(result.planningYear).toBe(3);
    expect(result.judgments.map((j: { name: string }) => j.name)).toContain("卒業要件");
  });

  it("search_courses は修得済みと今年度の履修中を返さない", () => {
    const { courses } = runTool("search_courses", { keyword: null, group: null, term: null });
    const names = courses.map((course: { name: string }) => course.name);
    expect(names).not.toContain("入門A");
    expect(names).not.toContain("応用B");
    expect(names).toContain("専門01");
  });

  it("search_courses は案を組む年次より後の配当の科目を返さない", () => {
    const first = makeStudent({ studentYear: 1, currentTerm: "前期" });
    const { courses } = runTool(
      "search_courses",
      { keyword: null, group: null, term: null },
      { student: first },
    );
    expect(courses.map((course: { name: string }) => course.name)).not.toContain("専門01");
  });

  it("search_courses は語と科目群と学期で絞り込む", () => {
    const search = (query: object) =>
      runTool("search_courses", { keyword: null, group: null, term: null, ...query }).courses;
    expect(search({ keyword: "実習" }).map((c: { name: string }) => c.name)).toEqual(["実習"]);
    expect(search({ group: "乙専攻" })).toHaveLength(8);
    expect(search({ term: "通年" }).map((c: { name: string }) => c.name)).toEqual(["ゼミ"]);
  });

  it("search_courses は一度に多くを返さず、総数を示す", () => {
    const { total, courses } = runTool("search_courses", { keyword: null, group: null, term: null });
    expect(total).toBeGreaterThan(30);
    expect(courses).toHaveLength(30);
  });

  it("validate_plan は engine の検査の結果を返す", () => {
    const result = runTool("validate_plan", { plan: [{ course: "入門A", term: "前期" }] });
    expect(result.status).toBe("failed");
    expect(result.issues[0]).toMatchObject({ code: "ALREADY_EARNED", course: "入門A" });
  });

  it("lookup_advice_rules は語に合う判断ルールを返す", () => {
    const rules = runTool("lookup_advice_rules", { keyword: "集中講義" });
    expect(rules.map((r: { number: number }) => r.number)).toEqual([16]);
  });

  it("lookup_advice_rules は語がないと主要な8件を返す", () => {
    expect(runTool("lookup_advice_rules", { keyword: null })).toHaveLength(8);
  });

  it("lookup_advice_rules は合う語がなくても主要な判断ルールを返す", () => {
    expect(runTool("lookup_advice_rules", { keyword: "該当しない語" })).toHaveLength(8);
  });
});
