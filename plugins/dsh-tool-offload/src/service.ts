/**
 * Public `ctx.toolOffload` service.
 *
 * A Cordis `Service` that wires the resolved config, the non-blocking
 * concurrency gates, the one-shot worker runner, and the `tools/post-execute`
 * interception listener. Both `tools` and `subagents` are required host
 * services (SPEC §7.1, §36.7): the plugin stays pending until they are
 * available, and `requiredHostFeatures` in `compatibility.json` declares the
 * contract.
 *
 * Members use TypeScript `private` (not `#private`) because the host exposes
 * the service through a Cordis accessor proxy — the same convention the
 * reference plugins follow.
 */

import { Context, Service } from "@deepseek-ai/cordis";
import { createHostLoggerSink, getPluginLogger, type PluginLogger } from "@yadsh/dsh-plugin-log";

import {
  ToolOffloadConfigSchema,
  resolveToolOffloadConfig,
  type ResolvedToolOffloadConfig,
  type ToolOffloadConfig,
} from "./config.js";
import { createPostExecuteListener, type ToolOffloadListener } from "./integration/post-execute.js";
import type { PluginLoggerLike } from "./logging.js";
import { deriveOffloadMetrics, OffloadCounters, type OffloadCounterSnapshot } from "./telemetry/counters.js";
import { KeyedLimiter, Semaphore } from "./utils/semaphore.js";
import { createSubagentRunner, type SubagentsServiceLike, type WorkerRunnerLike } from "./worker/runner.js";

/** Overridable internals for tests (fake runner, silent logger). */
export interface ToolOffloadServiceDeps {
  readonly logger?: PluginLoggerLike;
  readonly counters?: OffloadCounters;
  /** Prebuilt runner; defaults to a `ctx.subagents`-backed runner. */
  readonly runner?: WorkerRunnerLike;
}

interface OffloadHostContextLike {
  subagents: SubagentsServiceLike;
  on(event: "tools/post-execute", listener: ToolOffloadListener): () => void;
}

/** Aggregated statistics served by the service surface (SPEC §26-§27). */
export interface ToolOffloadStats {
  readonly runtime: OffloadCounterSnapshot;
  readonly derived: ReturnType<typeof deriveOffloadMetrics>;
  readonly config: {
    readonly enabled: boolean;
    readonly mode: string;
    readonly allow: readonly string[];
    readonly deny: readonly string[];
    readonly thresholds: ResolvedToolOffloadConfig["routing"]["thresholds"];
    readonly defaultWorker: string;
    readonly workers: readonly string[];
    readonly fallbackMode: string;
  };
}

export class ToolOffloadService extends Service {
  static Config = ToolOffloadConfigSchema;

  readonly config: ResolvedToolOffloadConfig;
  readonly counters: OffloadCounters;
  private readonly logger: PluginLoggerLike & { close?(): Promise<void> };
  private readonly globalGate: Semaphore;
  private readonly agentGate: KeyedLimiter;
  private disposed = false;

  constructor(ctx: Context, config: ToolOffloadConfig = {}, deps: ToolOffloadServiceDeps = {}) {
    super(ctx, "toolOffload");
    this.config = resolveToolOffloadConfig(config);
    this.counters = deps.counters ?? new OffloadCounters();
    this.globalGate = new Semaphore(this.config.concurrency.maxWorkersGlobal);
    this.agentGate = new KeyedLimiter(this.config.concurrency.maxWorkersPerAgent);
    this.logger =
      deps.logger ??
      (getPluginLogger({
        pluginId: "dsh-tool-offload",
        consoleSink: createHostLoggerSink(ctx.logger),
      }) as PluginLogger & PluginLoggerLike);

    const disposers: (() => void)[] = [];
    ctx.inject(["tools", "subagents"], (host: OffloadHostContextLike) => {
      const runner = deps.runner ?? createSubagentRunner(host.subagents);
      disposers.push(
        host.on(
          "tools/post-execute",
          createPostExecuteListener({
            readConfig: () => this.config,
            runner,
            counters: this.counters,
            logger: this.logger,
            globalGate: this.globalGate,
            agentGate: this.agentGate,
          }),
        ),
      );
    });

    ctx.effect(() => () => void this.dispose(), "dsh-tool-offload.lifecycle");
    this.logger.info("offload.plugin_ready", {
      enabled: this.config.enabled,
      mode: this.config.routing.mode,
      allow: [...this.config.routing.allow],
      deny: [...this.config.routing.deny],
      minBytes: this.config.routing.thresholds.minBytes,
      minEstimatedTokens: this.config.routing.thresholds.minEstimatedTokens,
      defaultWorker: this.config.defaultWorker,
      fallbackMode: this.config.fallback.mode,
    });
  }

  /** Runtime counters merged with derived savings metrics (SPEC §26). */
  stats(): ToolOffloadStats {
    const runtime = this.counters.snapshot();
    return {
      runtime,
      derived: deriveOffloadMetrics(runtime),
      config: {
        enabled: this.config.enabled,
        mode: this.config.routing.mode,
        allow: [...this.config.routing.allow],
        deny: [...this.config.routing.deny],
        thresholds: this.config.routing.thresholds,
        defaultWorker: this.config.defaultWorker,
        workers: Object.keys(this.config.workers),
        fallbackMode: this.config.fallback.mode,
      },
    };
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    void this.logger.close?.();
  }
}
