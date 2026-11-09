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
 *
 * Release follows coverage: a snapshot records the pending head it examined and
 * a flush hands back no more than the head a *passed* check covered, so text
 * larger than one window drains window by window instead of escaping the gate.
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
  /** Pending head a passed check covered, and therefore may be released. */
  private verifiedChars = 0;
  /** Pending head the snapshot currently being checked covers. */
  private snapshotChars = 0;
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
    if (
      now - this.lastCheckAt < this.options.minCheckIntervalMs &&
      this.checksStarted > 0
    )
      return "buffer";
    return "check";
  }

  /**
   * Content for the next snapshot: the oldest quarantined text plus the
   * released-text context in front of it, clamped to the window size so
   * classifier requests stay bounded.
   *
   * Reserve the released lookbehind before taking the pending head. Otherwise
   * a full pending window consumes all context and a phrase spanning two
   * windows is never checked together. At least one new character must fit,
   * even when the configured lookbehind is as large as the window.
   *
   * The covered head is remembered so {@link markChecked} can promote it to
   * releasable text once the check passes.
   */
  snapshotText(releasedTail: string): string {
    const pending = this.pending.join("");
    const windowBudget = this.options.windowChars;
    const overlap = Math.min(
      releasedTail.length,
      this.options.lookbehindChars,
      Math.max(0, windowBudget - 1),
    );
    const lookbehind = overlap > 0 ? releasedTail.slice(-overlap) : "";
    const pendingSlice = pending.slice(0, windowBudget - overlap);
    this.snapshotChars = pendingSlice.length;
    return lookbehind + pendingSlice;
  }

  /** Char count of the quarantined tail. */
  get size(): number {
    return this.pendingChars;
  }

  get hasPending(): boolean {
    return this.pendingChars > 0 || this.stashedBlockStart !== null;
  }

  /**
   * Flush the ordered quarantined chunk texts (block-start first), but no
   * further than the head a passed check covered. Returns the text fragments in
   * order; the caller wraps them back into delta chunks with the original
   * channel/index. Anything past the verified head stays quarantined for the
   * next window, and so does the stashed `block-start` — a header must not run
   * ahead of the text it opens.
   */
  flush(): { blockStart: unknown; texts: string[] } {
    const texts: string[] = [];
    let releaseChars = Math.min(this.verifiedChars, this.pendingChars);
    while (releaseChars > 0 && this.pending.length > 0) {
      const head = this.pending[0] ?? "";
      const released = head.slice(0, releaseChars);
      texts.push(released);
      if (released.length === head.length) this.pending.shift();
      else this.pending[0] = head.slice(released.length);
      this.pendingChars -= released.length;
      releaseChars -= released.length;
    }
    const releaseHeader =
      this.stashedBlockStart !== null &&
      (this.pendingChars === 0 || texts.length > 0);
    const blockStart = releaseHeader ? this.stashedBlockStart : null;
    if (releaseHeader) this.stashedBlockStart = null;
    this.charsSinceCheck = 0;
    this.verifiedChars = 0;
    this.snapshotChars = 0;
    return { blockStart, texts };
  }

  /**
   * Record that a snapshot started/finished at `now`. Called on the way out of
   * every check, and only a passing one is followed by a flush, so the range
   * the snapshot covered is what the caller may release.
   */
  markChecked(now: number): void {
    this.charsSinceCheck = 0;
    this.lastCheckAt = now;
    this.checksStarted += 1;
    this.verifiedChars = Math.max(this.verifiedChars, this.snapshotChars);
  }
}

/** Rolling released-text tail used as lookbehind context. */
export class ReleasedTail {
  private text = "";

  constructor(private readonly lookbehindChars: number) {}

  append(text: string): void {
    if (this.lookbehindChars <= 0) return;
    this.text =
      this.text.length + text.length > this.lookbehindChars * 4
        ? (this.text + text).slice(-this.lookbehindChars)
        : this.text + text;
  }

  tail(): string {
    return this.lookbehindChars <= 0
      ? ""
      : this.text.slice(-this.lookbehindChars);
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
    if (
      this.checksStarted > 0 &&
      now - this.lastCheckAt < this.options.minCheckIntervalMs
    )
      return "monitor";
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
    return this.recent
      .join("")
      .slice(
        -(this.options.lookbehindChars + this.options.checkEveryChars * 2),
      );
  }
}
