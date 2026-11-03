import { describe, expect, it } from "vitest";
import { exampleCourses } from "../../data/fictional/example/courses";
import { exampleRules } from "../../data/fictional/example/rules";
import { checkCurrentRegistrations } from "../plan";
import { enrolled, makeStudent, numberedNames, passed } from "./helpers";

const answers = { "ambiguity-seminar-credits": "include" };
const check = (overrides: Parameters<typeof makeStudent>[0]) =>
  checkCurrentRegistrations(exampleRules, exampleCourses, makeStudent(overrides), answers);
const codes = (result: ReturnType<typeof check>) => result?.check.issues.map(({ code }) => code) ?? [];

describe("checkCurrentRegistrations（今期の登録をまとめて検査。H25 の J。B40）", () => {
  it("今年度の履修中がなければ検査しない", () => {
    expect(check({ studentYear: 2, records: passed(["入門A"], 1) })).toBeNull();
    expect(check({ studentYear: 2, records: enrolled(["入門A"], 1) })).toBeNull();
  });

  it("今年度の履修中だけを案として検査し、それ自体を「履修中」の重複にしない", () => {
    const result = check({
      studentYear: 2,
      currentTerm: "前期",
      records: [...passed(["入門A", "入門B"], 1), ...enrolled(["応用B", "応用C"], 2)],
    });
    expect(result?.courses).toEqual(["応用B", "応用C"]);
    expect(result?.check.status).toBe("passed");
    expect(codes(result)).toEqual([]);
  });

  it("時限が重なる登録を見つける", () => {
    const result = check({ studentYear: 2, currentTerm: "前期", records: enrolled(["実習", "講読"], 2) });
    expect(result?.check.status).toBe("failed");
    expect(codes(result)).toContain("TIME_CONFLICT");
  });

  it("先修条件を満たしていない登録を見つける", () => {
    const result = check({ studentYear: 2, currentTerm: "前期", records: enrolled(["応用B"], 2) });
    expect(codes(result)).toContain("PREREQUISITE_NOT_MET");
  });

  it("履修上限は、今年度に修得した科目と今の登録を合わせて数える", () => {
    const names = numberedNames("専門", 20);
    const withinTerm = check({
      studentYear: 2,
      records: [...passed(names.slice(0, 10), 2, "前期"), ...enrolled(names.slice(10, 20), 2, "後期")],
    });
    expect(codes(withinTerm)).not.toContain("OVER_LIMIT");

    const overYear = check({
      studentYear: 2,
      records: [
        ...passed(names.slice(0, 10), 2, "前期"),
        ...enrolled(names.slice(10, 20), 2, "後期"),
        ...enrolled(["乙01"], 2, "後期"),
      ],
    });
    expect(codes(overYear)).toContain("OVER_LIMIT");
  });

  it("配当年次より前の登録を見つける", () => {
    const result = check({ studentYear: 1, yearsEnrolled: 1, currentTerm: "前期", records: enrolled(["専門01"], 1) });
    expect(codes(result)).toContain("WRONG_YEAR");
  });

  it("特別な学生は職員確認にする", () => {
    const result = check({ specialStatuses: ["休学"], records: enrolled(["専門01"], 4, "後期") });
    expect(result?.check.status).toBe("needs_staff");
  });
});
