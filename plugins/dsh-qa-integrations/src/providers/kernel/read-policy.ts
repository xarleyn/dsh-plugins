import {
  IntegrationError,
  type TransportBudget,
  type TransportDiagnostics,
} from "../../errors.js";

export const RETRY_CAP_MS = 2_000;
export const BACKOFF_BASE_MS = 250;

/** Upstream codes that mean "the TLS handshake did not succeed". */
export const TLS_FAILURE =
  /CERT|TLS|SSL|UNABLE_TO_VERIFY|SELF_SIGNED|DEPTH_ZERO|ERR_TLS/u;

/** Content types that must never be handed to the model as text. */
export const BINARY_TYPE =
  /^(?:image|audio|video)\/|application\/(?:octet-stream|zip|gzip|pdf|x-tar|x-7z-compressed|wasm)/u;

/** A sign-in page is HTML; a gateway that renders one is not a JSON API. */
const HTML_TYPE = /^text\/html|^application\/xhtml/u;

/** The head of a document, whether or not the answer declared what it is. */
const HTML_HEAD = /^\s*<(?:!doctype\s+html|html(?:\s|>))/iu;

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

/**
 * Whether an unreadable JSON body is a sign-in page. Either half answers it: the
 * media type the gateway declared, or the document's own opening. An upstream
 * that moved its login behind the API path answers 200 with HTML, and that is a
 * refused credential, not a malformed one.
 */
export function looksLikeSignInPage(
  contentType: string | null,
  text: string,
): boolean {
  if (contentType !== null && HTML_TYPE.test(contentType)) return true;
  return HTML_HEAD.test(text);
}

/**
 * Whether an answer is a redirect rather than data.
 *
 * Every transport of this package refuses to follow one — the credential must
 * not travel to another origin — so a 3xx is always an answer this deployment
 * read itself, never an address it was told to try.
 */
export function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

/**
 * What a redirect means here: an upstream that no longer accepts the stored
 * credential sends its caller to the sign-in page instead of answering. Folding
 * it into `ProviderUnavailable` is what made an expired key read as an outage —
 * one phrase for a dead token and a host that is down, no action in either.
 */
export function credentialRedirectFailure(label: string): IntegrationError {
  return new IntegrationError(
    "CredentialRevoked",
    `${label} redirected to a sign-in page instead of answering; reconnect the integration`,
  );
}

/**
 * The same refusal for the upstream that answers with a login page and calls it
 * 200: the credential is spent either way, and the operator's action is one.
 */
export function credentialPageFailure(label: string): IntegrationError {
  return new IntegrationError(
    "CredentialRevoked",
    `${label} answered with a sign-in page instead of data; reconnect the integration`,
  );
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

/**
 * The class of a transport failure, as a log may name it: the upstream code
 * where there is one (`ECONNREFUSED`, `UND_ERR_SOCKET`), the error's own name
 * otherwise. A short token, and nothing a header value or a message could
 * smuggle into a log line.
 */
export function errorClassOf(error: unknown): string {
  const code = causeCode(error);
  const candidate =
    code !== "" ? code : error instanceof Error ? error.name : typeof error;
  return logToken(candidate) ?? "unclassified";
}

/**
 * A value safe to print: a short token of the characters a media type or an
 * error code is written with, or nothing at all. A control character never
 * reaches a log line, whatever an upstream put in a header.
 */
function logToken(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const token = value.trim().slice(0, 64);
  return token !== "" && /^[A-Za-z0-9_.:;/+=, -]+$/u.test(token)
    ? token
    : undefined;
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
 * either of them. An unreadable body that is a sign-in page is the refused
 * credential the status fold would have named, had the upstream answered with a
 * status for it.
 */
export async function readBoundedJson<T>(
  response: Response,
  maxBytes: number,
  label: string,
  signal: AbortSignal,
): Promise<T> {
  const facts = answerDiagnostics(response);
  const body = await readBoundedText(response, maxBytes, label, signal);
  if (body.truncated) {
    throw withTransportDiagnostics(
      new IntegrationError("ResultTooLarge", `${label} response is too large`),
      facts,
    );
  }
  try {
    return JSON.parse(body.text) as T;
  } catch {
    throw withTransportDiagnostics(
      looksLikeSignInPage(response.headers.get("content-type"), body.text)
        ? credentialPageFailure(label)
        : new IntegrationError(
            "ProviderUnavailable",
            `${label} returned invalid JSON`,
          ),
      facts,
    );
  }
}

/**
 * Whether a folded transport failure earns another attempt. Re-spending a
 * deadline is a latency decision, not a detail of the API behind it, so the
 * kernel holds the two rules a deployment chooses between and a provider names
 * its choice — an upstream that answers in five different ways here cannot say
 * what one `timeoutMs` promised the operator.
 */
export type TransportRetriable = (error: IntegrationError) => boolean;

/**
 * The default, and the rule a provider gets when it names no other: one
 * deadline is the whole budget. A call this deployment already gave up on is
 * not re-sent, so one read costs `timeoutMs` rather than `retries × timeoutMs`.
 */
export const DEADLINE_IS_THE_BUDGET: TransportRetriable = (error) =>
  error.code !== "UpstreamTimeout";

/**
 * The rule for an upstream more often busy than gone: every fault that left no
 * answer earns another attempt, and the worst case of one read is `retries ×
 * timeoutMs` — a longer wait, paid for by the answers it still gets. A body this
 * deployment stopped reading is not among them: that request answered, and what
 * the read made of it is a verdict, not a fault that may be gone on a later try.
 */
export const RESEND_AFTER_EVERY_FAULT: TransportRetriable = () => true;

/**
 * Write the budget a call was refused under onto the error that carries it out.
 * The party that reports the failure knows the provider and the operation and
 * nothing about the attempts; the loop that spent them knows nothing else. This
 * is the one place the two meet, and it is why a log line can say both what was
 * asked for and what it cost.
 */
export function withTransportBudget(
  error: IntegrationError,
  budget: TransportBudget,
): IntegrationError {
  error.budget = budget;
  return error;
}

/**
 * Write what the upstream answer looked like onto the failure that carries it
 * out, beside the budget that answer cost. The broker reports the refusal and
 * knows the provider and the operation; only the loop ever held the response,
 * and only the loop ever saw a fetch that raised. Facts about the shape of the
 * answer — a status, a media type, a transport error class — and nothing of its
 * content.
 */
export function withTransportDiagnostics(
  error: IntegrationError,
  facts: TransportDiagnostics,
): IntegrationError {
  error.diagnostics = { ...error.diagnostics, ...facts };
  return error;
}

/**
 * What an answer that arrived left for a log to say about it. Exported for the
 * transports with a loop of their own, so a refusal reads alike whichever of
 * them produced it.
 */
export function answerDiagnostics(response: Response): TransportDiagnostics {
  const contentType = logToken(
    response.headers.get("content-type") ?? undefined,
  );
  return contentType === undefined
    ? { status: response.status }
    : { status: response.status, contentType };
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
  /**
   * Whether a folded transport failure earns another attempt; {@link
   * DEADLINE_IS_THE_BUDGET} unless the provider names its choice.
   */
  readonly retriable?: TransportRetriable;
  /**
   * Fold a non-2xx answer into the provider's safe domain error. A redirect
   * reaches it too: the loop refuses to follow one, so the answer the provider
   * sees is the one the upstream gave the credential.
   */
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
 * that is not JSON) stays the domain error it named. Whatever the loop hands
 * back from a transport give-up carries the budget it spent and the shape of the
 * answer it met — a status, a media type, the class of the failure — because the
 * party reporting that failure to the operator knows the call and none of the
 * arithmetic or the exchange behind it.
 */
export async function fetchWithRetries<T>(
  fetcher: typeof fetch,
  target: string,
  policy: FetchRetryPolicy,
  read: ResponseRead<T>,
): Promise<T> {
  const retriable = policy.retriable ?? DEADLINE_IS_THE_BUDGET;
  for (let attempt = 0; ; attempt += 1) {
    // What this attempt has spent so far, in the shape a report reads: the
    // deadline re-paid by every retry, and the attempts the call actually cost.
    const spent = (): TransportBudget => ({
      timeoutMs: policy.timeoutMs,
      retries: policy.retries,
      attempts: attempt + 1,
    });
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
          // credential must not travel to another origin. `manual` rather than
          // `error` because the answer itself is the finding — a refused key
          // redirects to a sign-in page, and the provider's status fold is what
          // says so. Under `error` the fetch only raises an opaque failure.
          redirect: "manual",
          headers: policy.headers,
          signal: controller.signal,
        });
      } catch (error) {
        const failure = withTransportDiagnostics(
          policy.transportFailure(error, timedOut),
          {
            errorClass: errorClassOf(error),
          },
        );
        if (attempt >= policy.retries || !retriable(failure)) {
          throw withTransportBudget(failure, spent());
        }
        await sleep(retryDelay(attempt));
        continue;
      }
      if (!response.ok) {
        const failure = withTransportDiagnostics(
          policy.statusFailure(response),
          answerDiagnostics(response),
        );
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
        // A read this deployment's own deadline ended leaves as the refusal the
        // reader named — and carries the budget that named it, whatever that
        // refusal was: the attempts and the deadline are true of the call either
        // way, and only the reader knows which of them ended it.
        if (error instanceof IntegrationError) {
          throw withTransportBudget(
            withTransportDiagnostics(error, answerDiagnostics(response)),
            spent(),
          );
        }
        throw withTransportBudget(
          withTransportDiagnostics(
            policy.transportFailure(error, timedOut),
            answerDiagnostics(response),
          ),
          spent(),
        );
      }
    } finally {
      // Cleared here rather than the moment the headers arrived: the budget is
      // what `read` is held to as well.
      clearTimeout(timer);
    }
  }
}
