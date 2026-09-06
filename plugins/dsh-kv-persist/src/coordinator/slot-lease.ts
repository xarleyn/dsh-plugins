/**
 * Slot mutex (SPEC §20, Invariant 8).
 *
 * No two operations may concurrently mutate the same physical slot:
 * restore, erase, inference, and save all run inside one exclusive lease.
 * For v0.1 a single promise-chain mutex per server is sufficient.
 */

/**
 * Serialize async work: every lease starts only after all previously queued
 * leases finished. A lease spans preparation, the complete inference stream,
 * and terminal bookkeeping. Callers must not re-enter the same mutex while
 * holding a lease: that deadlocks by design and is an invariant violation.
 */
export class SlotMutex {
  readonly #name: string;
  #tail: Promise<void> = Promise.resolve();
  #depth = 0;

  constructor(name: string) {
    this.#name = name;
  }

  /** Diagnostic: whether any lease is queued or running. */
  get held(): boolean {
    return this.#depth > 0;
  }

  get name(): string {
    return this.#name;
  }

  /** Acquire an exclusive, idempotently releasable slot lease. */
  async acquire(): Promise<() => void> {
    this.#depth += 1;
    const previous = this.#tail;
    let unlock: () => void = () => undefined;
    this.#tail = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await previous;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#depth = Math.max(0, this.#depth - 1);
      unlock();
    };
  }

  async runExclusive<T>(body: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await body();
    } finally {
      release();
    }
  }
}
