/**
 * Analysis → the materialised summary the session list and the badge read.
 *
 * The summary is what makes the SPEC §33 lazy-loading rule possible: opening a
 * session costs one of these, not the 25 KB analysis behind it.
 */
import type {
  AuditAnalysis,
  AuditFinding,
  AuditFindingCounts,
  AuditSummary,
} from "../types.js";
import { normalizeSeverity } from "../schema/v1.js";

/** Count findings into the buckets the badge renders. */
export function countFindings(
  findings: readonly AuditFinding[],
): AuditFindingCounts {
  const counts = {
    critical: 0,
    major: 0,
    minor: 0,
    observation: 0,
    other: 0,
  };
  for (const finding of findings) {
    counts[normalizeSeverity(finding.severity)] += 1;
  }
  return counts;
}

/** Everything the summary needs that the analysis itself does not carry. */
export interface BuildAuditSummaryInput {
  readonly analysis: AuditAnalysis;
  /** Registry identity for this audit; stable across restarts. */
  readonly auditId: string;
  /** The session the audit is bound to, after resolution. */
  readonly sessionId: string;
  /** Artifact mtime, ISO-8601. */
  readonly modifiedAt: string;
}

/** Materialise the summary for a resolved audit. */
export function buildAuditSummary(input: BuildAuditSummaryInput): AuditSummary {
  const { analysis, auditId, sessionId, modifiedAt } = input;

  // An unknown schema still gets a summary: the caller that reached here
  // resolved a session, and "there is an audit, its shape is newer than this
  // build" is a truthful answer that keeps the badge working.
  if (analysis.kind !== "v1") {
    return {
      auditId,
      sessionId,
      findings: countFindings([]),
      modifiedAt,
      schemaVersion: analysis.schemaVersion,
    };
  }

  const core = {
    auditId,
    sessionId,
    findings: countFindings(analysis.findings),
    modifiedAt,
    schemaVersion: analysis.schemaVersion,
  } satisfies AuditSummary;

  return {
    ...core,
    ...(analysis.verdict === "" ? {} : { verdict: analysis.verdict }),
    ...(analysis.taskOutcome?.status === undefined
      ? {}
      : { outcomeStatus: analysis.taskOutcome.status }),
    ...(analysis.evidenceSufficiency?.level === undefined
      ? {}
      : { evidenceLevel: analysis.evidenceSufficiency.level }),
    ...(analysis.trajectory.model === ""
      ? {}
      : { model: analysis.trajectory.model }),
    ...(analysis.trajectory.agentPreset === ""
      ? {}
      : { agentPreset: analysis.trajectory.agentPreset }),
    ...(analysis.trajectory.toolCalls === undefined
      ? {}
      : { toolCalls: analysis.trajectory.toolCalls }),
    ...(analysis.trajectory.toolErrors === undefined
      ? {}
      : { toolErrors: analysis.trajectory.toolErrors }),
  };
}

/** Total findings across every bucket. */
export function totalFindings(counts: AuditFindingCounts): number {
  return (
    counts.critical +
    counts.major +
    counts.minor +
    counts.observation +
    counts.other
  );
}
