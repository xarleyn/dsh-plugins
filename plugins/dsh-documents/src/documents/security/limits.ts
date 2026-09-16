/**
 * Resource limits and concurrency control (§26.4, §27).
 *
 * Every expensive stage (render, extraction, OCR) runs behind a semaphore so a
 * burst of documents cannot exhaust the host, and every size/count budget is
 * checked before the work starts rather than after a backend has already spent
 * minutes on it.
 */

import { DocumentError } from "../errors.js";

export function assertBytesWithinBudget(
  bytes: number,
  maxBytes: number,
  label: string,
): void {
  if (bytes > maxBytes) {
    throw new DocumentError(
      "INPUT_TOO_LARGE",
      `${label} is ${bytes} bytes; the configured limit is ${maxBytes}`,
      { details: { bytes, maxBytes } },
    );
  }
}

export function assertCharsWithinBudget(
  chars: number,
  maxChars: number,
  label: string,
): void {
  if (chars > maxChars) {
    throw new DocumentError(
      "DOCUMENT_TOO_LARGE",
      `${label} is ${chars} characters; the configured limit is ${maxChars}`,
      { details: { chars, maxChars } },
    );
  }
}

export function assertCountWithinBudget(
  count: number,
  maxCount: number,
  label: string,
): void {
  if (count > maxCount) {
    throw new DocumentError(
      "DOCUMENT_TOO_LARGE",
      `${label} is ${count}; the configured limit is ${maxCount}`,
      { details: { count, maxCount } },
    );
  }
}

export interface Semaphore {
  /** Resolve with the release function once a slot is free. */
  acquire(signal?: AbortSignal): Promise<() => void>;
  readonly limit: number;
  /** Slots in use right now (tests and health output). */
  readonly inUse: number;
}

/**
 * Counting semaphore with FIFO fairness. An aborted waiter leaves the queue
 * without consuming a slot, so a stopped turn never leaks capacity.
 */
export function createSemaphore(limit: number): Semaphore {
  const max = Math.max(1, Math.floor(limit));
  let inUse = 0;
  const waiters: {
    resolve: (release: () => void) => void;
    reject: (error: unknown) => void;
    signal?: AbortSignal;
  }[] = [];

  const releaseOnce = (): (() => void) => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      inUse -= 1;
      const next = waiters.shift();
      if (next !== undefined) {
        inUse += 1;
        next.signal?.removeEventListener("abort", next.reject as () => void);
        next.resolve(releaseOnce());
      }
    };
  };

  return {
    limit: max,
    get inUse() {
      return inUse;
    },
    async acquire(signal?: AbortSignal) {
      if (signal?.aborted === true) {
        throw new DocumentError("INVALID_INPUT", "the operation was cancelled");
      }
      if (inUse < max) {
        inUse += 1;
        return releaseOnce();
      }
      return await new Promise<() => void>((resolve, reject) => {
        const waiter = {
          resolve,
          reject,
          ...(signal === undefined ? {} : { signal }),
        };
        waiters.push(waiter);
        signal?.addEventListener(
          "abort",
          () => {
            const index = waiters.indexOf(waiter);
            if (index >= 0) waiters.splice(index, 1);
            reject(
              new DocumentError("INVALID_INPUT", "the operation was cancelled"),
            );
          },
          { once: true },
        );
      });
    },
  };
}
