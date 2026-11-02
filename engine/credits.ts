import { findCourse, matchesCondition, type CourseIndex, type Student } from "./model";
import type { Category, RuleSet } from "./rules";

export type CategoryAllocation = {
  categoryId: string;
  direct: number;
  received: number;
  total: number;
  counted: number;
  overflowed: number;
  lost: number;
  missingCourses: string[];
};

export type CreditAllocation = {
  categories: CategoryAllocation[];
  earned: number;
  counted: number;
  uncategorized: string[];
};

export function applicableCategories(rules: RuleSet, student: Student) {
  return rules.categories.filter((category) => matchesCondition(category.when, student));
}

export function sortByOverflow(categories: Category[]) {
  const ids = new Set(categories.map((category) => category.id));
  const incoming = new Map(categories.map((category) => [category.id, 0]));
  for (const { id, overflowTo } of categories) {
    if (overflowTo === null) continue;
    if (!ids.has(overflowTo)) throw new Error(`${id} の算入先がありません: ${overflowTo}`);
    incoming.set(overflowTo, (incoming.get(overflowTo) ?? 0) + 1);
  }

  const sorted: Category[] = [];
  const queue = categories.filter((category) => incoming.get(category.id) === 0);
  while (queue.length > 0) {
    const category = queue.shift()!;
    sorted.push(category);
    if (category.overflowTo === null) continue;
    const remaining = (incoming.get(category.overflowTo) ?? 0) - 1;
    incoming.set(category.overflowTo, remaining);
    if (remaining === 0) queue.push(categories.find((c) => c.id === category.overflowTo)!);
  }
  if (sorted.length !== categories.length) throw new Error("算入先が循環しています");
  return sorted;
}

function directCredits(category: Category, names: string[], catalog: CourseIndex) {
  const creditsOf = (name: string) => findCourse(catalog, name).credits;
  const sum = (list: string[]) => list.reduce((total, name) => total + creditsOf(name), 0);

  let limitExcess = 0;
  for (const limit of category.subLimits ?? []) {
    const limited = names.filter((name) =>
      findCourse(catalog, name).groups.some((group) => limit.groups.includes(group)),
    );
    limitExcess += Math.max(0, sum(limited) - limit.maxCredits);
  }
  return { direct: sum(names) - limitExcess, limitExcess };
}

export function allocateCredits(
  rules: RuleSet,
  catalog: CourseIndex,
  student: Student,
  passed: Set<string>,
): CreditAllocation {
  const categories = applicableCategories(rules, student);
  const assigned = new Map<string, string[]>(categories.map((category) => [category.id, []]));
  const uncategorized: string[] = [];
  let earned = 0;

  for (const name of passed) {
    const course = findCourse(catalog, name);
    earned += course.credits;
    const home = categories.find((category) =>
      category.groups.some((group) => course.groups.includes(group)),
    );
    if (home) assigned.get(home.id)?.push(name);
    else uncategorized.push(name);
  }

  const received = new Map<string, number>();
  const results = new Map<string, CategoryAllocation>();

  for (const category of sortByOverflow(categories)) {
    const names = assigned.get(category.id) ?? [];
    const { direct, limitExcess } = directCredits(category, names, catalog);
    const inflow = received.get(category.id) ?? 0;
    const total = direct + inflow;
    const counted = Math.min(total, category.maxCredits ?? category.minCredits);
    const excess = total - counted;

    if (category.overflowTo !== null) {
      received.set(category.overflowTo, (received.get(category.overflowTo) ?? 0) + excess);
    }

    results.set(category.id, {
      categoryId: category.id,
      direct,
      received: inflow,
      total,
      counted,
      overflowed: category.overflowTo === null ? 0 : excess,
      lost: limitExcess + (category.overflowTo === null ? excess : 0),
      missingCourses: category.requireAll ? missingCourses(category, passed, catalog) : [],
    });
  }

  const ordered = categories.map((category) => results.get(category.id)!);
  return {
    categories: ordered,
    earned,
    counted: ordered.reduce((total, category) => total + category.counted, 0),
    uncategorized,
  };
}

function missingCourses(category: Category, passed: Set<string>, catalog: CourseIndex) {
  return [...catalog.values()]
    .filter((course) => course.groups.some((group) => category.groups.includes(group)))
    .filter((course) => !passed.has(course.name))
    .map((course) => course.name);
}
