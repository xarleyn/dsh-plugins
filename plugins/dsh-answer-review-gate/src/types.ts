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

// ------------------------------------------------------------- message source

/**
 * The gate's own producer source kind, declared the way the harness declares
 * its own: the `@deepseek-ai/dsh-llm` source map is merge-extensible and ships
 * no catch-all `plugin` kind, so a producer names itself here.
 *
 * `kind` says *who produced this*, `form` says *what kind of thing it is*; the
 * gate only ever steers a one-off account of what a review found, so it pins
 * the `notice` form rather than admitting the whole context-form union.
 */
export interface AnswerReviewMessageSource {
  readonly kind: "answer-review";
  readonly form: "notice";
  /** One-line account of the review outcome, already bounded for the log. */
  readonly summary: string;
}

declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    "answer-review": AnswerReviewMessageSource;
  }
}

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

/**
 * Outcome of one gate decision at a turn-stopping boundary. `answer-shape` is
 * the gate's own demand that a draft which argues with the review be rewritten
 * as an answer: no reviewer ran, so no PASS is possible for that candidate.
 */
export type ReviewAuditOutcome =
  | "pass"
  | "revise"
  | "answer-shape"
  | "waived"
  | "suppressed-pending-work"
  | "failure";

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
  /** Provenance of an accepted turn-scoped review waiver. */
  readonly waiverReason?: "user-command";
  /** Issue counts by severity for `pass`/`revise` outcomes. */
  readonly issueCounts?: Readonly<Record<ReviewSeverity, number>>;
}

// ------------------------------------------------------------ reviewer input

/** The material the reviewer receives (`SPEC.md`, "Reviewer isolation"). */
export interface ReviewInput {
  /** One bounded recovery attempt is starting for the same candidate. */
  readonly onRecovery?: () => void;
  readonly conversationContext?: string;
  readonly primaryTools?: readonly string[];
  /** Session id of the reviewed (primary) agent. */
  readonly sessionId: string;
  /** Current turn number of the reviewed agent. */
  readonly turn: number;
  /** The latest user request text, when it could be located. */
  readonly requestText: string | null;
  /**
   * Handle text for every attachment (image/file) the user request carried,
   * with neutral image metadata and explicit file access limitations.
   */
  readonly requestAttachments: readonly string[];
  /** Original durable image blocks; the Host resolves bytes and route capabilities. */
  readonly requestImages?: readonly Extract<ContentBlock, { type: "image" }>[];
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
  /** Host-only entry; older installations must fail explicitly for image reviews. */
  reviewExpert?(
    domainId: string,
    task: string,
    parentSessionId: string,
    images: readonly Extract<ContentBlock, { type: "image" }>[],
  ): Promise<ExpertRunOutcome>;
  testExpert(
    domainId: string,
    task: string,
    parentSessionId: string,
    structuredOutput?: boolean,
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
  /** False explicitly means the requested native result was not captured. */
  readonly structured?: boolean;
  readonly diagnostic?: string;
  readonly summary: string;
  readonly findings: readonly {
    readonly claim: string;
    readonly evidence: readonly string[];
    readonly confidence: string;
  }[];
  readonly conflicts: readonly string[];
}

/**
 * Structural view of the `subagents` service (`@deepseek-ai/dsh-subagent`
 * 0.2.1 activation contract). The single entry point is `startActivation`:
 * the activation manager owns execution, result delivery and resource
 * release, and the caller owns disposal. The `start(provider, request)`
 * entry of the previous Host contract no longer exists, and neither do its
 * per-child `persona` and `toolFilter` request fields — on this Host a
 * child's persona and tools are composed from its Agent Preset.
 */
export interface SubagentsFace {
  /** Look up one provider's capability advertisement before composing a child. */
  getProvider(name: string): SubagentProviderFace | undefined;
  startActivation(spec: SubagentActivationSpec): Promise<SubagentActivation>;
}

/** The start-time options a provider can honor (0.2.1 capability flags). */
export interface SubagentCapabilitiesFace {
  readonly agentOptions: boolean;
  readonly agentPreset: boolean;
  readonly outputSchema: boolean;
  readonly depthLimit: boolean;
}

/** The provider facts the gate needs to preflight a reviewer composition. */
export interface SubagentProviderFace {
  readonly name: string;
  readonly capabilities: SubagentCapabilitiesFace;
  /** Whether the child sees the parent's completed-turn prefix. */
  readonly inheritsParentContext: boolean;
}

/**
 * Child model overrides, as the 0.2.1 `agentOptions` request field declares
 * them (`AgentOptions` of `@deepseek-ai/dsh-agent`, read structurally).
 */
export interface SubagentAgentOptions {
  readonly provider?: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly maxTokens?: number;
}

/**
 * The start request an activation spec carries (`SubagentStartRequest`
 * without `label` and `signal`, which the spec owns). There is no `persona`
 * and no `toolFilter`: an instruction reaches the child through the prompt,
 * and a tool policy through `agentPreset` — a provider that inherits the
 * parent's composition cannot select one.
 */
export interface SubagentRequestSpec {
  /** Content delivered as the child's user message. */
  readonly prompt: readonly ContentBlock[];
  /** The spawning agent. Its directory supplies the child's default cwd. */
  readonly parent: unknown;
  /**
   * Independent preset id; requires a provider with the `agentPreset`
   * capability that does not inherit parent context.
   */
  readonly agentPreset?: string;
  /** Provider, model, reasoning-effort and output-token overrides for the child. */
  readonly agentOptions?: SubagentAgentOptions;
  /** Object-rooted JSON Schema the child's result must satisfy. */
  readonly outputSchema?: Record<string, unknown>;
  /** Optional absolute delegation-depth cap for the child. */
  readonly maxDepth?: number;
}

/** One managed child execution request (the `startActivation` argument). */
export interface SubagentActivationSpec {
  /** Registered backend to use. */
  readonly provider: string;
  /** Short task label retained in cataloged child membership. */
  readonly label: string;
  /** Task, parent, and backend-supported execution options. */
  readonly request: SubagentRequestSpec;
  /** Cancellation before publication; callers own later cancellation through dispose. */
  readonly signal: AbortSignal;
  /** `caller` returns the result to this call alone; `parent` notifies the model. */
  readonly delivery: "parent" | "caller";
}

/** Structural view of one started subagent activation. */
export interface SubagentActivation {
  /** Stable identity of the child (a session id string at runtime). */
  readonly childId: string;
  /** Accepted inbox message, when the backend has a local inbox. */
  readonly messageId?: unknown;
  /**
   * The single terminal result. It does not reject on a child-level failure
   * (branch on `stopReason`); it rejects when the Host could not capture a
   * result at all.
   */
  readonly result: Promise<SubagentRunResult>;
  /** Stop and release this activation and its owned descendants. */
  dispose(): void | Promise<void>;
}

/** The subset of `SubagentResult` the verdict path reads. */
export interface SubagentRunResult {
  readonly stopReason: string;
  readonly output: readonly ContentBlock[];
  readonly structured?: unknown;
  readonly diagnostic?: string;
}
