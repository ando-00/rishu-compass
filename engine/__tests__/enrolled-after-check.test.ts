import { describe, expect, it } from "vitest";
import { exampleCourses } from "../../data/fictional/example/courses";
import { exampleRules } from "../../data/fictional/example/rules";
import { evaluateStudent } from "../evaluate";
import type { Student } from "../model";
import { enrolled, makeStudent, numberedNames, passed } from "./helpers";

// 監査の第1回の A1-16。「履修中でもよい」の条件で、判定の時点（2年次の終わり）より後に履修した科目を
// 認めるかは、要項から決まらないので曖昧箇所にした（2026-11-02 の人の決定）。
// enrolledThroughCheckOnly: true は「判定の時点までに修得または履修中だった科目だけを数える」。
const OTHERS = ["入門B", "基礎C", "基礎D", "基礎E", ...numberedNames("専門", 13)]; // 34単位

function gate(student: Student, enrolledThroughCheckOnly?: boolean) {
  const rules = structuredClone(exampleRules);
  const target = rules.gates.find((g) => g.id === "gate-seminar")!;
  target.requiredMayBeEnrolled = true;
  target.retryAfterMet = false;
  if (enrolledThroughCheckOnly !== undefined) target.enrolledThroughCheckOnly = enrolledThroughCheckOnly;
  const result = evaluateStudent(rules, exampleCourses, student, { "ambiguity-seminar-credits": "include" });
  return result.judgments.find((j) => j.ruleId === "gate-seminar")!;
}

describe("判定の時点より後に履修した科目（A1-16）", () => {
  // 必要な入門A を、判定の時点（2年次の終わり）より後の4年次に履修している
  const late = makeStudent({ studentYear: 4, records: [...passed(OTHERS, 2), ...enrolled(["入門A"], 4)] });
  // 入門A を判定の時点までに修得している
  const onTime = makeStudent({ studentYear: 4, records: passed([...OTHERS, "入門A"], 2) });

  it("指定がなければ今までどおり、後から履修した科目も数える", () => {
    expect(gate(late).status).toBe("satisfied");
    expect(gate(late, false).status).toBe("satisfied");
  });

  it("判定の時点までに限ると、後から履修した科目は数えない", () => {
    expect(gate(late, true)).toMatchObject({ status: "short", missingCourses: ["入門A"] });
  });

  it("判定の時点までに修得していれば、限っても満たす", () => {
    expect(gate(onTime, true).status).toBe("satisfied");
  });

  it("判定の時点より前の学生には影響しない", () => {
    const now = makeStudent({ studentYear: 2, records: [...passed(OTHERS, 1), ...enrolled(["入門A"], 2)] });
    expect(gate(now, true).status).toBe(gate(now, false).status);
  });
});
