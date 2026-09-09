/**
 * Public `ctx.safetyGate` service: wires the two-layer safety gate onto the
 * DSH extension points.
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
 */

import { Context, Service } from "@deepseek-ai/cordis";
import { KNOWN_SESSION_EVENT_TYPES } from "@deepseek-ai/dsh-session";
import {
  createHostLoggerSink,
  getPluginLogger,
  type PluginLogger,
} from "@yadsh/dsh-plugin-log";

import { createDshClassifierTransport, type DshLlmRuntime } from "./classifier/dsh-backend.js";
import { isSafetyInternal } from "./classifier/isolation.js";
import { createOpenAiCompatibleTransport } from "./classifier/openai-backend.js";
import { SafetyClassifierService, type ClassifierTransport } from "./classifier/service.js";
import {
  SAFETY_EVENT_TYPES,
  type SafetyAuditEvent,
  type SafetyEventType,
} from "./audit/events.js";
import { SafetyMetrics, type SafetyMetricsSnapshot } from "./audit/metrics.js";
import { ModelSafetyGateConfigSchema, resolveSafetyGateConfig, type ModelSafetyGateConfig, type ResolvedSafetyGateConfig } from "./config.js";
import { createInputGuard, type PreStepDecisionStruct, type PreStepPayload } from "./guards/input.js";
import { guardOutputStream } from "./guards/output-stream.js";
import { TurnRiskTracker } from "./guards/risk-state.js";
import { createPostExecuteGuard } from "./guards/tool-results.js";
import { createPreExecuteGuard } from "./guards/tools.js";
import { CheckPipeline } from "./pipeline.js";
import { SafetyScanner } from "./rules/scanner.js";
import { cancelTurn, type CancellableAgent } from "./stream/cancellation.js";
import type { StreamChunk } from "./stream/chunks.js";

/** Structural view of the host context used at the registration seam. */
export interface SafetyGateHostContext {
  on(event: string, listener: (...args: never[]) => unknown, options?: unknown): () => void;
  inject(services: readonly string[], fn: (ctx: ToolHostContext) => void): void;
  effect(factory: () => () => void, name: string): void;
  logger: { info(message: string, ...values: unknown[]): void; warn(message: string, ...values: unknown[]): void };
  llm?: DshLlmRuntime;
  agents?: { get(id: unknown): CancellableAgent | undefined };
  sessions?: { get(id: unknown): { append(type: string, data: unknown): unknown } | undefined };
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

export interface SafetyGateInspect {
  readonly enabled: boolean;
  readonly mode: ResolvedSafetyGateConfig["mode"];
  readonly config: ResolvedSafetyGateConfig;
  readonly metrics: SafetyMetricsSnapshot;
  readonly audit: readonly SafetyAuditEvent[];
}

export class ModelSafetyGate extends Service {
  static Config = ModelSafetyGateConfigSchema;

  readonly config: ResolvedSafetyGateConfig;
  readonly metrics: SafetyMetrics;
  readonly auditRing = new AuditRing();
  readonly risk = new TurnRiskTracker();
  private readonly logger: PluginLogger;
  private readonly pipeline: CheckPipeline;
  private readonly classifier: SafetyClassifierService | null;
  private readonly disposers: Array<() => void> = [];
  private readonly knownEventTypes: string[] = [];
  private readonly agentsBySession = new Map<string, CancellableAgent>();
  private lastSessionId: string | null = null;
  private disposed = false;

  constructor(ctx: Context, config: ModelSafetyGateConfig = {}, deps: SafetyGateServiceDeps = {}) {
    super(ctx, "safetyGate");
    const host = ctx as unknown as SafetyGateHostContext;
    this.config = resolveSafetyGateConfig(config);
    this.logger =
      deps.logger ??
      (getPluginLogger({
        pluginId: "dsh-model-safety-gate",
        console: "warn",
        consoleSink: createHostLoggerSink(host.logger as unknown as Context["logger"]),
      }) as PluginLogger);
    this.metrics = deps.metrics ?? new SafetyMetrics();

    this.registerSessionEventTypes();

    this.classifier =
      deps.classifier !== undefined
        ? deps.classifier
        : deps.transport !== undefined
          ? new SafetyClassifierService({
              transport: deps.transport,
              timeoutMs: this.config.classifier.timeoutMs,
              maxTokens: this.config.classifier.maxTokens,
              temperature: this.config.classifier.temperature,
              failureMode: this.config.classifier.failureMode,
            })
          : this.buildClassifier(host);

    const scanner =
      deps.scanner ??
      new SafetyScanner({
        maxScanChars: this.config.maxScanChars,
        customBlockPatterns: this.config.customBlockPatterns,
      });

    this.pipeline = new CheckPipeline({
      scanner,
      classifier: this.classifier,
      config: this.config,
      metrics: this.metrics,
      emit:
        deps.emit ??
        ((type, event) => {
          this.auditRing.push(event);
          this.publishEvent(host, type, event);
        }),
    });

    this.registerGuards(host, deps);
    host.effect(() => () => this.dispose(), "dsh-model-safety-gate.lifecycle");
    this.logger.info("safety.plugin_ready", {
      enabled: this.config.enabled,
      mode: this.config.mode,
      classifierBackend: this.config.classifier.backend,
      streamMode: this.config.output.mode,
    });
  }

  /** Aggregated sanitized state for diagnostics and future UI. */
  inspect(): SafetyGateInspect {
    return {
      enabled: this.config.enabled,
      mode: this.config.mode,
      config: this.config,
      metrics: this.metrics.snapshot(),
      audit: this.auditRing.list(),
    };
  }

  // --------------------------------------------------------------- internals

  private buildClassifier(host: SafetyGateHostContext): SafetyClassifierService {
    const classifierConfig = this.config.classifier;
    let transport: ClassifierTransport | null = null;
    if (classifierConfig.backend === "dsh") {
      const llm = host.llm;
      if (llm === undefined) {
        this.logger.warn("safety.classifier.no_llm", { backend: classifierConfig.backend });
      } else {
        transport = createDshClassifierTransport(llm, {
          provider: classifierConfig.provider,
          model: classifierConfig.model,
        });
      }
    } else if (classifierConfig.backend === "openai-compatible") {
      transport = createOpenAiCompatibleTransport({
        baseURL: classifierConfig.baseURL,
        apiKey: classifierConfig.apiKey,
        model: classifierConfig.model,
      });
    }
    return new SafetyClassifierService({
      transport,
      timeoutMs: classifierConfig.timeoutMs,
      maxTokens: classifierConfig.maxTokens,
      temperature: classifierConfig.temperature,
      failureMode: classifierConfig.failureMode,
    });
  }

  /**
   * Custom session event types must be registered with the harness, which
   * otherwise refuses to reconstruct logs containing unknown events. They are
   * log-only and never part of the model surface.
   */
  private registerSessionEventTypes(): void {
    const known = KNOWN_SESSION_EVENT_TYPES as Set<string>;
    for (const type of Object.values(SAFETY_EVENT_TYPES)) {
      known.add(type);
      this.knownEventTypes.push(type);
    }
  }

  private publishEvent(host: SafetyGateHostContext, type: SafetyEventType, event: SafetyAuditEvent): void {
    // Audit supplement failures must never flip a gate decision.
    try {
      this.logger.info(type.replace("/", "."), {
        decision: event.decision,
        channel: event.channel,
        categories: event.categories,
        confidence: event.confidence,
        sha256: event.contentSha256,
        latencyMs: event.latencyMs,
        errorCode: event.errorCode,
      });
    } catch {
      // Logger failures are contained.
    }
    const sessionId = this.lastSessionId;
    if (sessionId === null) return;
    try {
      host.sessions?.get(sessionId)?.append(type, event);
    } catch {
      // Session append failures are contained.
    }
  }

  private resolveAgentLookup(host: SafetyGateHostContext, deps: SafetyGateServiceDeps): (sessionId: string) => CancellableAgent | undefined {
    if (deps.agentLookup !== undefined) return deps.agentLookup;
    return (sessionId: string): CancellableAgent | undefined =>
      host.agents?.get(sessionId) ?? this.agentsBySession.get(sessionId);
  }

  private registerGuards(host: SafetyGateHostContext, deps: SafetyGateServiceDeps): void {
    const agentLookup = this.resolveAgentLookup(host, deps);

    const inputGuard = createInputGuard({
      config: this.config,
      pipeline: this.pipeline,
      risk: this.risk,
    });

    this.disposers.push(
      host.on(
        "agent/pre-step",
        (async (payload: PreStepAgentPayload, next: () => Promise<PreStepDecisionStruct>): Promise<PreStepDecisionStruct> => {
          const sessionId = String(payload.agent?.id ?? "");
          if (payload.agent !== undefined) {
            this.agentsBySession.set(sessionId, payload.agent);
            if (this.agentsBySession.size > 256) {
              const oldest = this.agentsBySession.keys().next();
              if (!oldest.done) this.agentsBySession.delete(oldest.value);
            }
          }
          this.lastSessionId = sessionId.length > 0 ? sessionId : null;
          return inputGuard({ ...payload, sessionId }, next);
        }) as never,
        { global: true },
      ),
    );

    this.disposers.push(
      host.on(
        "llm/stream",
        ((options: StreamGuardOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> => {
          if (!this.config.enabled || this.config.mode === "off" || !this.config.output.enabled) return next();
          if (isSafetyInternal()) return next();
          // Non-agent traffic (title generation, compaction, plugin one-shots)
          // stays bypass in 0.1 (design SPEC §16).
          if (options.purpose !== undefined) return next();
          const sessionId = options.sessionId !== undefined && options.sessionId !== null ? String(options.sessionId) : null;
          const agentKnown = sessionId !== null && agentLookup(sessionId) !== undefined;
          if (!agentKnown) return next();
          return guardOutputStream(next(), {
            config: this.config,
            pipeline: this.pipeline,
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
      this.disposers.push(
        toolCtx.on(
          "tools/pre-execute",
          createPreExecuteGuard({
            config: this.config,
            pipeline: this.pipeline,
            risk: this.risk,
          }) as never,
        ),
      );
      this.disposers.push(
        toolCtx.on(
          "tools/post-execute",
          createPostExecuteGuard({
            config: this.config,
            pipeline: this.pipeline,
            risk: this.risk,
          }) as never,
        ),
      );
    });

    this.disposers.push(() => {
      this.agentsBySession.clear();
    });
  }

  /** Test/diagnostics hook mirroring the cancellation path (SPEC §15). */
  cancelSession(sessionId: string, reason: string, host?: SafetyGateHostContext): boolean {
    const lookup = (id: string): CancellableAgent | undefined =>
      (host !== undefined ? host.agents?.get(id) : undefined) ?? this.agentsBySession.get(id);
    return cancelTurn(lookup, sessionId, reason);
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const known = KNOWN_SESSION_EVENT_TYPES as Set<string>;
    for (const type of this.knownEventTypes) known.delete(type);
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

export { ModelSafetyGate as SafetyGateService };
