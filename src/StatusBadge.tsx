import type { JudgmentStatus } from "../shared/api";

type Tone = "good" | "bad" | "warn" | "neutral";

const JUDGMENT_LABELS: Record<JudgmentStatus, { label: string; tone: Tone }> = {
  satisfied: { label: "充足", tone: "good" },
  expected: { label: "見込み", tone: "warn" },
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

function Badge({ label, tone }: { label: string; tone: Tone }) {
  return <span className={`badge badge-${tone}`}>{label}</span>;
}

export function JudgmentBadge({ status }: { status: JudgmentStatus }) {
  return <Badge {...JUDGMENT_LABELS[status]} />;
}

export function StateBadge({ state }: { state: keyof typeof STATE_LABELS }) {
  return <Badge {...STATE_LABELS[state]} />;
}

export function PlanBadge({ status }: { status: keyof typeof PLAN_LABELS }) {
  return <Badge {...PLAN_LABELS[status]} />;
}
