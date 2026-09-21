/**
 * Public `ctx.safetyGate` service: wires the two-layer safety gate onto the
 * DSH extension points and exposes the operator surfaces behind it.
 *
 * Registered listeners (design SPEC §9, §10, §17, §18):
 *  - `agent/pre-step` — input guard (authoritative prompt gate);
 *  - `llm/stream` — output stream guard (quarantine / interrupt / observe);
 *  - `tools/pre-execute` — tool-call gate;
 *  - `tools/post-execute` — tool-result injection guard + turn risk state.
 *
 * Classifier calls made by this service run inside a process-local bypass
 * marker, so the `llm/stream` wrapper passes them through untouched — the
 * moderator is never moderated (design SPEC §8). The host context is viewed
 * through a structural interface at the registration seam (repo convention:
 * real event key unions are scoped to runtime sub-contexts).
 *
 * Two operator-facing seams hang off the same service:
 *  - the `model-safety-gate` settings namespace, installed as the base layer
 *    so a card edit re-resolves the running configuration without a restart;
 *  - the `safetyGate` Typert Remote, whose single `inspect` method returns the
 *    effective configuration, the counters, the recent sanitized verdicts, and
 *    the classifier wiring state.
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-settings";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import {
  createHostLoggerSink,
  getPluginLogger,
  type PluginLogger,
} from "@yadsh/dsh-plugin-log";

import {
  createDshClassifierTransport,
  type DshLlmRuntime,
} from "./classifier/dsh-backend.js";
import { isSafetyInternal } from "./classifier/isolation.js";
import { createOpenAiCompatibleTransport } from "./classifier/openai-backend.js";
import {
  SafetyClassifierService,
  type ClassifierTransport,
} from "./classifier/service.js";
import { type SafetyAuditEvent, type SafetyEventType } from "./audit/events.js";
import { SafetyMetrics } from "./audit/metrics.js";
import {
  ModelSafetyGateConfigSchema,
  resolveSafetyGateConfig,
  type ModelSafetyGateConfig,
  type ResolvedSafetyGateConfig,
} from "./config.js";
import {
  createInputGuard,
  type PreStepDecisionStruct,
  type PreStepPayload,
} from "./guards/input.js";
import { guardOutputStream } from "./guards/output-stream.js";
import { TurnRiskTracker } from "./guards/risk-state.js";
import { createPostExecuteGuard } from "./guards/tool-results.js";
import type { ApprovalFace } from "./guards/approval-seam.js";
import { createPreExecuteGuard } from "./guards/tools.js";
import { CheckPipeline } from "./pipeline.js";
import { SafetyScanner } from "./rules/scanner.js";
import { SAFETY_GATE_SETTINGS_NAMESPACE } from "./shared/settings.js";
import { cancelTurn, type CancellableAgent } from "./stream/cancellation.js";
import type { StreamChunk } from "./stream/chunks.js";
import type {
  SafetyGateAuditRow,
  SafetyGateClassifierState,
  SafetyGateInspect,
} from "./types.js";

/** Structural view of the host context used at the registration seam. */
export interface SafetyGateHostContext {
  on(
    event: string,
    listener: (...args: never[]) => unknown,
    options?: unknown,
  ): () => void;
  inject(services: readonly string[], fn: (ctx: ToolHostContext) => void): void;
  effect(factory: () => () => void, name: string): void;
  logger: {
    info(message: string, ...values: unknown[]): void;
    warn(message: string, ...values: unknown[]): void;
  };
  /**
   * Optional-service read. Every service this gate only *tolerates* is read
   * through here: the property proxy resolves per fiber topology and throws on
   * an undeclared name, so `ctx.get` is the only safe read for an optional
   * dependency (harness authoring rule, `packages/AGENTS.md`).
   */
  get(name: string): unknown;
}

/** Structural face of the agent registry this gate resolves live agents from. */
export interface AgentRegistryFace {
  get(id: unknown): CancellableAgent | undefined;
}

/** Structural view of the tool runtime sub-context. */
export interface ToolHostContext {
  on(event: string, listener: (...args: never[]) => unknown): () => void;
}

/** Overridable internals for tests. */
export interface SafetyGateServiceDeps {
  readonly logger?: PluginLogger;
  readonly metrics?: SafetyMetrics;
  readonly scanner?: SafetyScanner;
  readonly classifier?: SafetyClassifierService | null;
  readonly transport?: ClassifierTransport | null;
  readonly emit?: (type: SafetyEventType, event: SafetyAuditEvent) => void;
  readonly agentLookup?: (sessionId: string) => CancellableAgent | undefined;
}

/** In-memory ring of recent sanitized audit events (inspect surface). */
export class AuditRing {
  private readonly entries: SafetyAuditEvent[] = [];

  constructor(private readonly capacity = 200) {}

  push(event: SafetyAuditEvent): void {
    this.entries.push(event);
    if (this.entries.length > this.capacity) this.entries.shift();
  }

  list(): readonly SafetyAuditEvent[] {
    return [...this.entries];
  }
}

/** How many recent verdicts the inspect surface returns. */
const AUDIT_WINDOW = 50;

export class ModelSafetyGate extends TypertRemoteService {
  static Config = ModelSafetyGateConfigSchema;

  readonly metrics: SafetyMetrics;
  readonly auditRing: AuditRing = new AuditRing();
  readonly risk: TurnRiskTracker = new TurnRiskTracker();

  private readonly owner: Context;
  private readonly host: SafetyGateHostContext;
  private readonly deps: SafetyGateServiceDeps;
  private readonly logger: PluginLogger;
  private readonly entryConfig: ModelSafetyGateConfig;
  private readonly startedAt = Date.now();
  private readonly disposers: Array<() => void> = [];
  private readonly agentsBySession = new Map<string, CancellableAgent>();
  private configSource: () => ModelSafetyGateConfig;
  private resolved: ResolvedSafetyGateConfig;
  private scanner: SafetyScanner;
  private classifier: SafetyClassifierService | null;
  private pipeline: CheckPipeline;
  /**
   * Stable handle the guard listeners close over. The guards read
   * `deps.config` and `deps.pipeline` per call, so a configuration reload
   * republishes these fields and the next check runs on the new policy without
   * re-registering a listener.
   */
  private readonly guardDeps: {
    config: ResolvedSafetyGateConfig;
    pipeline: CheckPipeline;
    readonly risk: TurnRiskTracker;
    readonly approval: () => ApprovalFace | undefined;
  };
  private disposed = false;

  constructor(
    ctx: Context,
    config: ModelSafetyGateConfig = {},
    deps: SafetyGateServiceDeps = {},
  ) {
    // The Typert generator reads these as literals: the Cordis service key and
    // the wire namespace must be spelled here, not aliased through a constant.
    super(ctx, "safetyGate", { namespace: "safetyGate" });
    const host = ctx as unknown as SafetyGateHostContext;
    this.owner = ctx;
    this.host = host;
    this.deps = deps;
    this.entryConfig = structuredClone(config);
    this.configSource = () => this.entryConfig;
    this.resolved = resolveSafetyGateConfig(config);
    this.logger =
      deps.logger ??
      (getPluginLogger({
        pluginId: "dsh-model-safety-gate",
        console: "warn",
        consoleSink: createHostLoggerSink(
          host.logger as unknown as Context["logger"],
        ),
      }) as PluginLogger);
    this.metrics = deps.metrics ?? new SafetyMetrics();

    this.classifier = this.createClassifier();
    this.scanner = this.createScanner();
    this.pipeline = this.createPipeline();
    this.guardDeps = {
      config: this.resolved,
      pipeline: this.pipeline,
      risk: this.risk,
      // Read per call, like the agent registry: the tool gate asks the seam
      // only when it is about to escalate, and a host that composes no
      // approval service simply has none.
      approval: () => host.get("approval") as ApprovalFace | undefined,
    };

    this.registerGuards();
    host.effect(() => () => this.dispose(), "dsh-model-safety-gate.lifecycle");
    this.installSettings();
    this.logger.info("safety.plugin_ready", {
      enabled: this.resolved.enabled,
      mode: this.resolved.mode,
      classifierBackend: this.resolved.classifier.backend,
      streamMode: this.resolved.output.mode,
    });
  }

  /** Effective running configuration; the base layer until a settings layer attaches. */
  get config(): ResolvedSafetyGateConfig {
    return this.resolved;
  }

  /** Aggregated sanitized state for diagnostics and the operator card. */
  @Remote("inspect")
  inspect(): SafetyGateInspect {
    return {
      enabled: this.resolved.enabled,
      mode: this.resolved.mode,
      // The key literal never crosses a wire: the card learns only whether
      // one is configured.
      config: {
        ...this.resolved,
        classifier: { ...this.resolved.classifier, apiKey: "" },
      },
      classifier: this.describeClassifier(),
      metrics: this.metrics.snapshot(),
      audit: this.recentAudit(),
      startedAt: this.startedAt,
    };
  }

  /** Test/diagnostics hook mirroring the cancellation path (SPEC §15). */
  cancelSession(
    sessionId: string,
    reason: string,
    host?: SafetyGateHostContext,
  ): boolean {
    const lookup = (id: string): CancellableAgent | undefined =>
      (host === undefined
        ? undefined
        : (host.get("agents") as AgentRegistryFace | undefined)?.get(id)) ??
      this.agentsBySession.get(id);
    return cancelTurn(lookup, sessionId, reason);
  }

  // --------------------------------------------------------------- internals

  /**
   * Attach the settings namespace. The installed section becomes the gate's
   * configuration source, so a card edit re-resolves the running gate instead
   * of waiting for a restart; without a settings provider the composition entry
   * stays authoritative.
   */
  private installSettings(): void {
    this.owner.inject(["settings"], (settingsCtx) => {
      // A settings provider that appears after disposal must not adopt this
      // namespace: the card would edit a gate that no longer exists, and the
      // section would outlive the plugin that owns it.
      if (this.disposed) return;
      // Structural seam, like the rest of this file: the injected face is read
      // defensively so a host without a mounted settings provider keeps the
      // composition entry as the configuration source.
      const settings = (
        settingsCtx as unknown as { settings?: SettingsInstallFace }
      ).settings;
      if (settings === undefined) return;
      settings.installSection(
        this.owner,
        SAFETY_GATE_SETTINGS_NAMESPACE,
        ModelSafetyGateConfigSchema,
        this.entryConfig,
        {
          setSource: (current) => {
            this.configSource = current as () => ModelSafetyGateConfig;
          },
          onChange: () => {
            this.reapply();
          },
          // Constraints the schema cannot express (backend requires an
          // endpoint, custom patterns must compile) are refused at write time
          // so the card reports them instead of storing a config the gate
          // would silently keep ignoring.
          validate: (value) => {
            resolveSafetyGateConfig(value as ModelSafetyGateConfig);
          },
        },
      );
    });
  }

  /**
   * Re-resolve the source after a committed settings change and rebuild
   * everything derived from it. The guard listeners stay registered: they read
   * configuration and pipeline through {@link guardDeps}, so swapping those
   * fields is enough for the next check to run on the new policy.
   */
  private reapply(): void {
    // A committed settings change can land while the plugin is being disposed;
    // rebuilding a pipeline for a gate that is gone buys nothing and leaves a
    // logger to close twice.
    if (this.disposed) return;
    let next: ResolvedSafetyGateConfig;
    try {
      next = resolveSafetyGateConfig(this.configSource());
    } catch (error) {
      // The settings provider validates on write; this keeps a source that
      // turned invalid through another path from taking the running gate down.
      this.logger.warn("safety.config.rejected", {
        message: String((error as Error).message),
      });
      return;
    }
    this.resolved = next;
    this.classifier = this.createClassifier();
    this.scanner = this.createScanner();
    this.pipeline = this.createPipeline();
    // Guards read through the handle, so publishing the rebuilt pieces here is
    // what makes the change live.
    this.guardDeps.config = next;
    this.guardDeps.pipeline = this.pipeline;
    this.logger.info("safety.config.reloaded", {
      enabled: this.resolved.enabled,
      mode: this.resolved.mode,
      classifierBackend: this.resolved.classifier.backend,
      streamMode: this.resolved.output.mode,
    });
  }

  private createClassifier(): SafetyClassifierService | null {
    if (this.deps.classifier !== undefined) return this.deps.classifier;
    const classifierConfig = this.resolved.classifier;
    const options = {
      timeoutMs: classifierConfig.timeoutMs,
      maxTokens: classifierConfig.maxTokens,
      temperature: classifierConfig.temperature,
      failureMode: classifierConfig.failureMode,
    };
    if (this.deps.transport !== undefined) {
      return new SafetyClassifierService({
        transport: this.deps.transport,
        ...options,
      });
    }
    return new SafetyClassifierService({
      transport: this.buildTransport(),
      ...options,
    });
  }

  private buildTransport(): ClassifierTransport | null {
    const classifierConfig = this.resolved.classifier;
    if (classifierConfig.backend === "dsh") {
      const llm = this.host.get("llm") as DshLlmRuntime | undefined;
      if (llm === undefined) {
        this.logger.warn("safety.classifier.no_llm", {
          backend: classifierConfig.backend,
        });
        return null;
      }
      return createDshClassifierTransport(llm, {
        provider: classifierConfig.provider,
        model: classifierConfig.model,
      });
    }
    if (classifierConfig.backend === "openai-compatible") {
      return createOpenAiCompatibleTransport({
        baseURL: classifierConfig.baseURL,
        apiKey: classifierConfig.apiKey,
        model: classifierConfig.model,
      });
    }
    return null;
  }

  private createScanner(): SafetyScanner {
    return (
      this.deps.scanner ??
      new SafetyScanner({
        maxScanChars: this.resolved.maxScanChars,
        customBlockPatterns: this.resolved.customBlockPatterns,
      })
    );
  }

  private createPipeline(): CheckPipeline {
    return new CheckPipeline({
      scanner: this.scanner,
      classifier: this.classifier,
      config: this.resolved,
      metrics: this.metrics,
      emit:
        this.deps.emit ??
        ((type, event) => {
          this.auditRing.push(event);
          this.publishAudit(type, event);
        }),
    });
  }

  private describeClassifier(): SafetyGateClassifierState {
    const classifierConfig = this.resolved.classifier;
    const remote = classifierConfig.backend === "openai-compatible";
    const endpoint =
      classifierConfig.backend === "dsh"
        ? `${classifierConfig.provider}/${classifierConfig.model}`
        : classifierConfig.backend === "openai-compatible"
          ? classifierConfig.baseURL
          : "";
    const active = this.classifier !== null && this.classifier.enabled;
    let reason: string | null = null;
    if (classifierConfig.backend !== "none" && !active) {
      reason =
        classifierConfig.backend === "dsh"
          ? "The Harness LLM service is unavailable, so the classifier cannot run."
          : "No classifier transport could be built for this backend.";
    }
    return {
      backend: classifierConfig.backend,
      remote,
      endpoint,
      active,
      reason,
      apiKeyConfigured: (classifierConfig.apiKey ?? "").length > 0,
    };
  }

  private recentAudit(): readonly SafetyGateAuditRow[] {
    const entries = this.auditRing.list();
    const rows: SafetyGateAuditRow[] = [];
    for (
      let index = entries.length - 1;
      index >= 0 && rows.length < AUDIT_WINDOW;
      index -= 1
    ) {
      const event = entries[index];
      if (event === undefined) continue;
      rows.push({
        turn: event.turn,
        step: event.step,
        direction: event.direction,
        channel: event.channel,
        toolName: event.toolName,
        decision: event.decision,
        categories: [...event.categories],
        summary: event.summary,
        confidence: event.confidence,
        classifierProvider: event.classifierProvider,
        classifierModel: event.classifierModel,
        classifierRan: event.classifierRan,
        latencyMs: event.latencyMs,
        contentSha256: event.contentSha256,
        contentChars: event.contentChars,
        errorCode: event.errorCode ?? null,
        rawContent: event.rawContent ?? null,
        policyVersion: event.policyVersion,
      });
    }
    return rows;
  }

  private publishAudit(type: SafetyEventType, event: SafetyAuditEvent): void {
    // Audit supplement failures must never flip a gate decision.
    try {
      this.logger.info(type.replace("/", "."), {
        sessionId: event.sessionId,
        decision: event.decision,
        channel: event.channel,
        categories: event.categories,
        confidence: event.confidence,
        sha256: event.contentSha256,
        latencyMs: event.latencyMs,
        errorCode: event.errorCode,
        ...(event.rawContent === undefined
          ? {}
          : { rawContent: event.rawContent }),
      });
    } catch {
      // Logger failures are contained.
    }
  }

  private resolveAgentLookup(
    host: SafetyGateHostContext,
    deps: SafetyGateServiceDeps,
  ): (sessionId: string) => CancellableAgent | undefined {
    if (deps.agentLookup !== undefined) return deps.agentLookup;
    // Read per call: the gate must survive a host that mounts the registry later.
    return (sessionId: string): CancellableAgent | undefined =>
      (host.get("agents") as AgentRegistryFace | undefined)?.get(sessionId) ??
      this.agentsBySession.get(sessionId);
  }

  private registerGuards(): void {
    const host = this.host;
    const deps = this.deps;
    const agentLookup = this.resolveAgentLookup(host, deps);
    const guards = this.guardDeps;

    // The handle itself is the dependency: its accessors resolve against the
    // service's current fields on every check, which is what makes a settings
    // change take effect without re-registering listeners.
    const inputGuard = createInputGuard(guards);

    this.disposers.push(
      host.on(
        "agent/pre-step",
        (async (
          payload: PreStepAgentPayload,
          next: () => Promise<PreStepDecisionStruct>,
        ): Promise<PreStepDecisionStruct> => {
          const sessionId = String(payload.agent?.id ?? "");
          if (payload.agent !== undefined) {
            this.agentsBySession.set(sessionId, payload.agent);
            if (this.agentsBySession.size > 256) {
              const oldest = this.agentsBySession.keys().next();
              if (!oldest.done) this.agentsBySession.delete(oldest.value);
            }
          }
          return inputGuard({ ...payload, sessionId }, next);
        }) as never,
        { global: true },
      ),
    );

    this.disposers.push(
      host.on(
        "llm/stream",
        ((
          options: StreamGuardOptions,
          next: () => AsyncIterable<StreamChunk>,
        ): AsyncIterable<StreamChunk> => {
          const config = guards.config;
          if (
            !config.enabled ||
            config.mode === "off" ||
            !config.output.enabled
          )
            return next();
          if (isSafetyInternal()) return next();
          // Non-agent traffic (title generation, compaction, plugin one-shots)
          // stays bypass in 0.1 (design SPEC §16).
          if (options.purpose !== undefined) return next();
          const sessionId =
            options.sessionId !== undefined && options.sessionId !== null
              ? String(options.sessionId)
              : null;
          const agentKnown =
            sessionId !== null && agentLookup(sessionId) !== undefined;
          if (!agentKnown) return next();
          return guardOutputStream(next(), {
            config,
            pipeline: guards.pipeline,
            agentLookup,
            sessionId,
            turn: this.risk.get(sessionId)?.turn ?? null,
            step: null,
          });
        }) as never,
        { global: true },
      ),
    );

    host.inject(["tools"], (toolCtx) => {
      // The runtime may arrive while the plugin is being torn down (the
      // service mounts, the host disposes us, the injection callback runs
      // last). Registering there would push listeners into an array nobody
      // walks again, so the gate would keep deciding in a plugin that is gone.
      if (this.disposed) return;
      this.disposers.push(
        toolCtx.on("tools/pre-execute", createPreExecuteGuard(guards) as never),
      );
      this.disposers.push(
        toolCtx.on(
          "tools/post-execute",
          createPostExecuteGuard(guards) as never,
        ),
      );
    });

    this.disposers.push(() => {
      this.agentsBySession.clear();
    });
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const dispose of this.disposers) {
      try {
        dispose();
      } catch {
        // Disposal must stay idempotent and contained.
      }
    }
    this.disposers.length = 0;
    void this.logger.close();
  }
}

/** Structural subset of the real pre-step payload used at the adapter seam. */
interface PreStepAgentPayload extends PreStepPayload {
  readonly agent?: CancellableAgent;
}

/** Structural subset of `GenerateOptions` consumed by the stream guard. */
interface StreamGuardOptions {
  readonly sessionId?: string | null;
  readonly purpose?: string;
}

/** Structural view of the settings provider seam (typed in @deepseek-ai/dsh-settings). */
interface SettingsInstallFace {
  installSection(
    owner: Context,
    namespace: string,
    schema: unknown,
    entry: unknown,
    hooks: {
      setSource(current: () => unknown): void;
      onChange(): void;
      validate?(value: unknown): void;
    },
  ): void;
}

export { ModelSafetyGate as SafetyGateService };
