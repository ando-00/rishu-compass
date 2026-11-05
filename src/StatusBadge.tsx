import type { JudgmentStatus } from "../shared/api";

type Tone = "good" | "bad" | "warn" | "neutral";

const JUDGMENT_LABELS: Record<JudgmentStatus, { label: string; tone: Tone }> = {
  satisfied: { label: "充足", tone: "good" },
  expected: { label: "見込み", tone: "warn" },
  delayed: { label: "遅れ", tone: "bad" },
  short: { label: "不足", tone: "bad" },
  delay_risk: { label: "延期見込み（職員と確認）", tone: "bad" },
  needs_staff: { label: "職員確認", tone: "warn" },
};

const STATE_LABELS = {
  contact: { label: "声かけ", tone: "bad" },
  staff_review: { label: "職員確認", tone: "warn" },
  clear: { label: "対応なし", tone: "good" },
} as const;

const PLAN_LABELS = {
  passed: { label: "検査に通過", tone: "good" },
  failed: { label: "検査に不合格", tone: "bad" },
  needs_staff: { label: "職員確認", tone: "warn" },
} as const;

// 職員が確定するまで緑にしない
const REVIEW_LABELS = {
  plain: { label: "案", tone: "neutral" },
  ambiguous: { label: "曖昧箇所あり", tone: "warn" },
  needs_review: { label: "要確認", tone: "warn" },
} as const;

const CASE_LABELS = {
  passed: { label: "通過", tone: "good" },
  failed: { label: "不一致", tone: "bad" },
  pending: { label: "保留", tone: "warn" },
} as const;

function Badge({ label, tone }: { label: string; tone: Tone }) {
  return <span className={`badge badge-${tone}`}>{label}</span>;
}

export function judgmentLabel(status: JudgmentStatus) {
  return JUDGMENT_LABELS[status].label;
}

export function JudgmentBadge({ status }: { status: JudgmentStatus }) {
  return <Badge {...JUDGMENT_LABELS[status]} />;
}

export function StateBadge({ state }: { state: keyof typeof STATE_LABELS }) {
  return <Badge {...STATE_LABELS[state]} />;
}

export function NewlyListedBadge() {
  return <Badge label="直前の回答で変化" tone="neutral" />;
}

export function ReviewBadge({ review }: { review: keyof typeof REVIEW_LABELS }) {
  return <Badge {...REVIEW_LABELS[review]} />;
}

export function CaseBadge({ outcome }: { outcome: keyof typeof CASE_LABELS }) {
  return <Badge {...CASE_LABELS[outcome]} />;
}

export function PlanBadge({ status }: { status: keyof typeof PLAN_LABELS }) {
  return <Badge {...PLAN_LABELS[status]} />;
}
