/**
 * Schema validation for a parsed `analysis.json`.
 *
 * The bar for "valid" is deliberately low (SPEC §58): a `schemaVersion`, a
 * `trajectory` object, and a `trajectory.sessionId`. Everything else may be
 * absent, and what is absent degrades the view rather than failing the audit —
 * the artefact is the producer's, and a viewer that refuses to open an audit
 * because it lacks a scorecard is useless exactly when an audit is most
 * interesting.
 */
import type { AuditAnalysis, AuditError } from "../types.js";
import {
  asNumber,
  asRecord,
  asRecordArray,
  asString,
  asStringArray,
  AUDIT_SCHEMA_VERSION,
  readFinding,
  readRecommendation,
  readScorecard,
  readUserCorrections,
} from "../schema/v1.js";

/** The outcome of reading an audit: either a usable analysis, or reasons why not. */
export type AuditAnalysisResult =
  | {
      readonly ok: true;
      readonly analysis: AuditAnalysis;
      /** Warnings about a still-viewable audit; never empty of meaning. */
      readonly errors: readonly AuditError[];
    }
  | {
      readonly ok: false;
      readonly errors: readonly AuditError[];
    };

function failure(
  code: AuditError["code"],
  message: string,
): AuditAnalysisResult {
  return { ok: false, errors: [{ code, message, severity: "error" }] };
}

/**
 * Read a decoded `analysis.json` value into an analysis.
 *
 * Accepts `unknown` on purpose: the value comes from a JSON file written by
 * another process, so no type at this boundary would be honest.
 */
export function validateAuditAnalysis(value: unknown): AuditAnalysisResult {
  const root = asRecord(value);
  if (root === undefined) {
    return failure(
      "INVALID_SCHEMA",
      "analysis must be a JSON object at the top level",
    );
  }

  const schemaVersion = asNumber(root.schemaVersion);
  if (schemaVersion === undefined) {
    return failure(
      "INVALID_SCHEMA",
      "analysis.schemaVersion is missing or is not a number",
    );
  }

  // An unknown version is not a failure. The report and the raw JSON stay
  // viewable, which is the entire reason the artefact carries a version.
  if (schemaVersion !== AUDIT_SCHEMA_VERSION) {
    return {
      ok: true,
      analysis: { kind: "unknown", schemaVersion },
      errors: [
        {
          code: "UNSUPPORTED_SCHEMA",
          message: `audit schema version ${schemaVersion} is not understood by this build; showing raw analysis and report`,
          severity: "warning",
        },
      ],
    };
  }

  const trajectory = asRecord(root.trajectory);
  const sessionId = asString(trajectory?.sessionId);
  if (trajectory === undefined || sessionId === undefined) {
    return failure(
      "INVALID_SCHEMA",
      "analysis.trajectory.sessionId is missing or is not a non-empty string",
    );
  }

  const evidenceSufficiency = asRecord(root.evidenceSufficiency);
  const taskOutcome = asRecord(root.taskOutcome);
  const audit = asRecord(root.audit);
  const auditor = asRecord(root.auditor);
  const producer = asRecord(audit?.producer);

  const findings = asRecordArray(root.findings)
    .map(readFinding)
    .filter((finding) => finding !== undefined);
  const recommendations = asRecordArray(root.recommendations)
    .map(readRecommendation)
    .filter((recommendation) => recommendation !== undefined);

  const analysis: AuditAnalysis = {
    kind: "v1",
    schemaVersion: AUDIT_SCHEMA_VERSION,
    ...(audit === undefined || producer === undefined
      ? {}
      : {
          audit: {
            id: asString(audit.id) ?? "",
            createdAt: asString(audit.createdAt) ?? "",
            producer: {
              name: asString(producer.name) ?? "",
              version: asString(producer.version) ?? "",
            },
          },
        }),
    ...(auditor === undefined
      ? {}
      : {
          auditor: {
            type: asString(auditor.type) ?? "",
            model: asString(auditor.model) ?? "",
          },
        }),
    trajectory: {
      sessionId,
      source: asString(trajectory.source) ?? "",
      format: asString(trajectory.format) ?? "",
      model: asString(trajectory.model) ?? "",
      agentPreset: asString(trajectory.agentPreset) ?? "",
      cwd: asString(trajectory.cwd) ?? "",
      subagentLog: asString(trajectory.subagentLog) ?? "",
      ...(asNumber(trajectory.toolCalls) === undefined
        ? {}
        : { toolCalls: asNumber(trajectory.toolCalls) }),
      ...(asNumber(trajectory.toolErrors) === undefined
        ? {}
        : { toolErrors: asNumber(trajectory.toolErrors) }),
    },
    ...(evidenceSufficiency === undefined
      ? {}
      : {
          evidenceSufficiency: {
            level: asString(evidenceSufficiency.level) ?? "",
            present: asStringArray(evidenceSufficiency.present),
            missing: asStringArray(evidenceSufficiency.missing),
          },
        }),
    verdict: asString(root.verdict) ?? "",
    ...(taskOutcome === undefined
      ? {}
      : {
          taskOutcome: {
            status: asString(taskOutcome.status) ?? "",
            summary: asString(taskOutcome.summary) ?? "",
          },
        }),
    scores: readScorecard(root.scores),
    findings,
    missedOpportunities: asRecordArray(root.missedOpportunities).map(
      (opportunity) => ({
        capability: asString(opportunity.capability) ?? "",
        confidence: asString(opportunity.confidence) ?? "",
        why: asString(opportunity.why) ?? "",
        evidence: asStringArray(opportunity.evidence),
      }),
    ),
    userCorrections: readUserCorrections(root.userCorrections),
    betterTrajectory: asStringArray(root.betterTrajectory),
    recommendations,
    limitations: asStringArray(root.limitations),
  };

  return { ok: true, analysis, errors: [] };
}
