/**
 * Non-blocking concurrency bounds (SPEC §24).
 *
 * Offload slots are acquired with `tryAcquire` and never queued: waiting
 * inside `tools/post-execute` would delay the parent's tool result, so an
 * exhausted budget simply routes the result through untouched.
 */

/** Fixed-capacity counter for the global worker budget. */
export class Semaphore {
  private available: number;
  private readonly total: number;

  constructor(max: number) {
    this.total = Math.max(0, max);
    this.available = this.total;
  }

  tryAcquire(): boolean {
    if (this.available <= 0) return false;
    this.available -= 1;
    return true;
  }

  release(): void {
    this.available += 1;
  }

  get inUse(): number {
    return this.total - this.available;
  }

  get capacity(): number {
    return this.total;
  }
}

/** Per-key budget (one key per parent agent session). */
export class KeyedLimiter {
  private readonly counts = new Map<string, number>();

  private readonly maxPerKey: number;

  constructor(maxPerKey: number) {
    this.maxPerKey = maxPerKey;
  }

  tryAcquire(key: string): boolean {
    const current = this.counts.get(key) ?? 0;
    if (current >= this.maxPerKey) return false;
    this.counts.set(key, current + 1);
    return true;
  }

  release(key: string): void {
    const current = this.counts.get(key) ?? 0;
    if (current <= 1) this.counts.delete(key);
    else this.counts.set(key, current - 1);
  }

  get trackedKeys(): number {
    return this.counts.size;
  }
}
