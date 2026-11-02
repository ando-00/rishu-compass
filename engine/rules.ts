// 履修要項を判定できる形にしたルール。書き方は docs/RULE_FORMAT.md を見る。

export type StudentCondition = {
  major?: string;
  hasMinor?: boolean;
  minStudentYear?: number;
  minPreviousGpa?: number;
};

type RuleBase = {
  id: string;
  clause: string;
  sourceQuote: string;
  status?: "confirmed" | "needs_review";
  when?: StudentCondition;
  ambiguityIds?: string[];
};

export type Graduation = RuleBase & {
  minYears: number;
  totalCredits: number;
};

export type SubLimit = {
  groups: string[];
  maxCredits: number;
};

export type Category = RuleBase & {
  name: string;
  groups: string[];
  minCredits: number;
  requireAll: boolean;
  maxCredits?: number | null;
  overflowTo: string | null;
  subLimits?: SubLimit[];
};

export type GateTarget =
  | { kind: "course"; courses: string[] }
  | { kind: "promotion"; toYear: number };

export type Gate = RuleBase & {
  name: string;
  target: GateTarget;
  checkAtEndOfYear: number;
  minCredits?: number;
  creditBasis?: "earned" | "countable";
  requiredCourses: string[];
  requiredMayBeEnrolled?: boolean;
  // requiredMayBeEnrolled のとき、判定の時点までに修得または履修中だった科目だけを数えるなら true
  enrolledThroughCheckOnly?: boolean;
  retryAfterMet: boolean;
};

export type RetakeExclusion = "none" | "failed" | "failed_or_disqualified";

export type LoadLimit = RuleBase & {
  maxPerYear?: number;
  maxPerTerm: number;
  retakeExclusion: RetakeExclusion;
};

export type CourseCountLimit = RuleBase & {
  group: string;
  maxPerTerm: number;
};

// ANDの組をORで並べる。[["A"], ["B", "C"]] は「A または（B かつ C）」。
export type Prerequisite = RuleBase & {
  course: string;
  conditions: string[][];
  allowSameTerm: boolean;
};

export type EnrollmentRule = RuleBase & {
  forbidBeforeAssignedYear: boolean;
  forbidRetakeOfPassed: boolean;
};

export type RetakeRule = RuleBase & {
  forbidDisqualified: boolean;
};

export type RulePatch = {
  ruleId: string;
  field: string;
  value: string | number | boolean | null;
};

export type AmbiguityOption = {
  id: string;
  label: string;
  // null はルールの差分で表せない候補。回答しても判定には反映しない。
  patches: RulePatch[] | null;
};

export type Ambiguity = {
  id: string;
  clause: string;
  sourceQuote: string;
  question: string;
  options: AmbiguityOption[];
};

export type RuleSet = {
  id: string;
  name: string;
  admissionYears: number[];
  graduation: Graduation;
  categories: Category[];
  gates: Gate[];
  loadLimits: LoadLimit[];
  courseCountLimits: CourseCountLimit[];
  prerequisites: Prerequisite[];
  enrollment?: EnrollmentRule;
  retake?: RetakeRule;
  ambiguities: Ambiguity[];
};
