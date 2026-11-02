import { describe, expect, it, vi } from "vitest";
import { evaluateStudent, type Course, type RuleSet, type Student } from "../../engine";
import type { Ambiguity, Gate } from "../../engine/rules";
import { extractConsensus, mergeProposals, type Proposal } from "../rule-extraction/consensus";
import { ModelError, type StructuredModel } from "../rule-extraction/model";

const base = { clause: "第1条", sourceQuote: "根拠の文" };

// どの要項の内容でもない値で作る。
const COURSES: Course[] = [
  { name: "共通A", credits: 6, assignedYear: 1, groups: ["共通"] },
  { name: "応用B", credits: 2, assignedYear: 2, groups: ["共通"] },
];

const STUDENT: Student = {
  id: "S1",
  admissionYear: 2030,
  studentYear: 2,
  currentTerm: "前期",
  yearsEnrolled: 1,
  specialStatuses: [],
  records: [{ course: "共通A", studentYear: 1, term: "前期", result: "passed" }],
};

const GATE: Gate = {
  ...base,
  id: "gate",
  name: "条件",
  target: { kind: "course", courses: ["応用B"] },
  checkAtEndOfYear: 1,
  minCredits: 6,
  creditBasis: "earned",
  requiredCourses: [],
  retryAfterMet: false,
};

const RULES: RuleSet = {
  id: "mihon",
  name: "見本",
  admissionYears: [2030],
  graduation: { ...base, id: "graduation", minYears: 3, totalCredits: 10 },
  categories: [
    { ...base, id: "category", name: "共通", groups: ["共通"], minCredits: 6, requireAll: false, overflowTo: null },
  ],
  gates: [GATE],
  loadLimits: [{ ...base, id: "load", maxPerTerm: 12, retakeExclusion: "none" }],
  courseCountLimits: [],
  prerequisites: [],
  ambiguities: [],
};

function proposal(change?: (rules: RuleSet) => void, problems: string[] = []): Proposal {
  const rules = structuredClone(RULES);
  change?.(rules);
  return { rules, notes: [], problems };
}

function ambiguity(id: string, ruleId: string, field = "creditBasis"): Ambiguity {
  return {
    ...base,
    id,
    question: "どちらですか。",
    options: [
      { id: "a", label: "甲", patches: [{ ruleId, field, value: "earned" }] },
      { id: "b", label: "乙", patches: [{ ruleId, field, value: "countable" }] },
    ],
  };
}

function withAmbiguity(id: string, ruleId = "gate") {
  return (rules: RuleSet) => {
    rules.ambiguities.push(ambiguity(id, ruleId));
    rules.gates[0]!.ambiguityIds = [id];
  };
}

function setCredits(value: number) {
  return (rules: RuleSet) => {
    rules.graduation.totalCredits = value;
  };
}

describe("mergeProposals", () => {
  it("すべて同じなら割れた項目がなく、案を変えない", () => {
    const merged = mergeProposals([proposal(), proposal(), proposal()]);
    expect(merged.disagreements).toEqual([]);
    expect(merged.extraQuestions).toEqual([]);
    expect(merged.rules).toEqual(RULES);
  });

  it("割れた項目を回ごとの値とともに示し、そのルールを要確認にする", () => {
    const merged = mergeProposals([proposal(), proposal(), proposal(setCredits(12))]);
    expect(merged.disagreements).toEqual([
      { item: "卒業要件", field: "totalCredits", values: ["10", "10", "12"] },
    ]);
    expect(merged.rules.graduation.status).toBe("needs_review");
    expect(merged.rules.categories[0]?.status).toBeUndefined();
  });

  it("多数の回と揃う案を土台にする", () => {
    const merged = mergeProposals([proposal(setCredits(12)), proposal(), proposal()]);
    expect(merged.rules.graduation.totalCredits).toBe(10);
    expect(merged.disagreements[0]?.values).toEqual(["10", "12", "10"]);
  });

  it("問題が残る案より、問題のない案を土台にする", () => {
    const merged = mergeProposals([proposal(undefined, ["問題"]), proposal(setCredits(12))]);
    expect(merged.rules.graduation.totalCredits).toBe(12);
    expect(merged.problems).toEqual([]);
  });

  it("割れた項目のある判定は、職員確認になる", () => {
    const { rules } = mergeProposals([
      proposal(),
      proposal((other) => {
        other.gates[0]!.minCredits = 8;
      }),
    ]);
    const { judgments } = evaluateStudent(rules, COURSES, STUDENT, {});
    expect(judgments.find(({ ruleId }) => ruleId === "gate")?.status).toBe("needs_staff");
  });

  it("土台にない項目と、他の回にない項目を割れた項目にする", () => {
    const extra = (rules: RuleSet) => {
      rules.courseCountLimits.push({ ...base, id: "count", group: "共通", maxPerTerm: 2 });
    };
    const onlyInOther = mergeProposals([proposal(), proposal(), proposal(extra)]);
    expect(onlyInOther.disagreements).toEqual([
      { item: "科目数の上限: 共通", field: "存在", values: ["なし", "なし", "あり"] },
    ]);
    const missingInOther = mergeProposals([proposal(extra), proposal(extra), proposal()]);
    expect(missingInOther.disagreements).toEqual([
      { item: "科目数の上限: 共通", field: "存在", values: ["あり", "あり", "なし"] },
    ]);
    expect(missingInOther.rules.courseCountLimits[0]?.status).toBe("needs_review");
  });

  it("他の回だけが見つけた曖昧箇所を取り込み、関係するルールを止める", () => {
    const merged = mergeProposals([proposal(), proposal(), proposal(withAmbiguity("found"))]);
    expect(merged.rules.ambiguities.map(({ id }) => id)).toEqual(["run3-found"]);
    expect(merged.rules.gates[0]?.ambiguityIds).toEqual(["run3-found"]);
    expect(merged.disagreements).toEqual([]);

    const { judgments } = evaluateStudent(merged.rules, COURSES, STUDENT, {});
    expect(judgments.find(({ ruleId }) => ruleId === "gate")?.status).toBe("needs_staff");
  });

  it("取り込んだ曖昧箇所は、回答すれば判定が動く", () => {
    const merged = mergeProposals([proposal(), proposal(), proposal(withAmbiguity("found"))]);
    const answers = { "run3-found": "a" };
    const { judgments } = evaluateStudent(merged.rules, COURSES, STUDENT, answers);
    expect(judgments.find(({ ruleId }) => ruleId === "gate")?.status).not.toBe("needs_staff");
  });

  it("ルールの id が違っても、差分の対象を土台の id に直す", () => {
    const renamed = (rules: RuleSet) => {
      rules.gates[0]!.id = "other-gate";
      withAmbiguity("found", "other-gate")(rules);
    };
    const merged = mergeProposals([proposal(), proposal(), proposal(renamed)]);
    expect(merged.rules.ambiguities[0]?.options[0]?.patches?.[0]?.ruleId).toBe("gate");
  });

  it("同じ項目への曖昧箇所は1件にまとめる", () => {
    const merged = mergeProposals([
      proposal(withAmbiguity("first")),
      proposal(withAmbiguity("second")),
      proposal(withAmbiguity("third")),
    ]);
    expect(merged.rules.ambiguities).toHaveLength(1);
  });

  it("他の回だけが見つけた曖昧箇所どうしも1件にまとめる", () => {
    const merged = mergeProposals([
      proposal(),
      proposal(),
      proposal(withAmbiguity("second")),
      proposal(withAmbiguity("third")),
    ]);
    expect(merged.rules.ambiguities).toHaveLength(1);
  });

  it("他の回が曖昧箇所にした項目の仮の値の違いは、割れた項目にしない", () => {
    const provisional = (rules: RuleSet) => {
      withAmbiguity("found")(rules);
      rules.gates[0]!.creditBasis = "countable";
    };
    const merged = mergeProposals([proposal(), proposal(), proposal(provisional)]);
    expect(merged.disagreements).toEqual([]);
    expect(merged.rules.gates[0]?.status).toBeUndefined();
  });

  it("差分で表せない曖昧箇所も、結びつくルールがあれば取り込む", () => {
    const open = (rules: RuleSet) => {
      rules.ambiguities.push({
        ...base,
        id: "open",
        question: "どちらですか。",
        options: [
          { id: "a", label: "甲", patches: null },
          { id: "b", label: "乙", patches: null },
        ],
      });
      rules.loadLimits[0]!.ambiguityIds = ["open"];
    };
    const merged = mergeProposals([proposal(), proposal(), proposal(open)]);
    expect(merged.rules.ambiguities[0]?.id).toBe("run3-open");
    expect(merged.rules.loadLimits[0]?.ambiguityIds).toEqual(["run3-open"]);
  });

  it("土台のルールに結びつけられない質問は、捨てずに職員へ見せる", () => {
    const orphan = (rules: RuleSet) => {
      rules.prerequisites.push({ ...base, id: "pre", course: "応用B", conditions: [["共通A"]], allowSameTerm: false });
      rules.ambiguities.push({ ...ambiguity("orphan", "pre", "allowSameTerm"), clause: "第9条" });
      rules.prerequisites[0]!.ambiguityIds = ["orphan"];
    };
    const merged = mergeProposals([proposal(), proposal(), proposal(orphan)]);
    expect(merged.rules.ambiguities).toEqual([]);
    expect(merged.extraQuestions).toEqual([
      expect.objectContaining({ clause: "第9条", question: "どちらですか。", options: ["甲", "乙"] }),
    ]);
  });

  it("notes は根拠の文でまとめる", () => {
    const note = { clause: "第2条", sourceQuote: "根拠", reason: "表せない" };
    const merged = mergeProposals([
      { ...proposal(), notes: [note] },
      { ...proposal(), notes: [{ ...note, reason: "別の書き方" }] },
      { ...proposal(), notes: [{ ...note, sourceQuote: "別の根拠" }] },
    ]);
    expect(merged.notes.map(({ sourceQuote }) => sourceQuote)).toEqual(["根拠", "別の根拠"]);
  });

  it("元の案を書き換えない", () => {
    const first = proposal();
    const before = structuredClone(first);
    mergeProposals([first, proposal(setCredits(12))]);
    expect(first).toEqual(before);
  });
});

describe("extractConsensus", () => {
  const rows = (totalCredits: number) => ({
    rules: [
      {
        kind: "graduation",
        id: "graduation",
        clause: "第1条",
        sourceQuote: "合計10単位",
        status: "confirmed",
        when: [],
        ambiguityIds: [],
        detail: JSON.stringify({ minYears: 3, totalCredits }),
      },
    ],
    ambiguities: [],
    notes: [],
  });
  const INPUT = {
    id: "mihon",
    name: "見本",
    admissionYears: [2030],
    handbook: "合計10単位",
    courses: COURSES,
    students: [STUDENT],
    cases: [],
  };
  const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const reply = (totalCredits: number) => ({
    stopReason: "end_turn",
    text: JSON.stringify(rows(totalCredits)),
    model: "fake",
    usage,
  });

  it("3回独立に変換して比べる", async () => {
    const model = vi.fn<StructuredModel>();
    model.mockResolvedValueOnce(reply(10)).mockResolvedValueOnce(reply(10)).mockResolvedValueOnce(reply(12));
    const result = await extractConsensus(model, INPUT);
    expect(model).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      ok: true,
      runs: { requested: 3, succeeded: 3 },
      disagreements: [{ item: "卒業要件", field: "totalCredits" }],
    });
    expect(result.attempts).toHaveLength(3);
  });

  it("一部の回が失敗しても、成功した回で案を返し、回数を示す", async () => {
    const model = vi.fn<StructuredModel>();
    model
      .mockResolvedValueOnce(reply(10))
      .mockRejectedValueOnce(new ModelError("timeout", "失敗"))
      .mockResolvedValueOnce(reply(10));
    const result = await extractConsensus(model, INPUT);
    expect(result).toMatchObject({ ok: true, runs: { requested: 3, succeeded: 2 } });
  });

  it("すべて失敗したら失敗を返す", async () => {
    const model = vi.fn<StructuredModel>().mockRejectedValue(new ModelError("rate_limited", "失敗"));
    const result = await extractConsensus(model, INPUT);
    expect(result).toMatchObject({ ok: false, failure: { kind: "rate_limited" } });
  });

  it("回ごとの案を評価へ渡す", async () => {
    const model = vi.fn<StructuredModel>().mockResolvedValue(reply(10));
    const seen: number[] = [];
    await extractConsensus(model, INPUT, ({ run }) => seen.push(run));
    expect(seen.sort()).toEqual([0, 1, 2]);
  });
});
