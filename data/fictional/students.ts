import type {
  Course,
  CourseRecord,
  OfferedTerm,
  SpecialStatus,
  Student,
  Term,
} from "../../engine/model";

export type TakeState = {
  passed: Set<string>;
  earned: number;
  year: number;
};

// 2年次の終わりの修得単位を loadByYear で固定し、選択の順を逆にして他学科の単位を多く持たせる型。
export type BoundaryProfile = {
  every: number;
  offset: number;
  loadByYear: [number, number];
};

// 要項に適用の入学年度が書かれていないので、ここで決める。適用内の学生の年度と合わせる。
export const ADMISSION_YEARS = [2023, 2024, 2025, 2026];

export type StudentConfig = {
  prefix: string;
  seed: number;
  count: number;
  firstYearAdmission: number;
  courses: Course[];
  // 年次ごとの1学期あたりの履修単位
  loadByYear: [number, number, number, number];
  majors?: string[];
  minorRate?: number;
  boundary?: BoundaryProfile;
  requiredGroups: (major?: string) => string[];
  electiveGroups: (major?: string, minor?: boolean) => string[];
  canTake?: (course: Course, state: TakeState) => boolean;
};

type Profile = {
  passRate: number;
  loadScale: number;
  reverseElectives: boolean;
};

const PROFILES: { share: number; profile: Profile }[] = [
  { share: 0.55, profile: { passRate: 0.98, loadScale: 1, reverseElectives: false } },
  { share: 0.27, profile: { passRate: 0.93, loadScale: 1, reverseElectives: false } },
  { share: 0.1, profile: { passRate: 0.7, loadScale: 0.8, reverseElectives: false } },
  { share: 0.08, profile: { passRate: 0.97, loadScale: 1, reverseElectives: true } },
];

const BOUNDARY_PROFILE: Profile = { passRate: 0.97, loadScale: 1, reverseElectives: true };
const SPECIAL_STATUSES: SpecialStatus[] = ["編入", "休学", "留学", "読替", "既修得認定"];

function createRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickProfile(value: number) {
  let cumulative = 0;
  for (const { share, profile } of PROFILES) {
    cumulative += share;
    if (value < cumulative) return profile;
  }
  return PROFILES[0]!.profile;
}

// 「○○Ⅱ」は対応する「○○Ⅰ」を修得してから履修する形で作る。
function firstPartOf(name: string, names: Set<string>) {
  if (!name.endsWith("Ⅱ")) return null;
  const first = `${name.slice(0, -1)}Ⅰ`;
  return names.has(first) ? first : null;
}

function groupRank(course: Course, order: string[]) {
  const ranks = course.groups.map((group) => order.indexOf(group)).filter((rank) => rank >= 0);
  return ranks.length > 0 ? Math.min(...ranks) : -1;
}

function generateStudent(config: StudentConfig, index: number, random: () => number): Student {
  const studentYear = (index % 4) + 1;
  const major = config.majors?.[index % config.majors.length];
  const hasMinor = random() < (config.minorRate ?? 0);
  const { boundary } = config;
  const isBoundary = boundary !== undefined && index % boundary.every === boundary.offset;
  const profile = isBoundary ? BOUNDARY_PROFILE : pickProfile(random());
  const electives = config.electiveGroups(major, hasMinor);
  const order = [
    ...config.requiredGroups(major),
    ...(profile.reverseElectives ? [...electives].reverse() : electives),
  ];
  const names = new Set(config.courses.map((course) => course.name));
  const creditsOf = new Map(config.courses.map((course) => [course.name, course.credits]));
  const passed = new Set<string>();
  const records: CourseRecord[] = [];
  let earned = 0;
  let previousYearRate: number | undefined;

  const settle = (year: number, term: OfferedTerm) => {
    for (const record of records) {
      if (record.studentYear !== year || record.term !== term || record.result !== "passed") continue;
      if (!passed.has(record.course)) earned += creditsOf.get(record.course) ?? 0;
      passed.add(record.course);
    }
  };

  for (let year = 1; year <= studentYear; year += 1) {
    const taken = new Set<string>();
    let attempts = 0;
    let successes = 0;
    const boundaryYear = isBoundary && year <= 2;

    for (const term of ["前期", "後期"] as Term[]) {
      const candidates = config.courses
        .filter((course) => course.assignedYear <= year)
        .filter((course) => !passed.has(course.name) && !taken.has(course.name))
        .filter((course) => groupRank(course, order) >= 0)
        .filter((course) => course.offeredIn !== "通年" || term === "前期")
        .filter(
          (course) =>
            course.offeredIn === undefined ||
            course.offeredIn === "通年" ||
            course.offeredIn === term,
        )
        .filter((course) => {
          const first = firstPartOf(course.name, names);
          return first === null || passed.has(first);
        })
        .filter((course) => config.canTake?.(course, { passed, earned, year }) ?? true)
        .map((course) => ({ course, rank: groupRank(course, order), tie: random() }))
        .sort((a, b) => a.rank - b.rank || a.tie - b.tie);

      const target = boundaryYear
        ? boundary.loadByYear[year - 1]!
        : Math.round(config.loadByYear[year - 1]! * profile.loadScale);
      let load = 0;
      const planned: { course: Course; term: OfferedTerm }[] = [];
      for (const { course } of candidates) {
        if (load >= target) break;
        planned.push({ course, term: course.offeredIn === "通年" ? "通年" : term });
        load += course.offeredIn === "通年" ? course.credits / 2 : course.credits;
      }

      for (const { course, term: recordTerm } of planned) {
        taken.add(course.name);
        if (year === studentYear && recordTerm !== "前期") {
          records.push({ course: course.name, studentYear: year, term: recordTerm, result: "enrolled" });
          continue;
        }
        attempts += 1;
        const success = boundaryYear || random() < profile.passRate;
        if (success) successes += 1;
        const failure = random() < 0.2 ? "disqualified" : "failed";
        records.push({
          course: course.name,
          studentYear: year,
          term: recordTerm,
          result: success ? "passed" : failure,
        });
      }

      // 通年の科目の結果は年度末に確定するので、学期の途中では前期の修得だけを見る。
      settle(year, term);
    }
    settle(year, "通年");

    if (year === studentYear - 1) previousYearRate = attempts === 0 ? 0 : successes / attempts;
  }

  const special = index % 23 === 7 ? SPECIAL_STATUSES[(index / 23) % 5 | 0] : undefined;
  const outOfRange = index % 97 === 41;
  const gpa = (1.4 + (previousYearRate ?? 0) * 2.3 + random() * 0.4).toFixed(2);

  return {
    id: `${config.prefix}${String(index + 1).padStart(4, "0")}`,
    admissionYear: config.firstYearAdmission - (studentYear - 1) - (outOfRange ? 6 : 0),
    studentYear,
    currentTerm: "後期",
    yearsEnrolled: studentYear,
    expectedGraduation: { studentYear: 4, term: "後期" },
    ...(major ? { major } : {}),
    hasMinor,
    ...(previousYearRate === undefined ? {} : { previousGpa: Number(gpa) }),
    specialStatuses: special ? [special] : [],
    records,
  };
}

// 同じ設定からは常に同じ学生を作る。個人名は持たせない。
export function generateStudents(config: StudentConfig): Student[] {
  const random = createRandom(config.seed);
  return Array.from({ length: config.count }, (_, index) => generateStudent(config, index, random));
}
