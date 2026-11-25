/**
 * Wiring of the immediate result shaper into the plugin (result-shaping SPEC
 * §29, §32, §48).
 *
 * The subsystem owns everything the two layers must not share: its own
 * per-turn budget, its own metrics, and its own archive handle. The archive
 * root is fixed for this mount, including all its background retention passes.
 */

import type { Context } from "@deepseek-ai/cordis";
import type { Session } from "@deepseek-ai/dsh-session";

import { collectArchive } from "../archive/gc.js";
import { LocalResultArchive, resolveArchiveRoot } from "../archive/local.js";
import type { OriginalResultArchive } from "../archive/types.js";
import type { ResolvedJevCompactionConfig } from "../config/index.js";
import { goalFromSession } from "../jev/state.js";
import type { SystemOneBackend } from "../jev/types.js";
import { JEV_EVENTS } from "../observability/logging.js";
import { TurnShapeBudget, latestTurn } from "./budget.js";
import { shapingEnabled } from "./eligibility.js";
import { createPostExecuteListener, type PostExecuteListener } from "./hook.js";
import {
  SHAPE_METRICS,
  ShapingMetrics,
  type ShapeSkipReason,
} from "./metrics.js";
import { ImmediateResultShaper } from "./shaper.js";

/** Structural view of the context surface this subsystem registers on. */
interface ToolHostContext {
  on(
    event: string,
    listener: PostExecuteListener,
    options?: unknown,
  ): () => void;
}

/** Minimal execution view used for the goal lookup. */
interface ExecLike {
  readonly agent?: { readonly session?: Session };
}

export interface ResultShapingDeps {
  /** The context the plugin was mounted on. */
  readonly owner: Context;
  readonly readConfig: () => ResolvedJevCompactionConfig;
  readonly backend: SystemOneBackend;
  /** Log levels the plugin honours; the subsystem never logs secrets. */
  readonly debug: (event: string, details: Record<string, unknown>) => void;
  readonly info: (event: string, details: Record<string, unknown>) => void;
  readonly warn: (event: string, details: Record<string, unknown>) => void;
  /** Test seam: a pre-built archive backend. */
  readonly archive?: OriginalResultArchive;
}

export class ResultShapingSubsystem {
  private readonly deps: ResultShapingDeps;
  private readonly disposers: Array<() => void> = [];
  /** Process-scoped counters, separate from historical compaction. */
  readonly metrics = new ShapingMetrics();
  private readonly budget = new TurnShapeBudget();
  private readonly archive: OriginalResultArchive;
  private readonly shaper: ImmediateResultShaper;
  private collectionLifetime = new AbortController();
  private retention: ResolvedJevCompactionConfig["archive"];
  private disposed = false;
  private collection: Promise<void> | undefined;
  private collectionRequested = false;

  constructor(deps: ResultShapingDeps) {
    this.deps = deps;
    const config = deps.readConfig();
    this.retention = config.archive;
    this.archive =
      deps.archive ?? new LocalResultArchive(resolveArchiveRoot(config));
    this.shaper = new ImmediateResultShaper({
      readConfig: deps.readConfig,
      backend: deps.backend,
      archive: this.archive,
      onArchived: () => {
        void this.collectArchive();
      },
      metrics: this.metrics,
      onSkip: (reason, details) => {
        this.deps.debug(JEV_EVENTS.shapingSkip, { reason, ...details });
      },
      onShaped: (details) => {
        this.deps.info(JEV_EVENTS.shapingApplied, details);
      },
    });
  }

  /** Register the `tools/post-execute` listener (prepended: outer wrapper). */
  register(): void {
    const host = this.deps.owner as unknown as ToolHostContext;
    this.disposers.push(
      host.on(
        "tools/post-execute",
        createPostExecuteListener({
          shaper: this.shaper,
          readConfig: this.deps.readConfig,
          reserveBudget: (exec, chars) => {
            const session = (exec as unknown as ExecLike).agent?.session;
            return this.budget.tryConsume(
              session === undefined ? "" : String(session.header.id),
              session === undefined ? undefined : latestTurn(session),
              chars,
              this.deps.readConfig(),
            );
          },
          goalFor: (exec) => this.goal(exec as unknown as ExecLike),
          onSkip: (reason, details) => {
            this.deps.debug(JEV_EVENTS.shapingSkip, { reason, ...details });
          },
        }),
        { prepend: true },
      ),
    );
  }

  /** The configured archive path takes effect when the plugin is next mounted. */
  onConfigChanged(): void {
    if (this.disposed) return;
    this.budget.reset();
    const config = this.deps.readConfig();
    this.shaper.setEnabled(shapingEnabled(config));
    const previous = this.retention;
    this.retention = config.archive;
    if (
      previous.retentionDays !== this.retention.retentionDays ||
      previous.maxBytes !== this.retention.maxBytes
    ) {
      // A pass still holding the old, stricter policy must not keep deleting.
      this.collectionLifetime.abort();
      this.collectionLifetime = new AbortController();
      if (config.enabled && config.archive.enabled) void this.collectArchive();
    }
  }

  /** Join a background pass and rescan once for writes made during its snapshot. */
  collectArchive(): Promise<void> {
    const archive = this.archive;
    if (!(archive instanceof LocalResultArchive) || this.disposed)
      return Promise.resolve();
    this.collectionRequested = true;
    return (this.collection ??= Promise.resolve().then(async () => {
      try {
        while (this.collectionRequested && !this.disposed) {
          this.collectionRequested = false;
          try {
            const report = await collectArchive(
              archive,
              this.deps.readConfig(),
              this.collectionLifetime.signal,
            );
            if (report.deleted > 0 || report.errors > 0)
              this.deps.info(JEV_EVENTS.shapingArchiveGc, { ...report });
          } catch (error: unknown) {
            this.deps.warn(JEV_EVENTS.error, {
              stage: "archive-gc",
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } finally {
        this.collection = undefined;
      }
    }));
  }

  /** Flat counter snapshot for diagnostics and the `/jev-compact` report. */
  stats(): {
    readonly counters: Record<string, number>;
    readonly skipReasons: Record<string, number>;
  } {
    const snapshot = this.metrics.snapshot();
    const counters: Record<string, number> = {};
    const skipReasons: Record<string, number> = {};
    const prefix = `${SHAPE_METRICS.skipped}.`;
    for (const [name, value] of Object.entries(snapshot)) {
      if (name.startsWith(prefix))
        skipReasons[name.slice(prefix.length)] = value;
      else counters[name] = value;
    }
    return { counters, skipReasons };
  }

  dispose(): void {
    this.disposed = true;
    this.collectionLifetime.abort();
    this.shaper.setEnabled(false);
    for (const disposer of this.disposers.splice(0)) {
      try {
        disposer();
      } catch {
        // Teardown must never throw.
      }
    }
    this.budget.reset();
  }

  /** The current user goal for one execution's classifier state. */
  private goal(exec: ExecLike): string {
    const session = exec.agent?.session;
    if (session === undefined) return "(no session)";
    try {
      return goalFromSession(session, this.deps.readConfig());
    } catch {
      return "(no recent user text)";
    }
  }
}

export type { ShapeSkipReason };
