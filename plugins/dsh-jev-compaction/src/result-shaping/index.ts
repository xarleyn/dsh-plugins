/**
 * Wiring of the immediate result shaper into the plugin (result-shaping SPEC
 * §29, §32, §48).
 *
 * The subsystem owns everything the two layers must not share: its own
 * per-turn budget, its own metrics, and its own archive handle. Rebuilding the
 * archive on a configuration change keeps a live `archive.rootPath` edit from
 * silently writing to the old location for the rest of the process.
 */

import type { Context } from "@deepseek-ai/cordis";
import type { Session } from "@deepseek-ai/dsh-session";

import { collectArchive } from "../archive/gc.js";
import { LocalResultArchive, resolveArchiveRoot } from "../archive/local.js";
import type { OriginalResultArchive } from "../archive/types.js";
import type { ResolvedJevCompactionConfig } from "../config.js";
import { goalFromSession } from "../jev/state.js";
import type { SystemOneBackend } from "../jev/types.js";
import { JEV_EVENTS } from "../observability/logging.js";
import { TurnShapeBudget, latestTurn } from "./budget.js";
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
  private archive: OriginalResultArchive;
  private archiveRoot: string | undefined;
  private shaper: ImmediateResultShaper;

  constructor(deps: ResultShapingDeps) {
    this.deps = deps;
    const config = deps.readConfig();
    this.archiveRoot =
      deps.archive === undefined ? resolveArchiveRoot(config) : undefined;
    this.archive = deps.archive ?? new LocalResultArchive(this.archiveRoot!);
    this.shaper = new ImmediateResultShaper({
      readConfig: deps.readConfig,
      backend: deps.backend,
      archive: this.archive,
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

  /**
   * Adopt a configuration change: rebuild the archive when its root moved and
   * drop the per-turn budget, whose ceilings may have changed.
   */
  onConfigChanged(): void {
    const config = this.deps.readConfig();
    this.budget.reset();
    if (this.deps.archive !== undefined) return;
    const root = resolveArchiveRoot(config);
    if (root === this.archiveRoot) return;
    this.archiveRoot = root;
    this.archive = new LocalResultArchive(root);
    this.shaper = new ImmediateResultShaper({
      readConfig: this.deps.readConfig,
      backend: this.deps.backend,
      archive: this.archive,
      metrics: this.metrics,
      onSkip: (reason, details) => {
        this.deps.debug(JEV_EVENTS.shapingSkip, { reason, ...details });
      },
      onShaped: (details) => {
        this.deps.info(JEV_EVENTS.shapingApplied, details);
      },
    });
    this.deps.info(JEV_EVENTS.shapingArchiveRoot, { root });
  }

  /** Retention pass; never on the shaping path, never fatal. */
  async collectArchive(): Promise<void> {
    const config = this.deps.readConfig();
    if (!(this.archive instanceof LocalResultArchive)) return;
    try {
      const report = await collectArchive(this.archive, config);
      if (report.deleted > 0 || report.errors > 0) {
        this.deps.info(JEV_EVENTS.shapingArchiveGc, { ...report });
      }
    } catch (error: unknown) {
      this.deps.warn(JEV_EVENTS.error, {
        stage: "archive-gc",
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
