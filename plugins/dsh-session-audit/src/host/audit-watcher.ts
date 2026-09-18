/**
 * Filesystem watching, and the reason there is more than one mechanism.
 *
 * The SPEC §22 asks for three layers working together, and each covers a case
 * the others cannot:
 *
 * - **the startup scan** covers everything that existed before the plugin
 *   loaded, which no watcher can report retroactively;
 * - **the watcher** covers the common case with low latency;
 * - **reconciliation** covers everything the watcher cannot see. Native events
 *   do not arrive reliably across a Docker bind mount, a network share, a
 *   Syncthing folder, or a `scp -r` into a directory the kernel is not
 *   reporting on — and a silently missed event would otherwise mean an audit
 *   that never appears until DSH restarts.
 *
 * Because reconciliation is authoritative, a watcher failure is never fatal:
 * it degrades latency and says so in the log.
 *
 * Events are also not trusted as descriptions of *what* changed. A settle
 * window collapses a burst into one re-check, and the re-check decides
 * everything from the directory listing.
 */
import { watch as chokidarWatch, type FSWatcher } from "chokidar";
import { canonicalizeWatchPath } from "@deepseek-ai/dsh-home-paths";
import type { AuditWatchMode } from "../config.js";

/** Everything the watcher needs from its owner. */
export interface AuditWatcherOptions {
  /** The directory to watch. */
  readonly root: string;
  /** Whether to watch at all; reconciliation runs regardless. */
  readonly watch: boolean;
  readonly watchMode: AuditWatchMode;
  /**
   * Quiet period after an event before re-reading the root.
   *
   * This is what makes a directory copied in file by file safe: the copy
   * settles, and only then does anything read it (SPEC §24).
   */
  readonly settleMs: number;
  /** Reconciliation interval; `0` disables the timer. */
  readonly rescanIntervalMs: number;
  /** Re-check the root. Called for every settled event and every tick. */
  readonly onRecheck: () => void;
  /** The watcher could not be established; reconciliation is now the only layer. */
  readonly onFallback: (reason: string) => void;
}

/** How often the coalescing debounce re-arms at most. */
const COALESCE_MS = 50;

export class AuditWatcher {
  private watcher: FSWatcher | undefined;
  private settleTimer: NodeJS.Timeout | undefined;
  private coalesceTimer: NodeJS.Timeout | undefined;
  private reconcileTimer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(private readonly options: AuditWatcherOptions) {}

  /** Establish the watcher and the reconciliation timer. */
  async start(): Promise<void> {
    if (this.options.rescanIntervalMs > 0) {
      this.reconcileTimer = setInterval(
        () => this.options.onRecheck(),
        this.options.rescanIntervalMs,
      );
      this.reconcileTimer.unref?.();
    }
    if (!this.options.watch) return;

    try {
      const root = await canonicalizeWatchPath(this.options.root);
      const watcher = chokidarWatch(root, {
        persistent: true,
        // The initial scan is the service's job; a watcher that also reported
        // the existing tree would just duplicate it.
        ignoreInitial: true,
        // Root, one directory level, and the two files inside each directory.
        depth: 2,
        // An audit found through a link is an audit outside the root.
        followSymlinks: false,
        // A partial `scp` arrives as a burst; wait for it to finish.
        awaitWriteFinish: {
          stabilityThreshold: this.options.settleMs,
          pollInterval: Math.max(1, Math.min(this.options.settleMs, 10)),
        },
        // A bind mount / network share / sync folder reports nothing natively.
        usePolling: this.options.watchMode === "poll",
        ignorePermissionErrors: true,
      });
      watcher.on("all", () => this.scheduleRecheck());
      watcher.on("error", (error) => {
        if (this.stopped) return;
        this.options.onFallback(
          error instanceof Error ? error.message : String(error),
        );
      });
      this.watcher = watcher;
    } catch (error) {
      this.options.onFallback(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /** Tear everything down. Safe to call twice. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.settleTimer !== undefined) clearTimeout(this.settleTimer);
    if (this.coalesceTimer !== undefined) clearTimeout(this.coalesceTimer);
    if (this.reconcileTimer !== undefined) clearInterval(this.reconcileTimer);
    this.settleTimer = undefined;
    this.coalesceTimer = undefined;
    this.reconcileTimer = undefined;
    const watcher = this.watcher;
    this.watcher = undefined;
    if (watcher !== undefined) await watcher.close();
  }

  /**
   * Coalesce a burst, then wait out the settle window.
   *
   * The two stages are not redundant: the short coalescing window turns the
   * dozens of events a directory copy produces into one scheduled check, and
   * the settle window then guarantees the copy has finished before the check
   * happens.
   */
  private scheduleRecheck(): void {
    if (this.stopped) return;
    if (this.coalesceTimer !== undefined) clearTimeout(this.coalesceTimer);
    this.coalesceTimer = setTimeout(() => {
      this.coalesceTimer = undefined;
      if (this.settleTimer !== undefined) clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => {
        this.settleTimer = undefined;
        if (!this.stopped) this.options.onRecheck();
      }, this.options.settleMs);
      this.settleTimer.unref?.();
    }, COALESCE_MS);
    this.coalesceTimer.unref?.();
  }
}
