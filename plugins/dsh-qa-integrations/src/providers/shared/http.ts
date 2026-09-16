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
 * Read a body without letting upstream decide how much memory the broker
 * spends. A body over the cap is reported as truncated instead of surfacing a
 * raw `content-length` nobody can verify.
 */
export async function readBoundedText(
  response: Response,
  maxBytes: number,
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
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.byteLength;
    if (bytes > maxBytes) {
      // Keep the prefix that still fits: a bounded preview is what makes a
      // truncated answer useful, an empty one is not.
      const room = maxBytes - (bytes - next.value.byteLength);
      if (room > 0) chunks.push(next.value.subarray(0, room));
      await reader.cancel();
      truncated = true;
      break;
    }
    chunks.push(next.value);
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
 * How a provider folds transport outcomes into its own safe domain errors:
 * each transport keeps the wording, the shared loop keeps the mechanics.
 */
export interface FetchRetryPolicy {
  readonly timeoutMs: number;
  readonly retries: number;
  readonly headers: Record<string, string>;
  /** Fold a thrown fetch (abort, DNS, refused connection) into a safe error. */
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
 * The shared transport loop: one bounded GET per attempt, transient answers
 * retried with backoff, upstream failures folded into safe domain errors. The
 * deadline is per attempt, and a fetch that answered is never retried by this
 * loop unless its status says the upstream fault may be gone on a later try.
 */
export async function fetchWithRetries(
  fetcher: typeof fetch,
  target: string,
  policy: FetchRetryPolicy,
): Promise<Response> {
  let lastError: IntegrationError | undefined;
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    let timedOut = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, policy.timeoutMs);
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
      lastError = policy.transportFailure(error, timedOut);
      if (attempt >= policy.retries || !policy.retriable(lastError)) {
        throw lastError;
      }
      await sleep(retryDelay(attempt));
      continue;
    } finally {
      clearTimeout(timer);
    }
    if (response.ok) return response;
    lastError = policy.statusFailure(response);
    // Only throttling and upstream faults are retried; an authorization or
    // not-found answer will not change by asking again.
    const transient = response.status === 429 || response.status >= 500;
    if (!transient || attempt >= policy.retries) throw lastError;
    await sleep(backoff(response, attempt));
  }
}
