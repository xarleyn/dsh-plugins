import type { ResolvedQaIntegrationsConfig } from "../../config.js";
import { IntegrationError } from "../../errors.js";
import type { TeamCityFlags } from "./config.js";
import { canonicalServerUrl, serverUrlProblem } from "./network.js";

/**
 * Encrypted payload of one TeamCity connection: the personal access token the
 * user pasted, and nothing else.
 *
 * The server it is dialled at is operator configuration, so a connection cannot
 * be pointed anywhere by its owner and cannot outlive a deployment that
 * repointed or removed the address. A credential stored before that move still
 * carries the address the connect form used to collect; it is accepted and
 * ignored, because the token is what the user owns and the deployment decides
 * where it may be spent.
 */
export interface TeamCityCredential {
  readonly token: string;
}

export function credentialFromPlaintext(plaintext: string): TeamCityCredential {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new IntegrationError(
      "CredentialRevoked",
      "Stored credential is invalid",
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new IntegrationError(
      "CredentialRevoked",
      "Stored credential is invalid",
    );
  }
  const token = (parsed as Record<string, unknown>)["token"];
  if (typeof token !== "string" || token === "") {
    throw new IntegrationError(
      "CredentialRevoked",
      "Stored credential is invalid",
    );
  }
  return { token };
}

/**
 * The address this deployment dials, re-checked against the policy configured
 * *now*: removing a host from the allowlist, or switching the deployment to
 * HTTPS-only, therefore closes existing connections instead of only new ones.
 * A deployment that never configured an address refuses with a reason of its
 * own, so the card and the tools say "TeamCity is not configured here" rather
 * than blaming the caller's token.
 */
export function configuredServer(flags: TeamCityFlags): string {
  if (flags.serverUrl === "") {
    throw new IntegrationError(
      "ProviderUnavailable",
      "This deployment has no TeamCity address configured",
    );
  }
  const problem = serverUrlProblem(flags.serverUrl, flags.network);
  if (problem !== undefined) {
    throw new IntegrationError("ProviderUnavailable", problem);
  }
  return canonicalServerUrl(flags.serverUrl);
}

export interface TeamCityTextResponse {
  /** Body prefix; empty for a payload that looks binary. */
  readonly text: string;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly binary: boolean;
}

export type TeamCityRequestRoot = "rest" | "server";

const RETRY_CAP_MS = 2_000;
const BACKOFF_BASE_MS = 250;

/** Upstream codes that mean "the TLS handshake did not succeed". */
const TLS_FAILURE =
  /CERT|TLS|SSL|UNABLE_TO_VERIFY|SELF_SIGNED|DEPTH_ZERO|ERR_TLS/u;

/** Content types that must never be handed to the model as text. */
const BINARY_TYPE =
  /^(?:image|audio|video)\/|application\/(?:octet-stream|zip|gzip|pdf|x-tar|x-7z-compressed|wasm)/u;

function numberFrom(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function looksBinary(contentType: string | null, bytes: Uint8Array): boolean {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The first upstream error code in a fetch failure chain, if any. */
function causeCode(error: unknown): string {
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
 * HTTP boundary of the provider: one documented TeamCity call, bounded in time
 * and size, with upstream failures folded into safe domain errors and bounded
 * retries for the transient ones.
 */
export class TeamCityTransport {
  constructor(
    private readonly config: ResolvedQaIntegrationsConfig,
    private readonly flags: TeamCityFlags,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async getJson<T>(
    baseUrl: string,
    token: string,
    path: string,
    query: Readonly<Record<string, string | undefined>>,
    root: TeamCityRequestRoot = "rest",
  ): Promise<T> {
    const response = await this.request(
      baseUrl,
      token,
      path,
      query,
      root,
      this.config.timeoutMs,
      "application/json",
    );
    const body = await this.readText(response, this.config.maxResponseBytes);
    if (body.truncated) {
      throw new IntegrationError(
        "ResultTooLarge",
        "TeamCity response is too large",
      );
    }
    try {
      return JSON.parse(body.text) as T;
    } catch {
      throw new IntegrationError(
        "ProviderUnavailable",
        "TeamCity returned invalid JSON",
      );
    }
  }

  /** Plain-text read: the build log, and an artifact read as text. */
  async getText(
    baseUrl: string,
    token: string,
    path: string,
    query: Readonly<Record<string, string | undefined>>,
    root: TeamCityRequestRoot,
    maxBytes: number,
    timeoutMs = this.flags.streamTimeoutMs,
  ): Promise<TeamCityTextResponse> {
    const response = await this.request(
      baseUrl,
      token,
      path,
      query,
      root,
      timeoutMs,
      "text/plain",
    );
    return this.readText(
      response,
      Math.min(maxBytes, this.config.maxResponseBytes),
    );
  }

  private url(
    baseUrl: string,
    path: string,
    query: Readonly<Record<string, string | undefined>>,
    root: TeamCityRequestRoot,
  ): string {
    const prefix = root === "server" ? "" : "/app/rest";
    const url = new URL(`${baseUrl}${prefix}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private async request(
    baseUrl: string,
    token: string,
    path: string,
    query: Readonly<Record<string, string | undefined>>,
    root: TeamCityRequestRoot,
    timeoutMs: number,
    accept: string,
  ): Promise<Response> {
    const target = this.url(baseUrl, path, query, root);
    let lastError: IntegrationError | undefined;
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      let timedOut = false;
      const controller = new AbortController();
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        response = await this.fetcher(target, {
          method: "GET",
          // A TeamCity that answers with a redirect is never followed: the token
          // must not travel to another origin, and a redirect to a login page is
          // an authentication answer rather than a new address to try.
          redirect: "error",
          headers: {
            authorization: `Bearer ${token}`,
            accept,
          },
          signal: controller.signal,
        });
      } catch (error) {
        lastError = timedOut
          ? new IntegrationError("UpstreamTimeout", "TeamCity did not answer")
          : TLS_FAILURE.test(causeCode(error))
            ? new IntegrationError(
                "TlsFailure",
                "TeamCity TLS handshake failed",
              )
            : new IntegrationError(
                "ProviderUnavailable",
                "TeamCity request failed",
              );
        if (attempt >= this.flags.retries) throw lastError;
        await sleep(this.retryDelay(attempt));
        continue;
      } finally {
        clearTimeout(timer);
      }
      if (response.ok) return response;
      lastError = this.failure(response);
      // Only throttling and upstream faults are retried; an authorization or
      // not-found answer will not change by asking again.
      const transient = response.status === 429 || response.status >= 500;
      if (!transient || attempt >= this.flags.retries) throw lastError;
      await sleep(this.backoff(response, attempt));
    }
  }

  /** TeamCity asks for a pause through `retry-after`; honour it, but bounded. */
  private backoff(response: Response, attempt: number): number {
    const header = response.headers.get("retry-after");
    const seconds = header === null ? Number.NaN : Number(header.trim());
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1_000, RETRY_CAP_MS);
    }
    return this.retryDelay(attempt);
  }

  private retryDelay(attempt: number): number {
    const backoff = BACKOFF_BASE_MS * 2 ** attempt;
    return Math.min(backoff + Math.floor(Math.random() * 100), RETRY_CAP_MS);
  }

  /**
   * The provider error model. TeamCity answers a refused permission with 403 and
   * an unknown or hidden resource with 404; both stay distinct so the model can
   * tell "you may not" from "it is not there", and neither ever carries an
   * upstream body, which can be an HTML page naming internal hosts.
   */
  private failure(response: Response): IntegrationError {
    const status = response.status;
    if (status === 401) {
      return new IntegrationError(
        "CredentialRevoked",
        "TeamCity rejected the stored token",
      );
    }
    if (status === 403) {
      return new IntegrationError(
        "ProviderPermissionDenied",
        "TeamCity denied this operation",
      );
    }
    if (status === 404) {
      return new IntegrationError(
        "ResourceNotFound",
        "TeamCity resource not found",
      );
    }
    if (status === 429) {
      return new IntegrationError("RateLimited", "TeamCity rate limit reached");
    }
    if (status === 400 || status === 405 || status === 406 || status === 422) {
      return new IntegrationError(
        "InvalidRequest",
        "TeamCity rejected the request",
      );
    }
    return new IntegrationError(
      "ProviderUnavailable",
      "TeamCity request failed",
    );
  }

  /**
   * Read a body without letting upstream decide how much memory the broker
   * spends. A body over the cap is reported as truncated instead of surfacing a
   * raw `content-length` nobody can verify.
   */
  private async readText(
    response: Response,
    maxBytes: number,
  ): Promise<TeamCityTextResponse> {
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
}
