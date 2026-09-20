/**
 * Shared contracts of the dsh-answer-review-gate plugin.
 *
 * The plugin inserts an independent review pass between a primary agent's
 * candidate final answer and the turn close (`SPEC.md`, "Architecture").
 * These types describe the verdict protocol, the delegation bookkeeping and
 * the structural views of host services the gate consumes. Host services are
 * read per call through structural faces so the plugin loads (and degrades
 * honestly) when an optional backend is absent.
 */

import type { ContentBlock } from "@deepseek-ai/dsh-llm";

// ------------------------------------------------------------------ verdict

/** Severity of one review finding. */
export type ReviewSeverity = "critical" | "major" | "minor";

/**
 * Category of one review finding (`SPEC.md`, "Reviewer contract").
 * Phase 1 ships the full enum; classification quality improves with the
 * Phase 2 evidence bundle.
 */
export type ReviewCategory =
  | "factually-wrong"
  | "unsupported"
  | "contradicted"
  | "outdated"
  | "overstated"
  | "missing-qualification"
  | "weak-source"
  | "search-incomplete"
  | "user-assumption"
  | "question-not-covered";

/** One concrete objection against the candidate answer. */
export interface ReviewIssue {
  readonly severity: ReviewSeverity;
  readonly category: ReviewCategory;
  /** The claim or aspect the objection is about. */
  readonly claim: string;
  /** Why the claim does not hold as stated. */
  readonly problem: string;
  /** What the primary must do to resolve the objection. */
  readonly requiredFix: string;
}

/** Result of one completed review pass. */
export interface ReviewVerdict {
  readonly verdict: "pass" | "revise";
  /** Reviewer's one-paragraph diagnosis. */
  readonly summary: string;
  readonly issues: readonly ReviewIssue[];
  readonly confidence: "low" | "medium" | "high";
}

/**
 * A reviewer run that produced no usable verdict. This is a reviewer
 * infrastructure failure, never a PASS (`SPEC.md`, "Security"): the
 * configured failure policy decides what happens to the candidate.
 */
export class ReviewerFailure extends Error {
  readonly reason: string;
  readonly detail: string;

  constructor(reason: string, detail = "") {
    super(
      detail === ""
        ? `answer review failed: ${reason}`
        : `answer review failed: ${reason}: ${detail}`,
    );
    this.name = "ReviewerFailure";
    this.reason = reason;
    this.detail = detail;
  }
}

// --------------------------------------------------------------- delegation

/** Kind of background work the gate tracks on behalf of a parent session. */
export type PendingDelegationKind = "continuable-subagent" | "background-job";

/** One background child whose settlement the parent has not observed yet. */
export interface PendingDelegation {
  readonly id: string;
  readonly kind: PendingDelegationKind;
  /** Turn number of the parent session at start time. */
  readonly createdAtTurn: number;
}

// -------------------------------------------------------------------- audit

/** Outcome of one gate decision at a turn-stopping boundary. */
export type ReviewAuditOutcome =
  "pass" | "revise" | "suppressed-pending-work" | "failure";

/** One audit record (`SPEC.md`, "Audit"). Never carries prompt/response text. */
export interface ReviewAuditEntry {
  /** Unix epoch milliseconds. */
  readonly time: number;
  readonly sessionId: string;
  readonly turn: number;
  /** SHA-256 of the normalized candidate text. */
  readonly candidateHash: string;
  /** Review round within the current user turn (0-based before increment). */
  readonly round: number;
  readonly backend: string;
  /** Reviewer identity: domain id or provider/model route. */
  readonly reviewer: string;
  readonly durationMs: number;
  readonly outcome: ReviewAuditOutcome;
  /** Failure reason when `outcome` is `failure`. */
  readonly failureReason?: string;
  /** Issue counts by severity for `pass`/`revise` outcomes. */
  readonly issueCounts?: Readonly<Record<ReviewSeverity, number>>;
}

// ------------------------------------------------------------ reviewer input

/** The material the reviewer receives (`SPEC.md`, "Reviewer isolation"). */
export interface ReviewInput {
  /** Session id of the reviewed (primary) agent. */
  readonly sessionId: string;
  /** Current turn number of the reviewed agent. */
  readonly turn: number;
  /** The latest user request text, when it could be located. */
  readonly requestText: string | null;
  /** The candidate final answer text. */
  readonly candidateText: string;
  /** Cancellation owned by the reviewed agent's turn. */
  readonly signal: AbortSignal;
}

/** A reviewer backend: turn a review input into a validated verdict. */
export interface ReviewerBackend {
  /** Stable backend name used in audit records. */
  readonly name: string;
  /** Reviewer identity for audit records (domain id, provider/model...). */
  readonly reviewer: string;
  review(input: ReviewInput): Promise<ReviewVerdict>;
}

// ------------------------------------------------------- structural faces

/**
 * Structural view of the `domain-experts` service the gate needs. Resolved
 * per call with `ctx.get("domainExperts")`; absence is a reviewer failure
 * handled by the failure policy, never a load-time dependency.
 */
export interface DomainExpertsFace {
  testExpert(
    domainId: string,
    task: string,
    parentSessionId: string,
  ): Promise<ExpertRunOutcome>;
}

/** Discriminated outcome of the domain-experts `testExpert` entry point. */
export interface ExpertRunOutcome {
  readonly ok: boolean;
  readonly code: string;
  readonly message: string;
  readonly result: ExpertRunResult | null;
}

/** The part of a domain-expert run result the verdict derivation reads. */
export interface ExpertRunResult {
  readonly status: string;
  readonly summary: string;
  readonly findings: readonly {
    readonly claim: string;
    readonly evidence: readonly string[];
    readonly confidence: string;
  }[];
  readonly conflicts: readonly string[];
}

/**
 * Structural view of the `subagents` service. `start` resolves when the
 * child has been accepted; `result` is the single terminal promise (it does
 * not reject on child error — branch on `stopReason`).
 */
export interface SubagentsFace {
  start(
    provider: string,
    request: SubagentStartSpec,
  ): Promise<SubagentRunHandle>;
}

/** The subset of `SubagentStartRequest` the reviewer child needs. */
export interface SubagentStartSpec {
  readonly label: string;
  readonly prompt: readonly ContentBlock[];
  readonly parent: unknown;
  readonly signal: AbortSignal;
  readonly persona?: string;
  readonly toolFilter?: { readonly allow?: readonly string[] };
  readonly agentOptions?: {
    readonly provider?: string;
    readonly model?: string;
    readonly reasoningEffort?: string;
  };
  readonly outputSchema?: Record<string, unknown>;
}

/** Structural view of one started subagent run. */
export interface SubagentRunHandle {
  readonly result: Promise<SubagentRunResult>;
  dispose(): void;
}

/** The subset of `SubagentResult` the verdict path reads. */
export interface SubagentRunResult {
  readonly stopReason: string;
  readonly output: readonly ContentBlock[];
  readonly structured?: unknown;
  readonly diagnostic?: string;
}
