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
  declinesAnswerReview,
  type CandidateSession,
} from "./candidate.js";
import type { ResolvedAnswerReviewGateConfig } from "./config.js";
import { DelegationTracker } from "./delegation-tracker.js";
import {
  createDomainExpertBackend,
  createSubagentBackend,
} from "./adapters/reviewers.js";
import {
  renderClosedModeSteer,
  renderQualificationSteer,
  renderRevisionSteer,
  steerSummary,
} from "./prompt.js";
import type {
  DomainExpertsFace,
  ReviewAuditEntry,
  ReviewInput,
  ReviewSeverity,
  ReviewVerdict,
  SubagentsFace,
} from "./types.js";
import { ReviewerFailure } from "./types.js";
import type { ReviewAudit } from "./audit.js";

/** Minimal structural view of the reviewed agent. */
export interface GateAgent {
  /** Durable session id of the agent (branded string at runtime). */
  readonly id: string;
  readonly session: {
    readonly header: {
      readonly origin?: string;
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
  /** A review of this session is awaited; no second reviewer may start. */
  reviewing: boolean;
  /** Hash of the candidate a review PASS applies to. */
  lastPassedHash?: string;
}

export interface AnswerReviewGateDeps {
  readonly config: () => ResolvedAnswerReviewGateConfig;
  readonly logger: GateLogSink;
  readonly audit: ReviewAudit;
  readonly now: () => number;
  /** Per-call service resolvers keep optional backends soft. */
  readonly domainExperts: () => DomainExpertsFace | undefined;
  readonly subagents: () => SubagentsFace | undefined;
  /**
   * Deliver one plugin-sourced steer message to the agent (production:
   * `createUserMessage` with the plugin source; injectable for tests).
   */
  readonly steerMessage: (
    agent: GateAgent,
    text: string,
    summary: string,
  ) => void;
}

/** Outcome of one boundary decision, for the event handler's audit log. */
export type BoundaryOutcome =
  "pass" | "revise" | "failure" | "suppressed-pending-work" | null;

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
    const collected = collectCandidate(agent.session);
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

    if (collected === null || collected.text.length < config.minCandidateChars)
      return null;
    if (declinesAnswerReview(collected.requestText)) {
      this.deps.logger.info("gate.skipped-user-opt-out", {
        sessionId,
        turn,
        userTurn: state.userTurn,
      });
      return null;
    }
    const hash = candidateHash(collected.text);
    if (state.lastPassedHash === hash) {
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
    collected: { readonly text: string; readonly requestText: string | null },
    state: GateSessionState,
    signal: AbortSignal,
    config: ResolvedAnswerReviewGateConfig,
  ): Promise<BoundaryOutcome> {
    const startedAt = this.deps.now();
    const backend = this.backendFor(agent, config);
    const input: ReviewInput = {
      sessionId,
      turn,
      requestText: collected.requestText,
      candidateText: collected.text,
      signal,
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
    try {
      verdict = await backend.review(input);
    } catch (error) {
      const failure =
        error instanceof ReviewerFailure
          ? error
          : new ReviewerFailure(
              "reviewer-crashed",
              error instanceof Error ? error.message : String(error),
            );
      state.round += 1;
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
    }
    state.round += 1;
    const durationMs = this.deps.now() - startedAt;
    if (verdict.verdict === "pass") {
      state.lastPassedHash = hash;
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
  ): {
    readonly name: string;
    readonly reviewer: string;
    readonly review: (input: ReviewInput) => Promise<ReviewVerdict>;
  } {
    if (config.reviewer.backend === "subagent") {
      return createSubagentBackend({
        face: this.deps.subagents(),
        config: config.reviewer,
        parent: agent,
      });
    }
    return createDomainExpertBackend({
      face: this.deps.domainExperts(),
      config: config.reviewer,
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
        reviewing: false,
      };
      this.states.set(sessionId, fresh);
      return fresh;
    }
    existing.lastTurn = turn;
    if (userTurn !== null && existing.userTurn !== userTurn) {
      existing.userTurn = userTurn;
      existing.round = 0;
      existing.failureSteered = false;
      existing.lastPassedHash = undefined;
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
