/**
 * The shared presentation vocabulary: labels, tone classes and small formatters.
 *
 * Kept free of DSH types on purpose — these components receive already-loaded
 * data through props and never fetch anything themselves (SPEC §10), so the
 * same elements serve a full conversation page and a dialog.
 */
import type { AuditFindingCounts } from "@yadsh/dsh-audit-core";

/** Human labels for the verdicts the UI styles. */
const VERDICT_LABEL: Record<string, string> = {
  excellent: "Excellent",
  good: "Good",
  mixed: "Mixed",
  poor: "Poor",
  failed: "Failed",
  insufficient_evidence: "Insufficient evidence",
};

/** Human labels for the outcome statuses. */
const OUTCOME_LABEL: Record<string, string> = {
  completed: "completed",
  completed_with_gaps: "completed with gaps",
  partial: "partial",
  failed: "failed",
  cannot_determine: "cannot be determined",
};

/** Human labels for the evidence levels. */
const EVIDENCE_LABEL: Record<string, string> = {
  rich: "rich evidence",
  usable: "usable evidence",
  limited: "limited evidence",
};

/** The label for a verdict, falling back to the raw word the producer used. */
export function verdictLabel(verdict: string): string {
  if (verdict.length === 0) return "No verdict";
  return VERDICT_LABEL[verdict] ?? verdict;
}

/** A tone suffix for styling: `good`, `bad`, `warn` or `neutral`. */
export function verdictTone(verdict: string): string {
  switch (verdict) {
    case "excellent":
    case "good":
      return "good";
    case "mixed":
      return "warn";
    case "poor":
    case "failed":
      return "bad";
    default:
      return "neutral";
  }
}

/** The label for an outcome status. */
export function outcomeLabel(status: string): string {
  if (status.length === 0) return "";
  return OUTCOME_LABEL[status] ?? status;
}

/** The label for an evidence level. */
export function evidenceLabel(level: string): string {
  if (level.length === 0) return "";
  return EVIDENCE_LABEL[level] ?? level;
}

/**
 * The finding counts as one line: `1 critical · 2 major · 1 minor`.
 *
 * Only non-zero buckets appear, in descending severity, so a clean audit reads
 * "No findings" rather than a row of zeroes.
 */
export function findingsLabel(counts: AuditFindingCounts): string {
  const parts: string[] = [];
  if (counts.critical > 0) parts.push(`${counts.critical} critical`);
  if (counts.major > 0) parts.push(`${counts.major} major`);
  if (counts.minor > 0) parts.push(`${counts.minor} minor`);
  if (counts.observation > 0) {
    parts.push(
      `${counts.observation} ${counts.observation === 1 ? "observation" : "observations"}`,
    );
  }
  if (counts.other > 0) parts.push(`${counts.other} other`);
  return parts.length === 0 ? "No findings" : parts.join(" · ");
}

/** A local date-time, or the raw value when it does not parse. */
export function formatTimestamp(value: string): string {
  if (value.length === 0) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** `-1` and negative sentinels become an em dash rather than a wrong number. */
export function formatCount(value: number): string {
  return value < 0 ? "—" : String(value);
}
