import type { Course, CourseSlot, OfferedTerm, Term } from "../../engine/model";

export type CourseDetailsConfig = {
  days: string[];
  // 埋める順。昼の時限から使う。
  periods: number[];
  summaries: Record<string, string>;
  // 通年の科目。元のデータに書かれていなければここで決める。
  yearLong?: string[];
  intensive?: string[];
  // 第1クォーターと第2クォーターで同じ時限に置く組。
  quarterPairs?: [string, string][];
};

const TERMS: Term[] = ["前期", "後期"];

function isRequired(course: Course) {
  return course.groups.some((group) => group.endsWith("/必修"));
}

function termsOf(term: OfferedTerm): Term[] {
  return term === "通年" ? TERMS : [term];
}

// 「○○Ⅰ」は前期、「○○Ⅱ」は後期に置き、同じ年度に続けて履修できるようにする。残りは科目群の中で交互に置く。
function assignTerms(courses: Course[], config: CourseDetailsConfig) {
  const terms = new Map<string, OfferedTerm>();
  const seen = new Map<string, number>();
  for (const course of courses) {
    const group = course.groups[0] ?? "";
    const index = seen.get(group) ?? 0;
    seen.set(group, index + 1);
    if (course.offeredIn) terms.set(course.name, course.offeredIn);
    else if (config.yearLong?.includes(course.name)) terms.set(course.name, "通年");
    else if (course.name.endsWith("Ⅰ")) terms.set(course.name, "前期");
    else if (course.name.endsWith("Ⅱ")) terms.set(course.name, "後期");
    else terms.set(course.name, TERMS[index % 2]!);
  }
  for (const [first, second] of config.quarterPairs ?? []) {
    terms.set(second, terms.get(first)!);
  }
  return terms;
}

// 同じ配当年次の必修が重ならないよう、必修から順に空いた時限を割り当てる。
function assignSlots(courses: Course[], terms: Map<string, OfferedTerm>, config: CourseDetailsConfig) {
  const grid = config.periods.flatMap((period) => config.days.map((day) => ({ day, period })));
  const used = new Map<string, number>();
  const usedKey = (year: number, term: Term, index: number) => `${year}:${term}:${index}`;
  const slots = new Map<string, CourseSlot[]>();
  const partnerOf = new Map(config.quarterPairs?.map(([first, second]) => [second, first]));
  const quarterOf = new Map(
    config.quarterPairs?.flatMap(([first, second]) => [
      [first, 1 as const],
      [second, 2 as const],
    ]),
  );
  const ordered = [...courses].sort((a, b) => Number(isRequired(b)) - Number(isRequired(a)));

  for (const course of ordered) {
    if (config.intensive?.includes(course.name)) continue;
    const partner = partnerOf.get(course.name);
    if (partner) continue;
    const held = termsOf(terms.get(course.name)!);
    const load = (index: number) =>
      Math.max(...held.map((term) => used.get(usedKey(course.assignedYear, term, index)) ?? 0));
    const lightest = Math.min(...grid.map((_, index) => load(index)));
    const index = grid.findIndex((_, candidate) => load(candidate) === lightest);
    for (const term of held) {
      const key = usedKey(course.assignedYear, term, index);
      used.set(key, (used.get(key) ?? 0) + 1);
    }
    const quarter = quarterOf.get(course.name);
    slots.set(course.name, [{ ...grid[index]!, ...(quarter ? { quarter } : {}) }]);
  }
  for (const [first, second] of config.quarterPairs ?? []) {
    const [slot] = slots.get(first) ?? [];
    if (slot) slots.set(second, [{ ...slot, quarter: 2 }]);
  }
  return slots;
}

// 要項に開講学期と時限の記載がないので、規則で決めた架空の値を足す。名前と単位と科目群は変えない。
export function withCourseDetails(courses: Course[], config: CourseDetailsConfig): Course[] {
  const terms = assignTerms(courses, config);
  const slots = assignSlots(courses, terms, config);
  return courses.map((course) => {
    const intensive = config.intensive?.includes(course.name) ?? false;
    return {
      ...course,
      summary: config.summaries[course.name] ?? "",
      offeredIn: terms.get(course.name)!,
      ...(intensive ? { intensive } : { slots: slots.get(course.name) ?? [] }),
    };
  });
}
