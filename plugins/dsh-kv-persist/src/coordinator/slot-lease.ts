/**
 * Slot mutex (SPEC §20, Invariant 8).
 *
 * No two operations may concurrently mutate the same physical slot:
 * restore, erase, inference, and save all run inside one exclusive lease.
 * For v0.1 a single promise-chain mutex per server is sufficient.
 */

/**
 * Serialize async work: every `runExclusive` body starts only after all
 * previously queued bodies finished (successfully or not). Bodies must not
 * re-enter `runExclusive` on the same mutex — that deadlocks by design, and
 * the invariant violation would be a plugin bug, not a runtime condition.
 */
export class SlotMutex {
  readonly #name: string;
  #tail: Promise<unknown> = Promise.resolve();
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

  runExclusive<T>(body: () => Promise<T>): Promise<T> {
    this.#depth += 1;
    const result = this.#tail.then(body, body);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    void this.#tail.then(() => {
      this.#depth = Math.max(0, this.#depth - 1);
    });
    return result;
  }
}
