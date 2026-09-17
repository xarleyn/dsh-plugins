/**
 * Schema v1: the value readers, and the vocabularies the view normalises to.
 *
 * The readers are total by construction — a wrong type yields `undefined`, an
 * absent field yields `undefined`, and neither is an error. That is what lets
 * a truncated or hand-edited `analysis.json` still render.
 */
import type {
  AuditFinding,
  AuditRecommendation,
  AuditScore,
  AuditScorecard,
  AuditUserCorrection,
} from "../types.js";

/** The schema version this build understands semantically. */
export const AUDIT_SCHEMA_VERSION = 1;

/** `true` for a non-null, non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value as an object, or `undefined`. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

/** The value as a non-empty string, or `undefined`. */
export function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** The value as a finite number, or `undefined`. */
export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * The value as an array of non-empty strings.
 *
 * Entries that are not strings are dropped rather than failing the read: an
 * audit with one malformed evidence entry still has evidence.
 */
export function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const text = asString(entry);
    if (text !== undefined) out.push(text);
  }
  return out;
}

/** The value as an array of records; entries that are not objects are dropped. */
export function asRecordArray(
  value: unknown,
): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  const out: Record<string, unknown>[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (record !== undefined) out.push(record);
  }
  return out;
}

/** Read one finding, filling absent fields with empty strings. */
export function readFinding(value: unknown): AuditFinding | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  return {
    id: asString(record.id) ?? "",
    severity: asString(record.severity) ?? "",
    category: asString(record.category) ?? "",
    title: asString(record.title) ?? "",
    status: asString(record.status) ?? "",
    rootCause: asString(record.rootCause) ?? "",
    description: asString(record.description) ?? "",
    evidence: asStringArray(record.evidence),
    recommendationTarget: asString(record.recommendationTarget) ?? "",
  };
}

/** Read one recommendation. */
export function readRecommendation(
  value: unknown,
): AuditRecommendation | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  return {
    target: asString(record.target) ?? "",
    priority: asString(record.priority) ?? "",
    action: asString(record.action) ?? "",
    evidence: asStringArray(record.evidence),
  };
}

/** Read one scorecard entry. */
export function readScore(value: unknown): AuditScore | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const score = record.score;
  return {
    score:
      typeof score === "number" || typeof score === "string" || score === null
        ? score
        : null,
    confidence: asString(record.confidence) ?? "",
    summary: asString(record.summary) ?? "",
    evidence: asStringArray(record.evidence),
  };
}

/** Read the scorecard map, keeping only entries that are objects. */
export function readScorecard(value: unknown): AuditScorecard {
  const record = asRecord(value);
  if (record === undefined) return {};
  const out: Record<string, AuditScore> = {};
  for (const [dimension, entry] of Object.entries(record)) {
    const score = readScore(entry);
    if (score !== undefined) out[dimension] = score;
  }
  return out;
}

/** Read the opaque user-correction records verbatim. */
export function readUserCorrections(
  value: unknown,
): readonly AuditUserCorrection[] {
  return asRecordArray(value);
}

/** The verdicts the UI styles, in descending quality. */
const VERDICTS = [
  "excellent",
  "good",
  "mixed",
  "poor",
  "failed",
  "insufficient_evidence",
] as const;
export type NormalizedVerdict = (typeof VERDICTS)[number] | "unknown";

/** Map an arbitrary verdict string onto the styled vocabulary. */
export function normalizeVerdict(value: string | undefined): NormalizedVerdict {
  if (value === undefined) return "unknown";
  const lowered = value.trim().toLowerCase();
  return (VERDICTS as readonly string[]).includes(lowered)
    ? (lowered as NormalizedVerdict)
    : "unknown";
}

/** Finding severities, most severe first. */
const SEVERITIES = ["critical", "major", "minor", "observation"] as const;
export type NormalizedSeverity = (typeof SEVERITIES)[number] | "other";

/** Map an arbitrary severity string onto the counted vocabulary. */
export function normalizeSeverity(
  value: string | undefined,
): NormalizedSeverity {
  if (value === undefined) return "other";
  const lowered = value.trim().toLowerCase();
  return (SEVERITIES as readonly string[]).includes(lowered)
    ? (lowered as NormalizedSeverity)
    : "other";
}

/**
 * Sort rank for a severity: lower is more severe.
 *
 * `other` sorts last because an unrecognised severity is, by definition, one
 * this build cannot claim to rank.
 */
export function severityRank(value: string | undefined): number {
  const normalized = normalizeSeverity(value);
  const index = (SEVERITIES as readonly string[]).indexOf(normalized);
  return index < 0 ? SEVERITIES.length : index;
}

/** Task-outcome statuses the UI labels. */
const OUTCOMES = [
  "completed",
  "completed_with_gaps",
  "partial",
  "failed",
  "cannot_determine",
] as const;
export type NormalizedOutcome = (typeof OUTCOMES)[number] | "unknown";

/** Map an arbitrary outcome status onto the labelled vocabulary. */
export function normalizeOutcome(value: string | undefined): NormalizedOutcome {
  if (value === undefined) return "unknown";
  const lowered = value.trim().toLowerCase();
  return (OUTCOMES as readonly string[]).includes(lowered)
    ? (lowered as NormalizedOutcome)
    : "unknown";
}

/** Evidence-sufficiency levels. */
const EVIDENCE_LEVELS = ["rich", "usable", "limited"] as const;
export type NormalizedEvidenceLevel =
  (typeof EVIDENCE_LEVELS)[number] | "unknown";

/** Map an arbitrary evidence level onto the known vocabulary. */
export function normalizeEvidenceLevel(
  value: string | undefined,
): NormalizedEvidenceLevel {
  if (value === undefined) return "unknown";
  const lowered = value.trim().toLowerCase();
  return (EVIDENCE_LEVELS as readonly string[]).includes(lowered)
    ? (lowered as NormalizedEvidenceLevel)
    : "unknown";
}

/** Confidence labels shared by scores, findings and opportunities. */
export type NormalizedConfidence = "high" | "medium" | "low" | "unknown";

/** Map an arbitrary confidence string onto the known vocabulary. */
export function normalizeConfidence(
  value: string | undefined,
): NormalizedConfidence {
  if (value === undefined) return "unknown";
  const lowered = value.trim().toLowerCase();
  return lowered === "high" || lowered === "medium" || lowered === "low"
    ? lowered
    : "unknown";
}

/** Recommendation priorities. */
export type NormalizedPriority = "high" | "medium" | "low" | "unknown";

/** Map an arbitrary priority string onto the known vocabulary. */
export function normalizePriority(
  value: string | undefined,
): NormalizedPriority {
  if (value === undefined) return "unknown";
  const lowered = value.trim().toLowerCase();
  return lowered === "high" || lowered === "medium" || lowered === "low"
    ? lowered
    : "unknown";
}
