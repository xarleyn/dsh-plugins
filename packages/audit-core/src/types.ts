/**
 * The audit artifact domain.
 *
 * `analysis.json` is the semantic source and `REPORT.md` is the presentation
 * source; nothing here ever derives meaning from the Markdown. Two rules shape
 * every type below:
 *
 * 1. **An audit is untrusted input.** A file may be truncated, hand-edited, or
 *    produced by a future schema. Every reader is therefore total: a missing
 *    field degrades the view, it never throws. The viewer's job is to show what
 *    is there.
 * 2. **The artefact's own words win.** Enumerated fields (`verdict`,
 *    `severity`, `status`, `rootCause`) are typed as `string` and normalised
 *    only at presentation time by the `normalize*` helpers. A vocabulary that
 *    grows on the producer's side cannot turn a rendered audit into an error.
 */

/** One scored dimension of the scorecard. */
export interface AuditScore {
  /** The awarded score: `0`–`4`, or `"N/A"` when the dimension does not apply. */
  readonly score: number | string | null;
  /** How firm the score is; the producer's own word (`high`/`medium`/`low`). */
  readonly confidence: string;
  /** One-line justification. */
  readonly summary: string;
  /** Evidence references, conventionally `seq:<n>` positions in the session. */
  readonly evidence: readonly string[];
}

/** Dimension name → score. The dimension set is the producer's, not ours. */
export type AuditScorecard = Readonly<Record<string, AuditScore>>;

/** One material issue found by the auditor. */
export interface AuditFinding {
  /** Finding id, conventionally `F1`, `F2`, … and referenced by recommendations. */
  readonly id: string;
  /** `critical` | `major` | `minor` | `observation`, or a future vocabulary. */
  readonly severity: string;
  /** Free-form slug, e.g. `grounding`, `tool_execution`. */
  readonly category: string;
  readonly title: string;
  /** `observed` | `likely` | `possible`. */
  readonly status: string;
  /** Upper-case cause bucket, e.g. `AGENT`, `TOOL`, `ENVIRONMENT`. */
  readonly rootCause: string;
  readonly description: string;
  readonly evidence: readonly string[];
  /** Where a fix would land, e.g. `agent_instruction`, `skill`, `none`. */
  readonly recommendationTarget: string;
}

/** One recommended change, referencing the findings that motivate it. */
export interface AuditRecommendation {
  readonly target: string;
  /** `high` | `medium` | `low`. */
  readonly priority: string;
  readonly action: string;
  /** Finding ids (not seq references) — see {@link AuditFinding.id}. */
  readonly evidence: readonly string[];
}

/** A capability the agent could have used and did not. */
export interface AuditMissedOpportunity {
  readonly capability: string;
  readonly confidence: string;
  readonly why: string;
  readonly evidence: readonly string[];
}

/**
 * A moment where the user corrected the agent. The producer owns this shape —
 * audits in the wild disagree on its keys — so it is carried as an opaque
 * record and rendered from {@link AuditAnalysisV1.raw}, never typed here.
 */
export type AuditUserCorrection = Readonly<Record<string, unknown>>;

/** Where the audited trajectory came from. */
export interface AuditTrajectoryRef {
  /** **Authoritative session binding.** Full id, e.g. `session-41b4e63f-…`. */
  readonly sessionId: string;
  readonly source: string;
  readonly format: string;
  readonly model: string;
  readonly agentPreset: string;
  readonly cwd: string;
  readonly subagentLog: string;
  /**
   * Execution totals, when the producer recorded them.
   *
   * Absent from the v1 artefacts in the wild — they carry the advertised tool
   * catalogue, not call counts — so these are read opportunistically and the
   * summary simply omits them rather than rendering a fabricated zero.
   */
  readonly toolCalls?: number;
  readonly toolErrors?: number;
}

/** How much of the session the auditor could actually see. */
export interface AuditEvidenceSufficiency {
  /** `rich` | `limited` | `usable`. */
  readonly level: string;
  readonly present: readonly string[];
  readonly missing: readonly string[];
}

/** The headline outcome, as distinct from the {@link AuditAnalysisV1.verdict}. */
export interface AuditTaskOutcome {
  /** `completed` | `completed_with_gaps` | `partial` | `failed`. */
  readonly status: string;
  readonly summary: string;
}

/** Producer provenance. Present from schema v2; absent in v1 the generator predates. */
export interface AuditProvenance {
  readonly id: string;
  readonly createdAt: string;
  readonly producer: {
    readonly name: string;
    readonly version: string;
  };
}

/** Who performed the audit. */
export interface AuditAuditor {
  readonly type: string;
  readonly model: string;
}

/** A schema-version-1 audit, read defensively. */
export interface AuditAnalysisV1 {
  readonly kind: "v1";
  readonly schemaVersion: 1;
  readonly audit?: AuditProvenance;
  readonly auditor?: AuditAuditor;
  /** Present exactly when {@link AuditTrajectoryRef.sessionId} is resolvable. */
  readonly trajectory: AuditTrajectoryRef;
  readonly evidenceSufficiency?: AuditEvidenceSufficiency;
  readonly verdict: string;
  readonly taskOutcome?: AuditTaskOutcome;
  readonly scores: AuditScorecard;
  readonly findings: readonly AuditFinding[];
  readonly missedOpportunities: readonly AuditMissedOpportunity[];
  readonly userCorrections: readonly AuditUserCorrection[];
  readonly betterTrajectory: readonly string[];
  readonly recommendations: readonly AuditRecommendation[];
  readonly limitations: readonly string[];
}

/**
 * An audit whose `schemaVersion` this build does not know.
 *
 * Not an error state: the report and the raw JSON stay viewable, which is the
 * whole point of versioning the artefact rather than the reader (SPEC §8).
 */
export interface UnknownAuditAnalysis {
  readonly kind: "unknown";
  /** The declared version, or `null` when the field was missing or not a number. */
  readonly schemaVersion: number | null;
}

/** Any parsed audit: known schema or not. */
export type AuditAnalysis = AuditAnalysisV1 | UnknownAuditAnalysis;

/** `true` when this build understands the analysis' schema. */
export function isKnownAnalysis(
  analysis: AuditAnalysis,
): analysis is AuditAnalysisV1 {
  return analysis.kind === "v1";
}

/** A finding count broken out by the buckets the badge renders. */
export interface AuditFindingCounts {
  readonly critical: number;
  readonly major: number;
  readonly minor: number;
  readonly observation: number;
  /**
   * Every severity outside the four above — a future vocabulary's bucket.
   *
   * The SPEC's summary shape names `major`/`minor`/`observation`/`other`;
   * `critical` is carried separately because the audits in the wild already use
   * it (dropping it into `other` would render "0 major" beside a critical
   * finding).
   */
  readonly other: number;
}

/**
 * The materialised per-session record the client reads.
 *
 * Deliberately not the analysis: a session list asks "is there an audit, and
 * how did it go" for every row, and shipping a 25 KB document per row to
 * answer that is what the SPEC §32 endpoint exists to avoid.
 */
export interface AuditSummary {
  readonly auditId: string;
  readonly sessionId: string;
  /** `excellent` | `good` | `mixed` | `poor` | `failed` | `insufficient_evidence`. */
  readonly verdict?: string;
  readonly outcomeStatus?: string;
  readonly evidenceLevel?: string;
  readonly model?: string;
  readonly agentPreset?: string;
  /** Absent when the producer did not record execution totals (the v1 case). */
  readonly toolCalls?: number;
  readonly toolErrors?: number;
  readonly findings: AuditFindingCounts;
  readonly modifiedAt: string;
  /** `null` while the schema is unknown and only the raw view is available. */
  readonly schemaVersion: number | null;
}

/** A fully loaded audit: summary, parsed analysis, report text and raw JSON. */
export interface SessionAudit {
  readonly summary: AuditSummary;
  readonly analysis: AuditAnalysis;
  /** The `REPORT.md` bytes, as text. */
  readonly report: string;
  /**
   * The parsed `analysis.json` exactly as it was published.
   *
   * The semantic tabs read {@link SessionAudit.analysis}; the JSON tab renders
   * this, so a field the typed view does not model is still inspectable and an
   * unknown schema is still readable.
   */
  readonly raw: unknown;
}

/** Why a discovered audit is not usable. */
export type AuditErrorCode =
  | "MISSING_ANALYSIS"
  | "MISSING_REPORT"
  | "INVALID_JSON"
  | "INVALID_SCHEMA"
  | "SESSION_ID_MISMATCH"
  | "SESSION_NOT_FOUND"
  | "SESSION_ID_AMBIGUOUS"
  | "FILE_TOO_LARGE"
  | "READ_FAILED"
  | "UNSUPPORTED_SCHEMA";

/** One diagnostic about one audit directory. */
export interface AuditError {
  readonly code: AuditErrorCode;
  /** Human-readable detail; never rendered to an ordinary session viewer. */
  readonly message: string;
  /**
   * `"error"` blocks the audit; `"warning"` is a note about a viewable audit —
   * an unknown schema, say, which still renders its report and raw JSON.
   */
  readonly severity: "error" | "warning";
}

/** How far the registry got with one audit directory. */
export type AuditStatus = "ready" | "pending" | "invalid" | "unresolved";

/** The registry's normalised view of one audit directory. */
export interface AuditRecord {
  readonly auditId: string;
  /**
   * The bound session, or `null` while the binding is unresolved.
   *
   * `null` and {@link AuditStatus} `"unresolved"` are the same fact: the
   * artefact is valid but no session owns it, so no session view shows it.
   */
  readonly sessionId: string | null;
  readonly sourceDirectory: string;
  readonly status: AuditStatus;
  readonly schemaVersion: number | null;
  /** SHA-256 over the analysis and report bytes; unchanged bytes are a no-op. */
  readonly fingerprint: string;
  readonly summary?: AuditSummary;
  readonly reportPath: string;
  readonly analysisPath: string;
  readonly discoveredAt: string;
  readonly modifiedAt: string;
  readonly errors: readonly AuditError[];
}

/** What changed in the registry. */
export type AuditRegistryEventType =
  "created" | "updated" | "deleted" | "invalid";

/** One registry change, as published to subscribers. */
export interface AuditRegistryEvent {
  readonly type: AuditRegistryEventType;
  /** The affected audit. */
  readonly auditId: string;
  /** The bound session, when the record has one. */
  readonly sessionId?: string;
  /** The new summary — present for `created` and `updated`. */
  readonly summary?: AuditSummary;
}

/**
 * The plugin-to-plugin contract (SPEC §29).
 *
 * A consumer that must work without this plugin reads the provider through the
 * optional-service accessor and branches on `undefined`; it never assumes the
 * provider exists.
 */
export interface SessionAuditProvider {
  /** The active audit's summary for a session, or `null` when there is none. */
  getSessionAuditSummary(sessionId: string): Promise<AuditSummary | null>;

  /** The active audit in full, or `null` when there is none. */
  getSessionAudit(sessionId: string): Promise<SessionAudit | null>;

  /** Every audit bound to a session, newest first. */
  listSessionAudits(sessionId: string): Promise<readonly AuditSummary[]>;

  /** Subscribe to registry changes; the returned function unsubscribes. */
  subscribe(listener: (event: AuditRegistryEvent) => void): () => void;
}
