/** Host-side HTTP lifetime helpers. Status, authentication and retries belong to callers. */

export function createRequestDeadline(options: {
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}): { readonly signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const onAbort = (): void => controller.abort(options.signal?.reason);
  const timer = setTimeout(() => {
    controller.abort(
      new DOMException("The request deadline elapsed", "TimeoutError"),
    );
  }, options.timeoutMs);
  if (options.signal?.aborted === true) onAbort();
  else options.signal?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    },
  };
}

/** Bound even work whose implementation does not observe AbortSignal. */
export function withinDeadline<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    // Always attach handlers to work, including when cancellation already won.
    // A late failure from a DNS/credential implementation must stay observed.
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Discard an unread response without waiting for an uncooperative source. */
export function cancelResponseBody(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

export interface BoundedResponseBytes {
  readonly data: Uint8Array;
  /** Bytes observed, including the final chunk that exceeded the cap. */
  readonly bytes: number;
  readonly truncated: boolean;
}

/** Read at most maxBytes into memory; preserve the prefix on overflow. */
export async function readResponseBytes(
  response: Response,
  options: { readonly maxBytes: number; readonly signal: AbortSignal },
): Promise<BoundedResponseBytes> {
  const { maxBytes, signal } = options;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    cancelResponseBody(response);
    throw new RangeError("maxBytes must be a non-negative safe integer");
  }
  if (signal.aborted) {
    cancelResponseBody(response);
    throw signal.reason;
  }
  if (response.body === null) {
    return { data: new Uint8Array(), bytes: 0, truncated: false };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let kept = 0;
  let truncated = Number(response.headers.get("content-length")) > maxBytes;
  try {
    for (;;) {
      const next = await withinDeadline(reader.read(), signal);
      if (next.done) break;
      bytes += next.value.byteLength;
      const room = maxBytes - kept;
      const chunk = next.value.subarray(0, room);
      // Copy the retained prefix: a small view must not retain an oversized buffer.
      chunks.push(chunk.slice());
      kept += chunk.byteLength;
      if (bytes > maxBytes) {
        truncated = true;
        break;
      }
    }
  } finally {
    // Cancellation may itself never settle. Release the lock synchronously;
    // withinDeadline already observes any rejection of the outstanding read.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const data = new Uint8Array(kept);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { data, bytes, truncated };
}
