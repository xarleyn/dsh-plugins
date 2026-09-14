import { watch, type FSWatcher } from "node:fs";

/**
 * Follows personal skill directories so a file edited by hand — outside the
 * editor — still reaches the DSH catalog without a restart.
 *
 * Registration is lazy and bounded: a root is watched the first time the
 * discovery provider meets it, at most {@link QA_SKILL_WATCH_LIMIT} roots stay
 * open (least recently used first), and every watcher is closed on dispose. A
 * root that cannot be watched degrades to "no live refresh for that account":
 * a save through the editor invalidates the registry directly and never
 * depends on this path.
 */

export const QA_SKILL_WATCH_LIMIT = 16;
const DEFAULT_DEBOUNCE_MS = 250;

export interface QaSkillWatcherOptions {
  readonly onChange: () => void;
  readonly onError: (message: string) => void;
  readonly limit?: number;
  readonly debounceMs?: number;
}

export class QaSkillWatcher {
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly limit: number;
  private readonly debounceMs: number;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly options: QaSkillWatcherOptions) {
    this.limit = options.limit ?? QA_SKILL_WATCH_LIMIT;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  /** How many roots are currently watched (tests and diagnostics). */
  get size(): number {
    return this.watchers.size;
  }

  /** Start following one skills root; idempotent per path. */
  follow(root: string): void {
    if (this.watchers.has(root)) return;
    while (this.watchers.size >= this.limit) {
      const oldest = this.watchers.keys().next().value;
      if (oldest === undefined) break;
      this.close(oldest);
    }
    const onChange = (): void => this.schedule();
    try {
      let watcher: FSWatcher;
      try {
        watcher = watch(root, { recursive: true }, onChange);
      } catch {
        // Recursive watching is unavailable on some filesystems; a direct
        // child of the root is still worth following.
        watcher = watch(root, onChange);
      }
      watcher.on("error", (error) => {
        this.close(root);
        this.options.onError(
          error instanceof Error ? error.message : String(error),
        );
      });
      this.watchers.set(root, watcher);
    } catch (error) {
      this.options.onError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /** Stop following one root. */
  close(root: string): void {
    const watcher = this.watchers.get(root);
    if (watcher === undefined) return;
    this.watchers.delete(root);
    try {
      watcher.close();
    } catch {
      // Already closed by the platform.
    }
  }

  dispose(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    for (const root of [...this.watchers.keys()]) this.close(root);
  }

  /**
   * Coalesce a burst of filesystem events into one catalog refresh. The timer
   * never holds the process open: a watcher must not keep the Host alive.
   */
  private schedule(): void {
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.options.onChange();
    }, this.debounceMs);
    this.timer.unref?.();
  }
}
