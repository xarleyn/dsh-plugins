/**
 * The gate itself (`SPEC.md`, "shouldReview()", "Revision behavior",
 * "Failure policy").
 *
 * At every `agent/turn-stopping` boundary the gate decides whether the
 * pending close is a candidate final answer worth reviewing, runs the
 * reviewer, and — on REVISE — steers the findings back into the primary so
 * the loop continues with a corrected candidate. Reviewer infrastructure
 * failures follow the configured failure policy and are never converted into
 * a PASS. Review rounds are bounded per user turn.
 */

import {
  candidateHash,
  collectCandidate,
  opensWithReviewDisputation,
  type CandidateSession,
  type CollectedCandidate,
} from "./candidate.js";
import type { ResolvedAnswerReviewGateConfig } from "./config.js";
import { DelegationTracker } from "./delegation-tracker.js";
import {
  documentTargets,
  prepareDocumentEvidence,
  type DocumentSubject,
  type DocumentTarget,
  type DocumentsReader,
  type FileReference,
} from "./document-evidence.js";
import {
  createDomainExpertBackend,
  createSubagentBackend,
} from "./adapters/reviewers.js";
import {
  renderAnswerShapeSteer,
  renderClosedModeSteer,
  renderQualificationSteer,
  renderRevisionSteer,
  steerSummary,
} from "./prompt.js";
import { qaModelPolicy, withQaAnswerReview } from "./qa-policy.js";
import { primaryReviewTools, reviewConversationContext } from "./context.js";
import type {
  DomainExpertsFace,
  ReviewAuditEntry,
  ReviewInput,
  ReviewRoundRecord,
  ReviewSeverity,
  ReviewVerdict,
  SubagentsFace,
} from "./types.js";
import { ReviewerFailure } from "./types.js";
import type { ReviewAudit } from "./audit.js";
import type { ReviewReceipt, ReviewStatus } from "./receipt.js";

/** Minimal structural view of the reviewed agent. */
export interface GateAgent {
  /** Durable session id of the agent (branded string at runtime). */
  readonly id: string;
  readonly session: {
    append?(
      type: "user/message",
      data: unknown,
      intent: {
        readonly surfaceOp: "append";
        readonly sourceEventSeqs: readonly number[];
      },
    ): unknown;
    readonly header: {
      readonly origin?: string;
      readonly cwd?: string;
    };
  } & CandidateSession;
  steer(message: unknown): void;
}

/** Minimal logger surface; `PluginLogger` satisfies it structurally. */
export interface GateLogSink {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

interface GateSessionState {
  observeRead?:
    | ((child: string, file: string, lines: readonly string[]) => void)
    | undefined;
  documentSubjects?: readonly DocumentSubject[] | undefined;
  verifiedDocument?:
    | { targets: string; check: (signal: AbortSignal) => Promise<void> }
    | undefined;
  candidateSeq?: number;
  lastReceipt?: string;
  /** Completed review attempts in the current user turn. */
  round: number;
  /**
   * Identity of the user turn the round counter, the failure steer and the
   * PASS receipt belong to: the surface seq of the user request the candidate
   * answers (`CollectedCandidate.requestSeq`). `null` means no real user
   * message was located, and then one budget covers the whole session.
   */
  userTurn: number | null;
  /**
   * Latest observed `agent/turn-stopping` turn. Informational, for delegation
   * bookkeeping only — agent turns never own review state.
   */
  lastTurn: number;
  /** One failure-policy steer per user turn — failure steers must not loop. */
  failureSteered: boolean;
  /**
   * Findings of the completed revision rounds of this user turn, oldest
   * first. Each round's reviewer receives them so it verifies their
   * resolution instead of re-reviewing from scratch — the mechanism that
   * keeps the issue count from growing between rounds.
   */
  history: ReviewRoundRecord[];
  /**
   * One answer-shape steer per user turn: a draft that opens by arguing with
   * the review is demanded back as an answer once, and a second such draft is
   * reviewed on the ordinary path rather than steered again. Only a turn that
   * has already been reviewed can be steered at all.
   */
  answerShapeSteered: boolean;
  /** A review of this session is awaited; no second reviewer may start. */
  reviewing: boolean;
  /** Hash of the candidate a review PASS applies to. */
  lastPassedHash?: string;
}

export interface AnswerReviewGateDeps {
  readonly fileReadPath?: (file: FileReference) => string | undefined;
  readonly documents?: () => DocumentsReader | undefined;
  readonly publishStatus?: (agent: GateAgent, receipt: ReviewReceipt) => void;
  readonly config: () => ResolvedAnswerReviewGateConfig;
  readonly logger: GateLogSink;
  readonly audit: ReviewAudit;
  readonly now: () => number;
  /** Per-call service resolvers keep optional backends soft. */
  readonly domainExperts: () => DomainExpertsFace | undefined;
  readonly subagents: (
    allowedTools?: readonly string[],
  ) => SubagentsFace | undefined;
  /**
   * The host's QA surface, for the model policy of the chat under review.
   * Optional and read per call: a deployment with no QA surface has no policy,
   * and the reviewer then runs on this plugin's own configuration.
   */
  readonly qaSurface?: () => unknown;
  /**
   * Deliver one `answer-review`-sourced steer message to the agent
   * (production: `createUserMessage` with the gate's own source kind;
   * injectable for tests).
   */
  readonly steerMessage: (
    agent: GateAgent,
    text: string,
    summary: string,
  ) => void;
}

/** Outcome of one boundary decision, for the event handler's audit log. */
export type BoundaryOutcome =
  | "pass"
  | "revise"
  | "answer-shape"
  | "waived"
  | "failure"
  | "suppressed-pending-work"
  | null;

export class AnswerReviewGate {
  readonly delegation = new DelegationTracker();
  private readonly states = new Map<string, GateSessionState>();
  private readonly inFlight = new Map<string, Promise<BoundaryOutcome>>();

  constructor(private readonly deps: AnswerReviewGateDeps) {}

  /** Forget per-session bookkeeping when an agent leaves the process. */
  forgetAgent(sessionId: string): void {
    this.states.delete(sessionId);
    this.delegation.forgetSession(sessionId);
  }

  observeReviewerRead(
    parentSession: string,
    child: string,
    file: string,
    lines: readonly string[],
  ): void {
    this.states.get(parentSession)?.observeRead?.(child, file, lines);
  }

  /** Turn number of the session's latest observed boundary (best effort, informational). */
  lastSeenTurnOf(sessionId: string): number {
    return this.states.get(sessionId)?.lastTurn ?? 0;
  }

  /**
   * Whether this agent at this boundary can be a reviewable candidate close
   * (`SPEC.md`, "shouldReview()"): the gate is on, the agent is a primary
   * (not a subagent — the reviewer included), and it is not excluded. The
   * candidate-dependent checks live in `handleTurnStopping`.
   */
  shouldReview(agent: GateAgent): boolean {
    const config = this.deps.config();
    if (!config.enabled) return false;
    if (agent.session.header.origin === "subagent") return false;
    return !this.matchesExcluded(String(agent.id), config.excludedAgents);
  }

  /**
   * One turn-stopping boundary. Returns the decision outcome, or null when
   * the boundary was not a reviewable candidate.
   */
  async handleTurnStopping(
    agent: GateAgent,
    turn: number,
    signal: AbortSignal,
  ): Promise<BoundaryOutcome> {
    const config = this.deps.config();
    if (!this.shouldReview(agent)) return null;
    const sessionId = String(agent.id);

    // The in-flight latch is checked before the session is read: a reentrant
    // boundary must not start a second reviewer, and it needs no candidate.
    if (this.states.get(sessionId)?.reviewing === true) return null;

    // The candidate names the turn that owns the review budget. The boundary's
    // `turn` is an agent turn and cannot: a REVISE steer continues the current
    // agent turn, while the model's next version — or a settlement notice — may
    // reopen the boundary as a new one. Keyed by the agent turn, a PASS receipt
    // and the round counter died on every such change, so a candidate that had
    // already passed was reviewed again and each turn handed out a fresh round
    // budget — the reported loop.
    const collected = collectCandidate(agent.session, this.deps.fileReadPath);
    const state = this.stateFor(sessionId, collected?.requestSeq ?? null, turn);
    if (
      config.trackBackgroundDelegations &&
      this.delegation.pendingCount(sessionId) > 0
    ) {
      this.deps.logger.info("gate.suppressed-pending-work", {
        sessionId,
        turn,
        pending: this.delegation.pendingCount(sessionId),
      });
      return "suppressed-pending-work";
    }

    if (collected === null) return null;
    const targets = documentTargets(
      agent.session,
      collected.requestSeq,
      collected.candidateSeq,
      collected.text,
    );
    state.candidateSeq = collected.candidateSeq;
    const hash = candidateHash(collected.text);
    if (
      collected.reviewWaiver !== null &&
      config.waiver.enabled &&
      (config.failMode !== "closed" || config.waiver.allowedInClosedMode)
    ) {
      this.record(config, {
        time: this.deps.now(),
        sessionId,
        turn,
        candidateHash: hash,
        round: state.round,
        backend: "waiver",
        reviewer: "none",
        durationMs: 0,
        outcome: "waived",
        waiverReason: "user-command",
      });
      this.deps.logger.info("gate.waived", {
        sessionId,
        turn,
        userTurn: state.userTurn,
        commandId: collected.reviewWaiver.commandId,
      });
      this.publishReceipt(agent, state, hash, "waived");
      return "waived";
    }
    if (
      collected.text.length < config.minCandidateChars &&
      targets.length === 0
    )
      return null;
    // A post-review check: `round` counts the reviews this user turn has
    // already run, so a first draft is never told it argued with a review that
    // never happened — the demand would both misread the draft and announce a
    // review the turn does not have.
    if (
      state.round > 0 &&
      opensWithReviewDisputation(collected.text) &&
      !state.answerShapeSteered
    ) {
      state.answerShapeSteered = true;
      this.record(config, {
        time: this.deps.now(),
        sessionId,
        turn,
        candidateHash: hash,
        round: state.round,
        backend: "answer-shape",
        reviewer: "none",
        durationMs: 0,
        outcome: "answer-shape",
      });
      this.deps.logger.warn("gate.answer-shape-steered", {
        sessionId,
        turn,
        userTurn: state.userTurn,
        candidateHash: hash,
      });
      this.deps.steerMessage(
        agent,
        renderAnswerShapeSteer(),
        steerSummary(
          "The draft answered the review instead of the user, so an answer was requested",
        ),
      );
      return "answer-shape";
    }
    let alreadyPassed = state.lastPassedHash === hash;
    if (alreadyPassed && (targets.length || state.verifiedDocument)) {
      alreadyPassed = false;
      if (state.verifiedDocument?.targets === JSON.stringify(targets)) {
        state.reviewing = true;
        try {
          await state.verifiedDocument.check(signal);
          alreadyPassed = true;
        } catch {
          state.lastPassedHash = undefined;
          state.verifiedDocument = undefined;
          state.documentSubjects = undefined;
        } finally {
          state.reviewing = false;
        }
      }
    }
    if (alreadyPassed) {
      this.publishReceipt(agent, state, hash, "pass");
      this.deps.logger.info("gate.candidate-already-passed", {
        sessionId,
        turn,
        userTurn: state.userTurn,
        candidateHash: hash,
      });
      return null;
    }
    if (state.round >= config.maxReviewRounds) {
      return this.applyFailurePolicy(
        agent,
        sessionId,
        turn,
        hash,
        "max-rounds",
        state,
      );
    }

    // Deduplicate review attempts on session + turn + candidate identity
    // (`SPEC.md`, "Concurrency"). The state latch serializes one session;
    // the key map guards reentrant boundaries for the same candidate.
    const key = `${sessionId}:${turn}:${hash}`;
    const existing = this.inFlight.get(key);
    if (existing !== undefined) return null;
    state.reviewing = true;
    const run = this.runReview(
      agent,
      sessionId,
      turn,
      hash,
      collected,
      targets,
      state,
      signal,
      config,
    ).finally(() => {
      state.reviewing = false;
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, run);
    return run;
  }

  private async runReview(
    agent: GateAgent,
    sessionId: string,
    turn: number,
    hash: string,
    collected: CollectedCandidate,
    targets: readonly DocumentTarget[],
    state: GateSessionState,
    signal: AbortSignal,
    config: ResolvedAnswerReviewGateConfig,
  ): Promise<BoundaryOutcome> {
    const startedAt = this.deps.now();
    const backend = this.backendFor(agent, config, sessionId);
    // Both backends use this signal to dispose the managed reviewer when the
    // parent stops or the round expires.
    const round = new AbortController();
    const forwardAbort = () => round.abort(signal.reason);
    if (signal.aborted) round.abort(signal.reason);
    else signal.addEventListener("abort", forwardAbort, { once: true });
    const input: ReviewInput = {
      onRecovery: () => this.publishReceipt(agent, state, hash, "recovering"),
      conversationContext: reviewConversationContext(agent.session),
      ...(primaryReviewTools(agent) === undefined
        ? {}
        : { primaryTools: primaryReviewTools(agent)! }),
      sessionId,
      turn,
      requestText: collected.requestText,
      requestAttachments: collected.requestAttachments,
      requestImages: collected.requestImages,
      candidateText: collected.text,
      ...(state.history.length === 0
        ? {}
        : { reviewHistory: [...state.history] }),
      signal: round.signal,
    };
    this.deps.logger.info("gate.review-started", {
      sessionId,
      turn,
      round: state.round,
      backend: backend.name,
      reviewer: backend.reviewer,
      candidateHash: hash,
    });
    let verdict: ReviewVerdict;
    let protocolAttemptCounted = false;
    this.publishReceipt(agent, state, hash, "reviewing");
    try {
      state.documentSubjects = undefined;
      state.verifiedDocument = undefined;
      state.lastPassedHash = undefined;
      const review = async () => {
        const evidence = targets.length
          ? await prepareDocumentEvidence({
              targets,
              files: collected.requestFiles ?? [],
              cwd: agent.session.header.cwd ?? "",
              sessionId,
              documents: this.deps.documents?.(),
              pathFor: this.deps.fileReadPath,
              signal: round.signal,
            })
          : undefined;
        round.signal.throwIfAborted();
        state.observeRead = evidence?.observeRead;
        let correction = "";
        const reviewCandidate = () =>
          withQaAnswerReview(
            this.deps.qaSurface?.(),
            sessionId,
            round.signal,
            () =>
              backend.review(
                evidence
                  ? {
                      ...input,
                      documentReview: evidence.instructions + correction,
                    }
                  : input,
              ),
          );
        let decision = await reviewCandidate();
        if (evidence) {
          const misnamed = targets.filter((t) => t.filenameMismatch);
          if (decision.verdict === "pass" && misnamed.length) {
            decision = {
              verdict: "revise",
              confidence: "high",
              summary:
                "The displayed DOCX filename differs from the producer receipt.",
              issues: misnamed.map((t) => ({
                severity: "major",
                category: "unsupported",
                claim: "The answer identifies an output file.",
                problem: "Its spelling differs from the generated filename.",
                requiredFix: "Use the exact generated path: " + t.path,
              })),
            };
          }
          while (decision.verdict === "pass") {
            try {
              await evidence.verify(
                decision.summary,
                decision.reviewerSessionId,
                decision.comparisons,
              );
              break;
            } catch (error) {
              if (
                !(error instanceof ReviewerFailure) ||
                error.reason !== "review-document-comparison-missing" ||
                state.round + 1 >= config.maxReviewRounds
              )
                throw error;
              // Repair the reviewer's protocol, not the author's correct file.
              // Every activation consumes the existing review-round budget;
              // the outer deadline and original file fingerprints stay pinned.
              state.round += 1;
              protocolAttemptCounted = true;
              this.record(config, {
                time: this.deps.now(),
                sessionId,
                turn,
                candidateHash: hash,
                round: state.round - 1,
                backend: backend.name,
                reviewer: backend.reviewer,
                durationMs: this.deps.now() - startedAt,
                outcome: "failure",
                failureReason: error.reason + " (" + error.detail + ")",
              });
              await evidence.verifyOriginals(round.signal);
              correction =
                "\nREVIEWER PROTOCOL CORRECTION: Your preceding review omitted or altered the verbatim comparison for required pair " +
                JSON.stringify(error.detail) +
                ". The candidate and its files are unchanged. Personally read the exact evidence files, then return comparisons with one contiguous quote from each, preserving all Markdown pipes. Do not ask the primary author to repair reviewer evidence.\n";
              this.deps.logger.warn("gate.reviewer-evidence-retry", {
                sessionId,
                turn,
                round: state.round,
                reason: error.reason,
              });
              this.publishReceipt(agent, state, hash, "recovering");
              protocolAttemptCounted = false;
              decision = await reviewCandidate();
            }
          }
          await evidence.verifyOriginals(round.signal);
          round.signal.throwIfAborted();
          state.documentSubjects = evidence.subjects;
          if (decision.verdict === "pass")
            state.verifiedDocument = {
              targets: JSON.stringify(targets),
              check: evidence.verifyOriginals,
            };
        }
        return decision;
      };
      verdict = await withRoundDeadline(
        review(),
        config.reviewer.roundTimeoutMs,
        round,
      );
    } catch (error) {
      const failure =
        error instanceof ReviewerFailure
          ? error
          : new ReviewerFailure(
              "reviewer-crashed",
              error instanceof Error ? error.message : String(error),
            );
      if (!protocolAttemptCounted) state.round += 1;
      if (signal.aborted) {
        this.publishReceipt(agent, state, hash, "cancelled");
        return "failure";
      }
      if (failure.reason === REVIEW_TIMEOUT_REASON) {
        this.deps.logger.warn("gate.review-timeout", {
          sessionId,
          turn,
          round: state.round - 1,
          timeoutMs: config.reviewer.roundTimeoutMs,
        });
      }
      return this.applyFailurePolicy(
        agent,
        sessionId,
        turn,
        hash,
        failure.detail === ""
          ? failure.reason
          : `${failure.reason} (${failure.detail})`,
        state,
        this.deps.now() - startedAt,
        backend,
      );
    } finally {
      state.observeRead = undefined;
      signal.removeEventListener("abort", forwardAbort);
    }
    state.round += 1;
    const durationMs = this.deps.now() - startedAt;
    if (verdict.verdict === "pass") {
      this.publishReceipt(agent, state, hash, "pass");
      state.lastPassedHash = hash;
      // The pass settles every finding the previous rounds raised: a changed
      // candidate reviewed later in this turn starts from a clean slate.
      state.history = [];
      this.record(config, {
        time: startedAt,
        sessionId,
        turn,
        candidateHash: hash,
        round: state.round - 1,
        backend: backend.name,
        reviewer: backend.reviewer,
        durationMs,
        outcome: "pass",
        issueCounts: countIssues(verdict),
      });
      this.deps.logger.info("gate.verdict", {
        sessionId,
        turn,
        verdict: "pass",
        rounds: state.round,
      });
      return "pass";
    }
    this.publishReceipt(agent, state, hash, "revise");
    this.record(config, {
      time: startedAt,
      sessionId,
      turn,
      candidateHash: hash,
      round: state.round - 1,
      backend: backend.name,
      reviewer: backend.reviewer,
      durationMs,
      outcome: "revise",
      issueCounts: countIssues(verdict),
    });
    this.deps.logger.info("gate.verdict", {
      sessionId,
      turn,
      verdict: "revise",
      issues: verdict.issues.length,
      rounds: state.round,
    });
    // Record this round's findings: the next round's reviewer is charged with
    // verifying their resolution, which is what makes the loop converge
    // instead of re-finding fresh objections every time.
    state.history.push({
      round: state.round,
      summary: verdict.summary,
      issues: verdict.issues,
    });
    this.deps.steerMessage(
      agent,
      renderRevisionSteer(verdict, state.round, config.maxReviewRounds),
      steerSummary(
        `Answer review requested corrections (round ${state.round} of ${config.maxReviewRounds})`,
      ),
    );
    return "revise";
  }

  /**
   * Reviewer failure or rounds exhausted (`SPEC.md`, "Failure policy").
   * Never records a PASS: `open` audits and allows, `warn` demands an
   * explicit unverified-answer qualification, `closed` demands revision or
   * an explicit unverified notice. One failure steer per turn keeps the
   * loop bounded.
   */
  private applyFailurePolicy(
    agent: GateAgent,
    sessionId: string,
    turn: number,
    hash: string,
    reason: string,
    state: GateSessionState,
    durationMs = 0,
    backend?: { readonly name: string; readonly reviewer: string },
  ): BoundaryOutcome {
    const config = this.deps.config();
    this.record(config, {
      time: this.deps.now(),
      sessionId,
      turn,
      candidateHash: hash,
      round: state.round,
      backend: backend?.name ?? config.reviewer.backend,
      reviewer: backend?.reviewer ?? config.reviewer.domain,
      durationMs,
      outcome: "failure",
      failureReason: reason,
    });
    this.publishReceipt(agent, state, hash, "failure");
    this.deps.logger.warn("gate.review-failed", { sessionId, turn, reason });
    if (config.failMode === "open") return "failure";
    if (state.failureSteered) return "failure";
    state.failureSteered = true;
    const text =
      config.failMode === "closed"
        ? renderClosedModeSteer(reason)
        : renderQualificationSteer(reason);
    this.deps.steerMessage(
      agent,
      text,
      steerSummary(`Independent answer verification failed (${reason})`),
    );
    return "failure";
  }

  private backendFor(
    agent: GateAgent,
    config: ResolvedAnswerReviewGateConfig,
    sessionId: string,
  ): {
    readonly name: string;
    readonly reviewer: string;
    readonly review: (input: ReviewInput) => Promise<ReviewVerdict>;
  } {
    if (config.reviewer.backend === "subagent") {
      if (
        config.maxToolCallsPerRound > 0 ||
        config.maxConsecutiveRefusalsPerRound > 0 ||
        config.reviewTimeoutMs > 0
      ) {
        return {
          name: "subagent",
          reviewer: config.reviewer.provider,
          review: async () => {
            throw new ReviewerFailure(
              "review-budget-unsupported",
              "configured review budgets require the domain-expert backend",
            );
          },
        };
      }
      return createSubagentBackend({
        face: this.deps.subagents(
          config.reviewer.enforceAllowedTools
            ? config.reviewer.allowedTools
            : undefined,
        ),
        config: config.reviewer,
        parent: agent,
        // The reviewed chat's policy, not its visitor's picker: a reviewer that
        // followed the parent's model would change with every role on the stand.
        modelPolicy: qaModelPolicy(this.deps.qaSurface?.(), String(agent.id)),
        // The activation contract scopes a child's tools through its Agent
        // Preset only, so the configured allow-list composes nothing: the
        // deployment must hear that from the gate, not read it in the config.
        onDegradation: (code, detail) => {
          this.deps.logger.warn("gate.reviewer-degraded", {
            sessionId,
            code,
            detail,
          });
        },
      });
    }
    return createDomainExpertBackend({
      face: this.deps.domainExperts(),
      config: config.reviewer,
      limits: {
        maxToolCalls: config.maxToolCallsPerRound,
        maxConsecutiveRefusals: config.maxConsecutiveRefusalsPerRound,
        timeoutMs: config.reviewTimeoutMs,
      },
      ...(agent.session.header.cwd === undefined
        ? {}
        : { workspaceRoot: agent.session.header.cwd }),
    });
  }

  private publishReceipt(
    agent: GateAgent,
    state: GateSessionState,
    hash: string,
    status: ReviewStatus,
  ): void {
    if (state.candidateSeq === undefined) return;
    const key = `${state.candidateSeq}:${hash}:${status}`;
    if (state.lastReceipt === key) return;
    state.lastReceipt = key;
    this.deps.publishStatus?.(agent, {
      version: 1,
      candidateSeq: state.candidateSeq,
      candidateHash: hash,
      requestSeq: state.userTurn,
      ...((status === "pass" || status === "revise") &&
      state.documentSubjects?.length
        ? { documents: state.documentSubjects }
        : {}),
      round: state.round,
      status,
      at: this.deps.now(),
    });
  }

  /**
   * Session state, re-scoped when the user request changes. Agent turns only
   * refresh `lastTurn`: a new agent turn inside the same user turn keeps both
   * the round budget and the PASS receipt, which is what bounds the loop. An
   * unknown user turn (`null`) never resets a known one — an interim boundary
   * without a candidate must not hand the gate a fresh budget.
   */
  private stateFor(
    sessionId: string,
    userTurn: number | null,
    turn: number,
  ): GateSessionState {
    const existing = this.states.get(sessionId);
    if (existing === undefined) {
      const fresh: GateSessionState = {
        round: 0,
        userTurn,
        lastTurn: turn,
        failureSteered: false,
        answerShapeSteered: false,
        reviewing: false,
        history: [],
      };
      this.states.set(sessionId, fresh);
      return fresh;
    }
    existing.lastTurn = turn;
    if (userTurn !== null && existing.userTurn !== userTurn) {
      existing.userTurn = userTurn;
      existing.round = 0;
      existing.failureSteered = false;
      existing.answerShapeSteered = false;
      existing.lastPassedHash = undefined;
      existing.documentSubjects = undefined;
      existing.verifiedDocument = undefined;
      existing.history = [];
    }
    return existing;
  }

  private matchesExcluded(
    sessionId: string,
    excluded: readonly string[],
  ): boolean {
    return excluded.some((pattern) => sessionId.includes(pattern));
  }

  private record(
    config: ResolvedAnswerReviewGateConfig,
    entry: ReviewAuditEntry,
  ): void {
    if (!config.audit.enabled) return;
    this.deps.audit.record(entry);
  }
}

function countIssues(verdict: ReviewVerdict): Record<ReviewSeverity, number> {
  const counts: Record<ReviewSeverity, number> = {
    critical: 0,
    major: 0,
    minor: 0,
  };
  for (const issue of verdict.issues) counts[issue.severity] += 1;
  return counts;
}

/** Reviewer-failure reason of an expired per-round deadline. */
const REVIEW_TIMEOUT_REASON = "review-timeout";

/**
 * Wall-clock bound for one review round (`reviewer.roundTimeoutMs`).
 *
 * The deadline covers the whole `review()` call, including the backend's own
 * bounded capture-recovery attempt; it adds no retry of its own — transport
 * retries stay with the provider's configured retry policy, and an expired
 * round is terminal for this attempt. `0` (or junk) disables the bound.
 *
 * Firing aborts the round's controller first, so a backend that can cancel
 * what it started does so through the signal it already holds, then rejects.
 * `Promise.race` keeps its subscription to the losing backend promise, so a
 * later settlement — a disposed child, a late expert result — is handled and
 * discarded, never an unhandled rejection.
 */
async function withRoundDeadline(
  run: Promise<ReviewVerdict>,
  timeoutMs: number,
  round: AbortController,
): Promise<ReviewVerdict> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return run;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const failure = new ReviewerFailure(
            REVIEW_TIMEOUT_REASON,
            `the reviewer returned no verdict within ${Math.round(timeoutMs / 1000)}s`,
          );
          round.abort(failure);
          reject(failure);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
