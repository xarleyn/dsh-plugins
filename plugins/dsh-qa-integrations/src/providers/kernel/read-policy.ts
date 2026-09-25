import { IntegrationError } from "../../errors.js";

export const RETRY_CAP_MS = 2_000;
export const BACKOFF_BASE_MS = 250;

/** Upstream codes that mean "the TLS handshake did not succeed". */
export const TLS_FAILURE =
  /CERT|TLS|SSL|UNABLE_TO_VERIFY|SELF_SIGNED|DEPTH_ZERO|ERR_TLS/u;

/** Content types that must never be handed to the model as text. */
export const BINARY_TYPE =
  /^(?:image|audio|video)\/|application\/(?:octet-stream|zip|gzip|pdf|x-tar|x-7z-compressed|wasm)/u;

/** A body read up to a cap; the text is empty for a payload that looks binary. */
export interface BoundedText {
  /** Body prefix; empty for a payload that looks binary. */
  readonly text: string;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly binary: boolean;
}

export function numberFrom(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function looksBinary(
  contentType: string | null,
  bytes: Uint8Array,
): boolean {
  if (contentType !== null && BINARY_TYPE.test(contentType)) return true;
  if (contentType !== null && /charset=/u.test(contentType)) return false;
  if (
    contentType !== null &&
    /^(?:text\/|application\/(?:json|xml))/u.test(contentType)
  ) {
    return false;
  }
  // No usable content type: a NUL byte in the head is the classic text/binary
  // split, and it costs nothing to be conservative about the rest.
  for (const byte of bytes.subarray(0, 8_192)) {
    if (byte === 0) return true;
  }
  return false;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The first upstream error code in a fetch failure chain, if any. */
export function causeCode(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) break;
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return "";
}

export function backoff(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  const seconds = header === null ? Number.NaN : Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, RETRY_CAP_MS);
  }
  return retryDelay(attempt);
}

export function retryDelay(attempt: number): number {
  const backoff = BACKOFF_BASE_MS * 2 ** attempt;
  return Math.min(backoff + Math.floor(Math.random() * 100), RETRY_CAP_MS);
}

/**
 * A requested ceiling folded into the deployment's own, never past it: a
 * request naming no ceiling gets the default, one naming more than the cap
 * gets the cap rather than an error — an operator asking for more only wants
 * the maximum.
 */
export function withinCap(
  requested: number | undefined,
  fallback: number,
  cap: number,
): number {
  return Math.min(requested ?? fallback, cap);
}

/**
 * Settle `read` no later than `signal`. A body stream that stops delivering
 * chunks has no other way out: the fetch already succeeded, so nothing inside
 * the read itself observes the request deadline.
 */
function withinDeadline<T>(read: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    const settle = (finish: () => void): void => {
      signal.removeEventListener("abort", onAbort);
      finish();
    };
    read.then(
      (value) => {
        settle(() => resolve(value));
      },
      (error: unknown) => {
        settle(() => reject(error));
      },
    );
  });
}

/**
 * Read a body without letting upstream decide how much memory the broker
 * spends, or for how long it spends the request's time. A body over the cap is
 * reported as truncated instead of surfacing a raw `content-length` nobody can
 * verify, and a body that stops arriving is refused by `signal` — the same
 * deadline the headers had to meet.
 */
export async function readBoundedText(
  response: Response,
  maxBytes: number,
  label: string,
  signal: AbortSignal,
): Promise<BoundedText> {
  const contentType = response.headers.get("content-type");
  if (response.body === null) {
    return { text: "", bytes: 0, truncated: false, binary: false };
  }
  const declared = numberFrom(response.headers.get("content-length"));
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = declared !== undefined && declared > maxBytes;
  try {
    for (;;) {
      const next = await withinDeadline(reader.read(), signal);
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) {
        // Keep the prefix that still fits: a bounded preview is what makes a
        // truncated answer useful, an empty one is not.
        const room = maxBytes - (bytes - next.value.byteLength);
        if (room > 0) chunks.push(next.value.subarray(0, room));
        truncated = true;
        break;
      }
      chunks.push(next.value);
    }
  } catch (error) {
    // This deployment's own deadline ending the read is a timeout, whatever the
    // upstream's answer looked like before it stopped.
    if (signal.aborted) {
      throw new IntegrationError(
        "UpstreamTimeout",
        `${label} did not finish sending its body`,
      );
    }
    throw error;
  } finally {
    // Whatever ended the read — the cap, the deadline, a transfer that broke —
    // the stream is released, so no body keeps a connection open past the
    // request it belongs to. Not awaited: a source that never delivers a chunk
    // can never finish cancelling itself either.
    void reader.cancel().catch(() => undefined);
  }
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  const binary = looksBinary(contentType, body);
  return {
    text: binary ? "" : body.toString("utf8"),
    bytes: Math.max(bytes, body.byteLength),
    truncated,
    binary,
  };
}

/**
 * Read one JSON body under the deployment cap and inside the request deadline,
 * folding what a capped, stalled or unreadable body means into a domain error.
 * The cap, the prefix-keeping truncation, the deadline and the binary
 * classification are the shared policy; a transport only supplies the label it
 * answers with, so the same limit cannot mean "narrow the request" in one
 * provider and "try again later" in another, and no transport can quietly skip
 * either of them.
 */
export async function readBoundedJson<T>(
  response: Response,
  maxBytes: number,
  label: string,
  signal: AbortSignal,
): Promise<T> {
  const body = await readBoundedText(response, maxBytes, label, signal);
  if (body.truncated) {
    throw new IntegrationError(
      "ResultTooLarge",
      `${label} response is too large`,
    );
  }
  try {
    return JSON.parse(body.text) as T;
  } catch {
    throw new IntegrationError(
      "ProviderUnavailable",
      `${label} returned invalid JSON`,
    );
  }
}

/**
 * How a provider folds transport outcomes into its own safe domain errors:
 * each transport keeps the wording, the shared loop keeps the mechanics.
 */
export interface FetchRetryPolicy {
  readonly timeoutMs: number;
  readonly retries: number;
  readonly headers: Record<string, string>;
  /** Fold a thrown fetch or a broken body read into a safe error. */
  readonly transportFailure: (
    error: unknown,
    timedOut: boolean,
  ) => IntegrationError;
  /** Whether a folded transport failure earns another attempt. */
  readonly retriable: (error: IntegrationError) => boolean;
  /** Fold a non-2xx answer into the provider's safe domain error. */
  readonly statusFailure: (response: Response) => IntegrationError;
}

/**
 * What the transport does with an answer that arrived: read the body it came
 * for, under `signal` — the deadline of the attempt that produced the response.
 * The read is the transport's because only it knows which of its shapes the
 * body carries; the deadline is the loop's because the loop set it.
 */
export type ResponseRead<T> = (
  response: Response,
  signal: AbortSignal,
) => Promise<T>;

/**
 * The shared transport loop: one bounded GET per attempt, transient answers
 * retried with backoff, upstream failures folded into safe domain errors. The
 * deadline is per attempt and covers the whole exchange — the loop hands the
 * answer to `read` while its own timer is still armed, so an upstream that
 * replies with the headers and then stops sending chunks is refused by the
 * budget instead of leaving the call pending. A fetch that answered is never
 * retried by this loop unless its status says the upstream fault may be gone on
 * a later try, and what `read` refuses on its own (a body over the cap, a body
 * that is not JSON) stays the domain error it named.
 */
export async function fetchWithRetries<T>(
  fetcher: typeof fetch,
  target: string,
  policy: FetchRetryPolicy,
  read: ResponseRead<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    let timedOut = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, policy.timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetcher(target, {
          method: "GET",
          // An upstream that answers with a redirect is never followed: the
          // credential must not travel to another origin.
          redirect: "error",
          headers: policy.headers,
          signal: controller.signal,
        });
      } catch (error) {
        const failure = policy.transportFailure(error, timedOut);
        if (attempt >= policy.retries || !policy.retriable(failure)) {
          throw failure;
        }
        await sleep(retryDelay(attempt));
        continue;
      }
      if (!response.ok) {
        const failure = policy.statusFailure(response);
        // Only throttling and upstream faults are retried; an authorization or
        // not-found answer will not change by asking again.
        const transient = response.status === 429 || response.status >= 500;
        if (!transient || attempt >= policy.retries) throw failure;
        await sleep(backoff(response, attempt));
        continue;
      }
      try {
        return await read(response, controller.signal);
      } catch (error) {
        if (error instanceof IntegrationError) throw error;
        throw policy.transportFailure(error, timedOut);
      }
    } finally {
      // Cleared here rather than the moment the headers arrived: the budget is
      // what `read` is held to as well.
      clearTimeout(timer);
    }
  }
}
