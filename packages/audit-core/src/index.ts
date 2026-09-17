/**
 * `@yadsh/dsh-audit-core` — the audit artifact domain.
 *
 * This package is deliberately not a DSH plugin: it has no dependency on
 * React, the DOM, Cordis, or any harness package, so the producer side (a QA
 * plugin, a CI job, an external evaluator) and the reader side (the session
 * audit plugin, a browser bundle) can share one definition of what an audit is.
 *
 * Everything here is total: readers never throw on a malformed artifact, and
 * an unknown `schemaVersion` degrades to a raw view instead of an error.
 */
export type {
  AuditAnalysis,
  AuditAnalysisV1,
  AuditAuditor,
  AuditError,
  AuditErrorCode,
  AuditEvidenceSufficiency,
  AuditFinding,
  AuditFindingCounts,
  AuditMissedOpportunity,
  AuditProvenance,
  AuditRecommendation,
  AuditRecord,
  AuditRegistryEvent,
  AuditRegistryEventType,
  AuditScore,
  AuditScorecard,
  AuditStatus,
  AuditSummary,
  AuditTaskOutcome,
  AuditTrajectoryRef,
  AuditUserCorrection,
  SessionAudit,
  SessionAuditProvider,
  UnknownAuditAnalysis,
} from "./types.js";
export { isKnownAnalysis } from "./types.js";

export {
  asNumber,
  asRecord,
  asRecordArray,
  asString,
  asStringArray,
  isRecord,
  normalizeConfidence,
  normalizeEvidenceLevel,
  normalizeOutcome,
  normalizePriority,
  normalizeSeverity,
  normalizeVerdict,
  readFinding,
  readRecommendation,
  readScore,
  readScorecard,
  readUserCorrections,
  severityRank,
  AUDIT_SCHEMA_VERSION,
  type NormalizedConfidence,
  type NormalizedEvidenceLevel,
  type NormalizedOutcome,
  type NormalizedPriority,
  type NormalizedSeverity,
  type NormalizedVerdict,
} from "./schema/v1.js";

export {
  parseAuditAnalysis,
  getAuditSessionId,
} from "./parser/parse-analysis.js";
export {
  validateAuditAnalysis,
  type AuditAnalysisResult,
} from "./validation/validate-analysis.js";
export {
  buildAuditSummary,
  countFindings,
  totalFindings,
  type BuildAuditSummaryInput,
} from "./summary/build-summary.js";
