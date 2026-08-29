import type { ChangeDetectionMode, DocImpactConfig, FileSelector, Scope } from '../config/types.js';
import { createDetector } from '../changes/detector.js';
import type { ChangeDetector, FileChange, TurnBaseline } from '../changes/types.js';
import { matchImpacts } from '../graph/matcher.js';
import { autoResolveImpact, resolveImpact } from '../impact/resolution.js';
import type { Impact, ResolveImpactInput } from '../impact/types.js';
import { ImpactState } from '../impact/state.js';
import type { Attribution } from './reminder.js';
import { buildLimitMessage, buildReminderMessage } from './reminder.js';

export interface EngineSafety {
  maxReminderRounds: number;
  onLimit: 'allow' | 'warn' | 'error';
}

export interface EngineWorkspaceConfig {
  config: DocImpactConfig;
  safety: EngineSafety;
  maxSnapshotFiles: number;
  debug: boolean;
}

export interface EngineLogger {
  warn(message: string): void;
  info?(message: string): void;
  error?(message: string): void;
}

export interface EngineOptions {
  /** Resolves the effective workspace config for a cwd; `undefined` disables the plugin there. */
  configProvider: (cwd: string) => Promise<EngineWorkspaceConfig | undefined>;
  logger?: EngineLogger;
  /** Live-agent probe for attribution uncertainty (SPEC §49); returns how many agents are concurrently active. */
  concurrentAgents?: (cwd: string) => number;
  /** Detector seam for tests; defaults to the real Git/filesystem factory. */
  detectorFactory?: (
    mode: ChangeDetectionMode,
    cwd: string,
    options: { selectors: FileSelector[]; maxFiles: number },
  ) => Promise<ChangeDetector> | ChangeDetector;
}

export interface StopDecision {
  /** The grouped steering message, or `undefined` when the turn may close. */
  steer: string | undefined;
  pending: Impact[];
  changed: FileChange[];
  /** Selector-matched workspace files known at evaluation time. */
  knownFiles: ReadonlySet<string>;
  degraded: boolean;
}

export interface ResolveOutcome {
  resolved: number;
  remaining: Impact[];
}

interface Runtime {
  scope: Scope;
  turn: number;
  baseline: TurnBaseline;
  detector: ChangeDetector;
  state: ImpactState;
  safety: EngineSafety;
  changed: FileChange[];
  knownFiles: Set<string>;
  /** Fingerprints already warned/limit-noticed, so onLimit fires once each. */
  limitNoticed: Set<string>;
}

function allSelectors(config: DocImpactConfig): FileSelector[] {
  return config.rules
    .filter((rule) => rule.enabled)
    .flatMap((rule) => [rule.code, rule.docs]);
}

function runtimeKey(sessionId: string, turn: number, scope: Scope): string {
  return scope === 'session' ? sessionId : `${sessionId}@${turn}`;
}

/**
 * Host-agnostic impact engine: per-turn (or per-session) baseline capture,
 * change detection, matching, reminder policy, and explicit resolution.
 * The DSH adapter (src/dsh) only translates agent events into calls here.
 */
export class DocImpactEngine {
  readonly #options: EngineOptions;
  readonly #runtimes = new Map<string, Runtime>();
  readonly #pendingBaselines = new Map<string, Promise<void>>();

  constructor(options: EngineOptions) {
    this.#options = options;
  }

  #log(message: string): void {
    this.#options.logger?.info?.(`dsh-doc-impact: ${message}`);
  }

  #warn(message: string): void {
    this.#options.logger?.warn(`dsh-doc-impact: ${message}`);
  }

  /**
   * Capture the baseline for one turn (or, with session scope, once per
   * session). Deduplicated per key; the DSH adapter awaits this from the
   * turn's first pre-step, so it always precedes the agent's mutations.
   */
  async ensureBaseline(sessionId: string, cwd: string, turn: number): Promise<void> {
    const workspace = await this.#options.configProvider(cwd);
    if (workspace === undefined || workspace.config.rules.length === 0) return;

    const key = runtimeKey(sessionId, turn, workspace.config.defaults.scope);
    if (this.#runtimes.has(key)) return;
    const inFlight = this.#pendingBaselines.get(key);
    if (inFlight !== undefined) return inFlight;

    const capture = this.#capture(workspace, sessionId, cwd, turn, key);
    this.#pendingBaselines.set(key, capture);
    try {
      await capture;
    } finally {
      this.#pendingBaselines.delete(key);
    }
  }

  async #capture(
    workspace: EngineWorkspaceConfig,
    sessionId: string,
    cwd: string,
    turn: number,
    key: string,
  ): Promise<void> {
    try {
      const { config, safety, maxSnapshotFiles } = workspace;
      const mode: ChangeDetectionMode = config.defaults.changeDetection;
      const selectors = allSelectors(config);
      if (selectors.length === 0) return;

      const detectorOptions = { selectors, maxFiles: maxSnapshotFiles };
      const detector = this.#options.detectorFactory !== undefined
        ? await this.#options.detectorFactory(mode, cwd, detectorOptions)
        : await createDetector(mode, cwd, detectorOptions);
      const baseline = await detector.captureBaseline(cwd);
      if (baseline.degraded) {
        this.#warn(`baseline snapshot exceeded ${maxSnapshotFiles} files; results degrade gracefully`);
      }
      if (workspace.debug) {
        this.#log(`baseline captured for ${sessionId} turn ${turn} (${baseline.kind}, ${baseline.files.size} dirty path(s))`);
      }

      const runtime: Runtime = {
        scope: config.defaults.scope,
        turn,
        baseline,
        detector,
        state: new ImpactState({ maxReminderRounds: safety.maxReminderRounds }),
        safety,
        changed: [],
        knownFiles: new Set<string>(),
        limitNoticed: new Set<string>(),
      };
      this.#runtimes.set(key, runtime);
    } catch (error) {
      this.#warn(`baseline capture failed; impact checks stay inert for this turn (${String(error)})`);
    }
  }

  async #runtimeFor(sessionId: string, cwd: string, turn: number): Promise<Runtime | undefined> {
    const workspace = await this.#options.configProvider(cwd);
    if (workspace === undefined) return undefined;
    const key = runtimeKey(sessionId, turn, workspace.config.defaults.scope);
    const existing = this.#runtimes.get(key);
    if (existing !== undefined) return existing;
    await this.ensureBaseline(sessionId, cwd, turn);
    return this.#runtimes.get(key);
  }

  /**
   * The stop check (SPEC §13, §66): diff against the baseline, match rules,
   * auto-resolve satisfied impacts, and decide whether the turn must continue.
   * Never throws: any failure fails open and allows the turn to close.
   */
  async evaluateStop(
    sessionId: string,
    cwd: string,
    turn: number,
    options: { dryRun?: boolean } = {},
  ): Promise<StopDecision> {
    const idle: StopDecision = { steer: undefined, pending: [], changed: [], knownFiles: new Set<string>(), degraded: false };
    const runtime = await this.#runtimeFor(sessionId, cwd, turn);
    if (runtime === undefined) return idle;

    try {
      const diff = await runtime.detector.computeChanges(cwd, runtime.baseline);
      if (diff.degraded) this.#warn('change detection exceeded maxSnapshotFiles; results may be partial');

      const changedPaths = diff.changes.map((change) => change.path);
      const knownFiles = new Set<string>([
        ...changedPaths,
        ...(await runtime.detector.listFiles(cwd)).slice(0, 100_000),
      ]);

      const workspace = await this.#options.configProvider(cwd);
      if (workspace === undefined) return idle;
      const impacts = matchImpacts(workspace.config, changedPaths, { knownFiles });
      runtime.state.reconcile(impacts);

      // Automatic resolution (SPEC §31): a pending impact whose target changed
      // since detection is satisfied without an explicit resolve call.
      for (const impact of runtime.state.pending()) {
        const satisfied = autoResolveImpact(impact, changedPaths);
        if (satisfied.status !== impact.status) runtime.state.update(satisfied);
      }

      runtime.changed = diff.changes;
      runtime.knownFiles = knownFiles;

      const pending = runtime.state.pending();
      if (workspace.debug) {
        this.#log(`stop check: ${diff.changes.length} changed path(s), ${pending.length} pending impact(s)`);
      }

      if (options.dryRun === true) {
        return { steer: undefined, pending, changed: diff.changes, knownFiles, degraded: diff.degraded };
      }

      const steerables = pending.filter((impact) => runtime.state.shouldRemind(impact));
      for (const impact of steerables) runtime.state.recordReminder(impact);

      // Impacts still steerable this round are not limit-exhausted yet; only
      // the rest may trigger the one-shot onLimit handling (SPEC §34).
      const steerableIds = new Set(steerables.map((impact) => impact.id));
      const exhausted = pending.filter((impact) => !steerableIds.has(impact.id));
      let limitSteer: string | undefined;
      for (const impact of exhausted) {
        if (runtime.limitNoticed.has(impact.id)) continue;
        runtime.limitNoticed.add(impact.id);
        if (runtime.safety.onLimit === 'warn') {
          this.#warn(`reminder limit reached for impact ${impact.ruleId}; allowing stop`);
        } else if (runtime.safety.onLimit === 'error') {
          this.#options.logger?.error?.(`dsh-doc-impact: reminder limit reached for rule ${impact.ruleId}`);
          limitSteer ??= buildLimitMessage(exhausted, runtime.safety.maxReminderRounds);
        }
      }

      let steer: string | undefined;
      if (steerables.length > 0) {
        const attribution: Attribution = (this.#options.concurrentAgents?.(cwd) ?? 1) > 1 ? 'uncertain' : 'own';
        steer = buildReminderMessage(steerables, knownFiles, attribution);
      } else if (limitSteer !== undefined) {
        steer = limitSteer;
      }

      return { steer, pending, changed: diff.changes, knownFiles, degraded: diff.degraded };
    } catch (error) {
      this.#warn(`stop check failed; failing open (${String(error)})`);
      return idle;
    }
  }

  /** `/doc-impact check`: compute impacts now without touching reminder state. */
  async check(sessionId: string, cwd: string, turn: number): Promise<StopDecision> {
    return this.evaluateStop(sessionId, cwd, turn, { dryRun: true });
  }

  /** `/doc-impact changed`: the current agent-attributed file delta. */
  async changedFiles(sessionId: string, cwd: string, turn: number): Promise<FileChange[]> {
    const runtime = await this.#runtimeFor(sessionId, cwd, turn);
    if (runtime === undefined) return [];
    const diff = await runtime.detector.computeChanges(cwd, runtime.baseline);
    runtime.changed = diff.changes;
    return diff.changes;
  }

  async status(sessionId: string, cwd: string, turn: number): Promise<{ pending: Impact[]; resolved: Impact[] }> {
    const workspace = await this.#options.configProvider(cwd);
    if (workspace === undefined) return { pending: [], resolved: [] };
    const key = runtimeKey(sessionId, turn, workspace.config.defaults.scope);
    const runtime = this.#runtimes.get(key);
    if (runtime === undefined) return { pending: [], resolved: [] };
    const pending = runtime.state.pending();
    return {
      pending,
      resolved: runtime.state.all().filter((impact) => impact.status !== 'pending'),
    };
  }

  /** The `doc_impact_resolve` backend (SPEC §29-§31). */
  async resolve(
    sessionId: string,
    cwd: string,
    turn: number,
    input: ResolveImpactInput,
  ): Promise<ResolveOutcome> {
    const runtime = await this.#runtimeFor(sessionId, cwd, turn);
    if (runtime === undefined) throw new Error('no pending documentation impacts (no active baseline)');

    // Fresh delta, so an update made moments ago is visible immediately.
    const diff = await runtime.detector.computeChanges(cwd, runtime.baseline);
    const changedPaths = diff.changes.map((change) => change.path);

    const targets = runtime.state.pending().filter((impact) => impact.ruleId === input.ruleId);
    if (targets.length === 0) {
      throw new Error(`no pending impact for rule ${JSON.stringify(input.ruleId)} (already resolved or never triggered)`);
    }

    for (const impact of targets) {
      runtime.state.update(resolveImpact(impact, input, changedPaths));
    }
    this.#log(`resolved ${targets.length} impact(s) for rule ${input.ruleId} as ${input.status}`);
    return { resolved: targets.length, remaining: runtime.state.pending() };
  }

  /** Drop one finished turn's runtime (turn scope only). */
  disposeTurn(sessionId: string, turn: number): void {
    this.#runtimes.delete(`${sessionId}@${turn}`);
  }

  disposeSession(sessionId: string): void {
    for (const key of [...this.#runtimes.keys()]) {
      if (key === sessionId || key.startsWith(`${sessionId}@`)) this.#runtimes.delete(key);
    }
  }
}
