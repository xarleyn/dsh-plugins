/**
 * The `ctx.jevCompaction` service: orchestration of one compaction run
 * (SPEC §5.3 pipeline), the automatic pressure trigger on a prepended
 * `agent/pre-step` listener, the per-session mutex, cooldown accounting, and
 * the deferred manual application demanded by the open-turn invariant (see
 * docs/compatibility.md §4).
 *
 * Fail-open everywhere (SPEC §4): an automatic failure logs and continues;
 * the agent loop and the built-in compaction stay untouched.
 */

import { Service } from "@deepseek-ai/cordis";
import type { Context } from "@deepseek-ai/cordis";
import type { Session } from "@deepseek-ai/dsh-session";
import {
  JevCompactionConfigSchema,
  resolveJevCompactionConfig,
  type JevCompactionConfig,
  type ResolvedJevCompactionConfig,
} from "./config.js";
import { measurePressure, surfaceNodeTokens } from "./dsh/meter.js";
import { captureSurfaceSnapshot } from "./dsh/surface.js";
import type {
  AgentLike,
  JevHostContext,
  LlmRuntimeLike,
  PreStepDecisionStruct,
  PreStepPayload,
  PressureSnapshot,
  TokenMeterLike,
} from "./dsh/types.js";
import { missingCredential, SystemOneClient } from "./jev/backend.js";
import { batchCandidates, mapWithConcurrency } from "./jev/batch.js";
import { questionsFor } from "./jev/questions.js";
import { buildState, fitState } from "./jev/state.js";
import type { JevQuestion, SystemOneBackend } from "./jev/types.js";
import {
  applyPlan,
  SurfaceChangedError,
  type AppliedEntry,
} from "./mutation/apply.js";
import { codePointLength, renderReplacement } from "./mutation/render.js";
import { collectCandidates } from "./planner/collect.js";
import { extractFeatures } from "./planner/features.js";
import {
  buildPlan,
  plannedSeqs,
  type JevCompactionPlan,
  type PlanItem,
} from "./planner/plan.js";
import { decideAction, type CandidateScores } from "./planner/policy.js";
import { meetsSavingsGate } from "./planner/savings.js";
import { JEV_EVENTS, jevLogger } from "./observability/logging.js";
import { registerJevCompactCommand } from "./commands/jev-compact.js";
import { installJevCompactionSettings } from "./settings/install.js";
import { ResultShapingSubsystem } from "./result-shaping/index.js";

declare module "@deepseek-ai/cordis" {
  interface Context {
    jevCompaction: JevCompactionService;
  }
}

/** Why a run started; drives trigger and reporting behavior. */
export type JevRunMode = "auto" | "manual";

/** Terse reason a run produced no mutation. */
export type JevSkipReason =
  | "disabled"
  | "busy"
  | "pressure-not-met"
  | "cooldown"
  | "not-enough-candidates"
  | "not-enough-candidate-chars"
  | "savings-gate"
  | "no-candidates"
  | "jev-failed"
  | "empty-plan";

/** Result of one completed run (successful, skipped, or failed). */
export interface JevRunReport {
  readonly mode: JevRunMode | "dry-run";
  readonly sessionId: string;
  readonly skipped?: JevSkipReason;
  readonly pressure?: PressureSnapshot;
  readonly candidates: number;
  readonly keptFull: number;
  readonly truncated: number;
  readonly stubbed: number;
  readonly charsBefore: number;
  readonly charsAfter: number;
  readonly tokensBefore?: number;
  readonly tokensAfter?: number;
  readonly jevRequests: number;
  readonly totalLatencyMs: number;
  readonly applied: readonly AppliedEntry[];
  /** Set when the run failed; the agent loop was still continued. */
  readonly error?: string;
  /** Set when a manual mutation request was queued for the next step. */
  readonly queuedForNextStep?: boolean;
  readonly plan?: JevCompactionPlan;
}

interface SessionState {
  lastAutoTurn: number | undefined;
  running: Promise<JevRunReport> | undefined;
  pendingManual: boolean;
}

/** Deterministic rendering of per-candidate reasons. */
function reasonFor(
  action: "KEEP_TRUNCATED" | "KEEP_STUB",
  scores: CandidateScores | undefined,
): string {
  if (action === "KEEP_TRUNCATED") return "partial retention score";
  if (scores !== undefined && scores.needContents < 0.2)
    return "low semantic retention score";
  return "below retention thresholds";
}

function countAction(
  plan: JevCompactionPlan,
  action: PlanItem["action"],
): number {
  return plan.items.filter((item) => item.action === action).length;
}

export class JevCompactionService extends Service {
  static inject = ["tokenMeter"] as const;

  static Config = JevCompactionConfigSchema;

  /** The composition entry: the base layer under any settings override. */
  private readonly entryConfig: JevCompactionConfig;

  /**
   * The active configuration source. It is the composition entry while no
   * settings provider is attached and the resolved settings scope once one
   * is, so a live settings change reaches the next run without a restart.
   */
  private configSource: () => JevCompactionConfig;

  private resolvedConfig: ResolvedJevCompactionConfig;

  private readonly tokenMeter: TokenMeterLike;
  private readonly backend: SystemOneBackend;
  private readonly sessions = new Map<string, SessionState>();
  /** Backends whose key warning was already logged, keyed provider+variable. */
  private readonly warnedCredentials = new Set<string>();
  private readonly disposers: Array<() => void> = [];
  /** Immediate result shaping at `tools/post-execute` (SPEC result-shaping). */
  readonly shaping: ResultShapingSubsystem;

  /** Resolved and immutable configuration (re-resolved on settings change). */
  get config(): ResolvedJevCompactionConfig {
    return this.resolvedConfig;
  }

  constructor(
    ctx: Context,
    config: JevCompactionConfig = {},
    backend?: SystemOneBackend,
  ) {
    super(ctx, "jevCompaction");
    this.entryConfig = config;
    this.configSource = () => this.entryConfig;
    this.resolvedConfig = resolveJevCompactionConfig(config);
    this.tokenMeter = (
      ctx as unknown as { tokenMeter: TokenMeterLike }
    ).tokenMeter;
    // Test seam: stub decision engines are wired here, not through config.
    // The live client reads the configuration per request, so a settings
    // change to the endpoint, key variable, timeout or retries applies at
    // once without rebuilding the plugin.
    this.backend = backend ?? new SystemOneClient(() => this.resolvedConfig);
    this.warnOnMissingCredential();

    // Immediate shaping runs on the tool-execution path, so it is registered
    // through its own subsystem with its own budget, metrics and archive. Its
    // listener is also registered unconditionally and re-reads `enabled` per
    // call, which is what makes the settings toggle live in both directions.
    this.shaping = new ResultShapingSubsystem({
      owner: ctx,
      readConfig: () => this.resolvedConfig,
      backend: this.backend,
      debug: (event, details) => {
        jevLogger.debug(event, details);
      },
      info: (event, details) => {
        jevLogger.info(event, details);
      },
      warn: (event, details) => {
        jevLogger.warn(event, details);
      },
    });
    this.shaping.register();

    // The pre-step listener is registered unconditionally: `enabled` is
    // re-read from the live configuration on every step, so the settings
    // toggle takes effect without a restart. A disabled plugin skips at the
    // top of the pipeline and never touches a session.
    this.disposers.push(
      (ctx as unknown as JevHostContext).on(
        "agent/pre-step",
        (payload, next) => this.handlePreStep(payload, next),
        { prepend: true },
      ),
    );
    const commandHost = ctx as unknown as JevHostContext;
    commandHost.inject(["commands"], (injected) => {
      const commands = (
        injected as {
          commands?: Parameters<typeof registerJevCompactCommand>[0];
        }
      ).commands;
      if (commands === undefined) return;
      this.disposers.push(registerJevCompactCommand(commands, this));
    });

    installJevCompactionSettings({
      owner: ctx,
      entryConfig: this.entryConfig,
      schema: JevCompactionConfigSchema,
      setSource: (current) => {
        this.configSource = current;
      },
      onChange: () => {
        this.reapply();
      },
      validate: (value) => {
        resolveJevCompactionConfig(value);
      },
    });
  }

  /**
   * Re-resolve the runtime configuration from the active source and adopt it.
   * Every failure is contained: an invalid committed value leaves the running
   * plugin on its previous configuration instead of breaking the agent loop.
   */
  reapply(): void {
    try {
      this.resolvedConfig = resolveJevCompactionConfig(this.configSource());
      this.onConfigChanged();
    } catch (error: unknown) {
      this.reportFailure(error, "");
    }
  }

  /**
   * Hook for subsystems that cache configuration-derived state. Called after
   * every successful re-resolve, including the initial install.
   */
  protected onConfigChanged(): void {
    this.shaping.onConfigChanged();
    this.warnOnMissingCredential();
  }

  /**
   * Say once per configured backend that its API key variable is empty.
   *
   * The environment is not part of the config, so no resolver can refuse this:
   * without the line the first sign is a prune refused minutes later, which
   * reads as "the scorer is broken" rather than "the variable is unset". The
   * provider and the endpoint are logged with the variable name, so the operator
   * can see which backend the deployment actually points at.
   */
  private warnOnMissingCredential(): void {
    const missing = missingCredential(
      this.resolvedConfig.decision,
      this.resolvedConfig.jev,
      process.env,
    );
    if (missing === undefined) return;
    // NUL written as an escape: a literal one makes git treat this file as binary.
    const key = `${missing.provider}\u0000${missing.apiKeyEnv}`;
    if (this.warnedCredentials.has(key)) return;
    this.warnedCredentials.add(key);
    jevLogger.warn(JEV_EVENTS.credentialMissing, {
      ...missing,
      hint: 'every Jev decision will fail with "not configured" until the variable is set; a backend that needs no key is configured by pointing decision.provider at it (or by an empty apiKeyEnv)',
    });
  }

  /**
   * The `agent/pre-step` listener body. Public for tests; always continues
   * the waterfall (`next()`), never rejects the step.
   */
  async handlePreStep(
    payload: PreStepPayload,
    next: () => Promise<PreStepDecisionStruct>,
  ): Promise<PreStepDecisionStruct> {
    const sessionId = String(payload.agent.id ?? "");
    try {
      const state = this.sessions.get(sessionId);
      if (state?.pendingManual === true) {
        // Consume the queued manual request: we are inside the open
        // turn now, so the plan applies directly (applyNow).
        state.pendingManual = false;
        const report = await this.compact(payload.agent, {
          mode: "manual",
          applyNow: true,
          turn: payload.turn,
          signal: payload.signal,
        });
        if (report.skipped === "busy") state.pendingManual = true;
      } else {
        await this.maybeAutoCompact(
          payload.agent,
          payload.turn,
          payload.signal,
        );
      }
    } catch (error: unknown) {
      this.reportFailure(error, sessionId);
    }
    return next();
  }

  /** Automatic pressure-triggered run; swallows every failure. */
  async maybeAutoCompact(
    agent: AgentLike,
    turn: number,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const report = await this.runAuto(agent, turn, signal);
      if (report.skipped !== undefined) {
        jevLogger.debug(JEV_EVENTS.skip, {
          sessionId: report.sessionId,
          reason: report.skipped,
        });
      }
    } catch (error: unknown) {
      this.reportFailure(error, String(agent.id ?? ""));
    }
  }

  /** Automatic run reporting its outcome; used by tests and diagnostics. */
  runAuto(
    agent: AgentLike,
    turn: number,
    signal: AbortSignal,
  ): Promise<JevRunReport> {
    return this.compact(agent, { mode: "auto", turn, signal });
  }

  /** Queue the next pre-step into a manual (gate-bypassing) run. */
  queueManualRun(agent: AgentLike): boolean {
    const state = this.sessionState(String(agent.id ?? ""));
    if (state.pendingManual) return false;
    state.pendingManual = true;
    return true;
  }

  /** Manual dry-run: the full pipeline without any mutation. */
  async runManualDry(
    agent: AgentLike,
    signal: AbortSignal,
  ): Promise<JevRunReport> {
    return this.compact(agent, { mode: "manual", dryRun: true, signal });
  }

  private sessionState(sessionId: string): SessionState {
    let state = this.sessions.get(sessionId);
    if (state === undefined) {
      state = {
        lastAutoTurn: undefined,
        running: undefined,
        pendingManual: false,
      };
      this.sessions.set(sessionId, state);
    }
    return state;
  }

  private reportFailure(error: unknown, sessionId: string): void {
    jevLogger.warn(JEV_EVENTS.error, {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  private async compact(
    agent: AgentLike,
    options: {
      mode: JevRunMode;
      dryRun?: boolean;
      applyNow?: boolean;
      turn?: number;
      signal: AbortSignal;
    },
  ): Promise<JevRunReport> {
    const mode = options.dryRun === true ? "dry-run" : options.mode;
    const sessionId = String(agent.id ?? "");
    const state = this.sessionState(sessionId);
    const started = Date.now();

    // Per-session mutex (SPEC §17.1): one run at a time, shared by the
    // auto and manual paths.
    if (state.running !== undefined) {
      return this.skippedReport(mode, sessionId, "busy", started);
    }
    const run = this.runPipeline(agent, options, {
      sessionId,
      started,
    }).finally(() => {
      if (state.running === run) state.running = undefined;
    });
    state.running = run;
    return run;
  }

  private skippedReport(
    mode: JevRunMode | "dry-run",
    sessionId: string,
    reason: JevSkipReason,
    started: number,
  ): JevRunReport {
    return {
      mode,
      sessionId,
      skipped: reason,
      candidates: 0,
      keptFull: 0,
      truncated: 0,
      stubbed: 0,
      charsBefore: 0,
      charsAfter: 0,
      jevRequests: 0,
      totalLatencyMs: Date.now() - started,
      applied: [],
    };
  }

  private async runPipeline(
    agent: AgentLike,
    options: {
      mode: JevRunMode;
      dryRun?: boolean;
      applyNow?: boolean;
      turn?: number;
      signal: AbortSignal;
    },
    context: { sessionId: string; started: number },
  ): Promise<JevRunReport> {
    const { signal } = options;
    const mode: JevRunMode | "dry-run" =
      options.dryRun === true ? "dry-run" : options.mode;
    const { sessionId, started } = context;
    const session = agent.session;
    const state = this.sessionState(sessionId);
    const skip = (reason: JevSkipReason): JevRunReport =>
      this.skippedReport(mode, sessionId, reason, started);

    if (!this.config.enabled) return skip("disabled");

    const pressure = await measurePressure(
      session,
      this.tokenMeter,
      this.llmRuntime(),
      signal,
    );
    if (signal.aborted) return skip("busy");

    // Automatic trigger policy (SPEC §8). Without a resolvable context
    // window the ratio check falls back to the absolute token floor.
    if (mode === "auto") {
      if (
        options.turn !== undefined &&
        state.lastAutoTurn !== undefined &&
        options.turn - state.lastAutoTurn < this.config.trigger.cooldownTurns
      ) {
        return skip("cooldown");
      }
      const pressureQualified =
        pressure.contextWindow !== undefined
          ? (pressure.totalTokens ?? 0) >=
            pressure.contextWindow * this.config.trigger.contextRatio
          : (pressure.totalTokens ?? 0) >= this.config.trigger.minSurfaceTokens;
      if (!pressureQualified) return skip("pressure-not-met");
      if (
        pressure.estimatedSurfaceTokens < this.config.trigger.minSurfaceTokens
      ) {
        return skip("pressure-not-met");
      }
    }

    // Candidate collection with pinning (SPEC §9).
    const nodeTokens = surfaceNodeTokens(this.tokenMeter, session);
    const { candidates, callIndex } = collectCandidates(
      session,
      this.config,
      nodeTokens,
    );
    const candidateChars = candidates.reduce(
      (sum, candidate) => sum + candidate.originalChars,
      0,
    );
    if (
      mode === "auto" &&
      candidates.length < this.config.trigger.minCandidates
    ) {
      return skip("not-enough-candidates");
    }
    if (
      mode === "auto" &&
      candidateChars < this.config.trigger.minCandidateChars
    ) {
      return skip("not-enough-candidate-chars");
    }
    if (candidates.length === 0) return skip("no-candidates");

    jevLogger.debug(JEV_EVENTS.check, {
      sessionId,
      mode,
      candidates: candidates.length,
      candidateChars,
      surfaceTokens: pressure.estimatedSurfaceTokens,
    });

    // Snapshot identity before async work (SPEC §17.2).
    const surfaceSnapshot = captureSurfaceSnapshot(session);

    // State building + fitting (SPEC §11, §19).
    const features = extractFeatures(candidates, callIndex);
    const built = buildState(
      session,
      { candidates, features, callIndex },
      this.config,
    );
    const fitted = fitState(built.state, this.config.state.maxStateTokens);

    // Batching + scoring (SPEC §18, §19). Any malformed batch fails the
    // run fail-open (SPEC §18.4).
    const batches = batchCandidates(
      candidates,
      fitted.tokens,
      this.config.state.maxRequestTokens,
    );
    let jevRequests = 0;
    const scores = new Map<string, CandidateScores>();
    try {
      const batchResults = await mapWithConcurrency(
        batches,
        this.config.jev.maxConcurrency,
        async (batch) => {
          const questions: JevQuestion[] = questionsFor(batch);
          jevRequests += 1;
          jevLogger.debug(JEV_EVENTS.request, {
            sessionId,
            questions: questions.length,
            stage: fitted.stage,
          });
          const answers = await this.backend.score(
            fitted.state,
            questions,
            signal,
          );
          return { batch, answers };
        },
      );
      for (const { batch, answers } of batchResults) {
        for (const candidate of batch) {
          const needContents = answers.get(`needContents_${candidate.callId}`);
          const needVerbatim = answers.get(`needVerbatim_${candidate.callId}`);
          if (needContents === undefined) {
            throw new Error(`missing decision for ${candidate.callId}`);
          }
          scores.set(candidate.callId, { needContents, needVerbatim });
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (!signal.aborted) this.reportFailure(error, sessionId);
      return { ...skip("jev-failed"), error: message };
    }

    // Policy + rendering (SPEC §13, §14).
    const items: PlanItem[] = candidates.map((candidate) => {
      const candidateScores = scores.get(candidate.callId);
      const action = decideAction(
        candidateScores ?? { needContents: 1 },
        this.config,
      );
      if (action === "KEEP_FULL") {
        return {
          candidate,
          features: features.get(candidate.callId),
          scores: candidateScores,
          action,
          replacementChars: candidate.originalChars,
        };
      }
      const replacementText = renderReplacement(
        candidate,
        action,
        this.config.pruning.truncateHeadChars,
        this.config.pruning.truncateTailChars,
        reasonFor(action, candidateScores),
      );
      return {
        candidate,
        features: features.get(candidate.callId),
        scores: candidateScores,
        action,
        replacementText,
        replacementChars: codePointLength(replacementText),
      };
    });
    const plan = buildPlan(surfaceSnapshot, items);

    // Minimum savings gate (SPEC §20): auto skips; dry-run and manual
    // previews always report the plan.
    if (mode === "auto" && !meetsSavingsGate(plan.savings, this.config)) {
      return skip("savings-gate");
    }

    jevLogger.info(JEV_EVENTS.plan, {
      sessionId,
      mode,
      candidates: plan.items.length,
      mutations: plan.mutations.length,
      charsSaved: plan.savings.charsSaved,
      jevRequests,
    });

    const counts = {
      candidates: plan.items.length,
      keptFull: countAction(plan, "KEEP_FULL"),
      truncated: countAction(plan, "KEEP_TRUNCATED"),
      stubbed: countAction(plan, "KEEP_STUB"),
    };

    if (options.dryRun === true || plan.mutations.length === 0) {
      return {
        mode,
        sessionId,
        pressure,
        skipped: plan.mutations.length === 0 ? "empty-plan" : undefined,
        ...counts,
        charsBefore: candidateChars,
        charsAfter: candidateChars - plan.savings.charsSaved,
        tokensBefore: pressure.estimatedSurfaceTokens,
        tokensAfter: this.estimateTokensAfter(session, plan),
        jevRequests,
        totalLatencyMs: Date.now() - started,
        applied: [],
        plan: plan.mutations.length > 0 ? plan : undefined,
      };
    }

    // Manual non-dry-run previews queue the application for the next
    // pre-step: command handlers run between turns, where the open-turn
    // invariant forbids `tool/result` replacements (see
    // docs/compatibility.md §4). applyNow runs consume the queue inside
    // the open turn instead of re-queueing.
    if (mode === "manual" && options.applyNow !== true) {
      state.pendingManual = true;
      jevLogger.info(JEV_EVENTS.queued, {
        sessionId,
        mutations: plan.mutations.length,
      });
      return {
        mode,
        sessionId,
        pressure,
        ...counts,
        charsBefore: candidateChars,
        charsAfter: candidateChars - plan.savings.charsSaved,
        tokensBefore: pressure.estimatedSurfaceTokens,
        tokensAfter: this.estimateTokensAfter(session, plan),
        jevRequests,
        totalLatencyMs: Date.now() - started,
        applied: [],
        queuedForNextStep: true,
        plan,
      };
    }

    // Automatic application inside the open turn: revalidate, then land
    // replacements in snapshotted surface order (SPEC §16).
    let applied: readonly AppliedEntry[];
    let failureMessage: string | undefined;
    try {
      const outcome = applyPlan(session, plan);
      applied = outcome.applied;
      if (outcome.failure !== undefined) {
        failureMessage =
          outcome.failure.error instanceof Error
            ? outcome.failure.error.message
            : String(outcome.failure.error);
      }
    } catch (error: unknown) {
      if (error instanceof SurfaceChangedError) return skip("busy");
      const message = error instanceof Error ? error.message : String(error);
      this.reportFailure(error, sessionId);
      return { ...skip("jev-failed"), error: message };
    }

    // Cooldown accounting only for applied automatic runs.
    if (mode === "auto" && options.turn !== undefined)
      state.lastAutoTurn = options.turn;

    const tokensAfter = this.remeasure(session);
    jevLogger.info(JEV_EVENTS.applied, {
      sessionId,
      mode,
      applied: applied.length,
      replacements: applied.map((entry) => ({
        originalSeq: entry.originalSeq,
        replacementSeq: entry.replacementSeq,
      })),
      partial: failureMessage,
      tokensBefore: pressure.estimatedSurfaceTokens,
      tokensAfter,
    });
    return {
      mode,
      sessionId,
      pressure,
      ...counts,
      charsBefore: candidateChars,
      charsAfter: candidateChars - plan.savings.charsSaved,
      tokensBefore: pressure.estimatedSurfaceTokens,
      tokensAfter,
      jevRequests,
      totalLatencyMs: Date.now() - started,
      applied,
      error: failureMessage,
      plan,
    };
  }

  private llmRuntime(): LlmRuntimeLike | undefined {
    try {
      return (this.ctx as unknown as Record<string, unknown>).llm as
        LlmRuntimeLike | undefined;
    } catch {
      return undefined;
    }
  }

  private remeasure(session: Session): number | undefined {
    try {
      return this.tokenMeter.measure(session).surfaceTokens;
    } catch {
      return undefined;
    }
  }

  /** Post-mutation surface token estimate from per-node prices. */
  private estimateTokensAfter(
    session: Session,
    plan: JevCompactionPlan,
  ): number | undefined {
    try {
      const measurement = this.tokenMeter.measure(session);
      const replaced = new Set<number>(plannedSeqs(plan));
      const replacedTokens = measurement.nodes
        .filter((node) => replaced.has(node.seq))
        .reduce((sum, node) => sum + node.heuristicTokens, 0);
      const renderedTokens = plan.mutations.reduce(
        (sum, item) =>
          sum +
          (item.replacementText !== undefined
            ? this.tokenMeter.estimateMessage({
                role: "user",
                content: [{ type: "text", text: item.replacementText }],
              })
            : 0),
        0,
      );
      return Math.max(
        0,
        measurement.surfaceTokens - replacedTokens + renderedTokens,
      );
    } catch {
      return undefined;
    }
  }

  /** Dispose listeners and the command registration (fail-open teardown). */
  dispose(): void {
    this.shaping.dispose();
    for (const disposer of this.disposers.splice(0)) {
      try {
        disposer();
      } catch {
        // Teardown must never throw.
      }
    }
    this.sessions.clear();
  }
}

export default JevCompactionService;
