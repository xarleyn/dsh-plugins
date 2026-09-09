/**
 * Per-channel quarantine state machine (design SPEC §12, §13).
 *
 * Buffered mode holds `text-delta`/`reasoning-delta` chunks until a
 * classification snapshot approves them. The state machine is pure: it
 * decides when to buffer, when to snapshot, and when the quarantine overflow
 * fails closed; the stream guard performs the actual checks and flushing.
 *
 * One classifier in flight per channel: while `classifierRunning` is true the
 * channel keeps accumulating and the guard must not start another snapshot.
 */

export type QuarantineAppend = "buffer" | "check" | "overflow";

export interface QuarantineOptions {
  /** New quarantined chars between classifier snapshots. */
  readonly checkEveryChars: number;
  /** Snapshot window size in chars (lookbehind + pending is sent). */
  readonly windowChars: number;
  /** Released-text context included with each snapshot. */
  readonly lookbehindChars: number;
  /** Minimum wall-clock time between snapshots. */
  readonly minCheckIntervalMs: number;
  /** Overflow above this many pending chars fails closed. */
  readonly maxBufferedChars: number;
}

export class ChannelQuarantine {
  private readonly options: QuarantineOptions;
  private stashedBlockStart: unknown = null;
  private readonly pending: string[] = [];
  private pendingChars = 0;
  private charsSinceCheck = 0;
  private lastCheckAt = 0;
  private checksStarted = 0;
  classifierRunning = false;

  constructor(options: QuarantineOptions) {
    this.options = options;
  }

  /** Stash the `block-start` chunk so flushing never tears the structure. */
  stashBlockStart(chunk: unknown): void {
    this.stashedBlockStart = chunk;
  }

  hasStashedBlockStart(): boolean {
    return this.stashedBlockStart !== null;
  }

  /**
   * Append new quarantined text. Returns `check` when a snapshot is due
   * (threshold reached, interval elapsed, none in flight), `overflow` when
   * the buffer cap is exceeded (fail closed), `buffer` otherwise.
   */
  append(text: string, now: number): QuarantineAppend {
    this.pending.push(text);
    this.pendingChars += text.length;
    this.charsSinceCheck += text.length;
    if (this.pendingChars > this.options.maxBufferedChars) return "overflow";
    if (this.classifierRunning) return "buffer";
    if (this.charsSinceCheck < this.options.checkEveryChars) return "buffer";
    if (now - this.lastCheckAt < this.options.minCheckIntervalMs && this.checksStarted > 0) return "buffer";
    return "check";
  }

  /**
   * Content for the next snapshot: lookbehind context plus the currently
   * quarantined text, clamped to the window size so classifier requests stay
   * bounded (lookbehind first, newest text last).
   */
  snapshotText(releasedTail: string): string {
    const lookbehind = releasedTail.slice(-this.options.lookbehindChars);
    const pending = this.pending.join("");
    const windowBudget = this.options.windowChars;
    if (lookbehind.length + pending.length <= windowBudget) return lookbehind + pending;
    const pendingFrom = Math.max(0, pending.length - windowBudget);
    const pendingSlice = pending.slice(pendingFrom);
    const remaining = windowBudget - pendingSlice.length;
    const lookbehindSlice = remaining > 0 ? lookbehind.slice(-remaining) : "";
    return lookbehindSlice + pendingSlice;
  }

  /** Char count of the quarantined tail. */
  get size(): number {
    return this.pendingChars;
  }

  get hasPending(): boolean {
    return this.pendingChars > 0 || this.stashedBlockStart !== null;
  }

  /**
   * Flush the ordered quarantined chunk texts (block-start first). Returns
   * the text fragments in order; the caller wraps them back into delta
   * chunks with the original channel/index.
   */
  flush(): { blockStart: unknown; texts: string[] } {
    const texts = [...this.pending];
    const blockStart = this.stashedBlockStart;
    this.pending.length = 0;
    this.pendingChars = 0;
    this.charsSinceCheck = 0;
    this.stashedBlockStart = null;
    return { blockStart, texts };
  }

  /** Record that a snapshot started/finished at `now`. */
  markChecked(now: number): void {
    this.charsSinceCheck = 0;
    this.lastCheckAt = now;
    this.checksStarted += 1;
  }
}

/** Rolling released-text tail used as lookbehind context. */
export class ReleasedTail {
  private text = "";

  constructor(private readonly lookbehindChars: number) {}

  append(text: string): void {
    this.text = this.text.length + text.length > this.lookbehindChars * 4
      ? (this.text + text).slice(-this.lookbehindChars)
      : this.text + text;
  }

  tail(): string {
    return this.text.slice(-this.lookbehindChars);
  }
}

export interface PassThroughMonitorOptions {
  readonly checkEveryChars: number;
  readonly lookbehindChars: number;
  readonly minCheckIntervalMs: number;
}

/**
 * Check scheduler for observe/interrupt modes: content flows through
 * immediately, but rolling-window checks still run on the recent text so
 * violations are detected and audited.
 */
export class PassThroughMonitor {
  private readonly recent: string[] = [];
  private recentChars = 0;
  private charsSinceCheck = 0;
  private lastCheckAt = 0;
  private checksStarted = 0;

  constructor(private readonly options: PassThroughMonitorOptions) {}

  /** Buffer text and report when a window check is due. */
  append(text: string, now: number): "monitor" | "check" {
    this.recent.push(text);
    this.recentChars += text.length;
    this.charsSinceCheck += text.length;
    const cap = this.options.lookbehindChars + this.options.checkEveryChars * 4;
    while (this.recentChars > cap && this.recent.length > 1) {
      const dropped = this.recent[0] ?? "";
      this.recent.shift();
      this.recentChars -= dropped.length;
    }
    if (this.charsSinceCheck < this.options.checkEveryChars) return "monitor";
    if (this.checksStarted > 0 && now - this.lastCheckAt < this.options.minCheckIntervalMs) return "monitor";
    return "check";
  }

  markChecked(now: number): void {
    this.charsSinceCheck = 0;
    this.lastCheckAt = now;
    this.checksStarted += 1;
  }

  /** True when appended content has not been covered by a check yet. */
  hasUnchecked(): boolean {
    return this.charsSinceCheck > 0;
  }

  /** Recent text for the check: lookbehind context plus current tail. */
  windowText(): string {
    return this.recent.join("").slice(-(this.options.lookbehindChars + this.options.checkEveryChars * 2));
  }
}
