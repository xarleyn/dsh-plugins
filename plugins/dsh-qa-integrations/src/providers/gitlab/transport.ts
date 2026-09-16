import type { ResolvedQaIntegrationsConfig } from "../../config.js";
import { IntegrationError } from "../../errors.js";
import {
  gitlabInstance,
  type GitlabFlags,
  type GitlabInstance,
} from "./config.js";

/**
 * Encrypted credential payload of one GitLab connection: which configured
 * instance the token belongs to, and the token itself. The base URL is not
 * stored — it is re-resolved from operator config on every call, so removing or
 * repointing an instance takes effect at once instead of at the next connect.
 */
export interface GitlabCredential {
  readonly instanceId: string;
  readonly token: string;
}

export function credentialFromPlaintext(plaintext: string): GitlabCredential {
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
  const record = parsed as Record<string, unknown>;
  if (
    typeof record["instanceId"] !== "string" ||
    typeof record["token"] !== "string" ||
    record["token"] === ""
  ) {
    throw new IntegrationError(
      "CredentialRevoked",
      "Stored credential is invalid",
    );
  }
  return { instanceId: record["instanceId"], token: record["token"] };
}

/**
 * The configured instance a credential belongs to. A credential minted for an
 * instance the operator has since removed fails closed: it never falls back to
 * another instance, however permissive that one is.
 */
export function credentialInstance(
  flags: GitlabFlags,
  credential: GitlabCredential,
): GitlabInstance {
  const instance = gitlabInstance(flags, credential.instanceId);
  if (instance === undefined) {
    throw new IntegrationError(
      "CredentialRevoked",
      "GitLab instance is no longer configured",
    );
  }
  return instance;
}

export interface GitlabQuery {
  readonly [key: string]: string | number | boolean | undefined;
}

export interface GitlabPage {
  readonly page: number;
  readonly perPage: number;
  readonly nextPage?: number;
  readonly total?: number;
}

export interface GitlabJsonResponse<T> {
  readonly data: T;
  readonly page?: GitlabPage;
}

export interface GitlabTextResponse {
  /** Body prefix; empty for a payload that looks binary. */
  readonly text: string;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly binary: boolean;
}

const RETRY_CAP_MS = 2_000;
const BACKOFF_BASE_MS = 250;

/** Content types that must never be handed to the model as text. */
const BINARY_TYPE =
  /^(?:image|audio|video)\/|application\/(?:octet-stream|zip|gzip|pdf|x-tar|x-7z-compressed|wasm)/u;

function numberFrom(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function pageFrom(headers: Headers): GitlabPage | undefined {
  const page = numberFrom(headers.get("x-page"));
  const perPage = numberFrom(headers.get("x-per-page"));
  if (page === undefined || perPage === undefined) return undefined;
  const nextPage = numberFrom(headers.get("x-next-page"));
  const total = numberFrom(headers.get("x-total"));
  return {
    page,
    perPage,
    ...(nextPage === undefined ? {} : { nextPage }),
    ...(total === undefined ? {} : { total }),
  };
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

/**
 * HTTP boundary of the provider: one documented GitLab REST call, bounded in
 * time and size, with upstream failures folded into safe domain errors and
 * bounded retries for the transient ones.
 */
export class GitlabTransport {
  constructor(
    private readonly config: ResolvedQaIntegrationsConfig,
    private readonly flags: GitlabFlags,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async getJson<T>(
    instance: GitlabInstance,
    token: string,
    path: string,
    query: GitlabQuery = {},
  ): Promise<GitlabJsonResponse<T>> {
    const response = await this.request(instance, token, path, query);
    const body = await this.readText(response, this.config.maxResponseBytes);
    if (body.truncated) {
      throw new IntegrationError(
        "ResultTooLarge",
        "Provider response is too large",
      );
    }
    let data: T;
    try {
      data = JSON.parse(body.text) as T;
    } catch {
      throw new IntegrationError(
        "ProviderUnavailable",
        "Provider returned invalid JSON",
      );
    }
    const page = pageFrom(response.headers);
    return page === undefined ? { data } : { data, page };
  }

  /** Plain-text read: the CI job trace, and anything we never parse as JSON. */
  async getText(
    instance: GitlabInstance,
    token: string,
    path: string,
    query: GitlabQuery = {},
    maxBytes = this.config.maxResponseBytes,
  ): Promise<GitlabTextResponse> {
    const response = await this.request(instance, token, path, query);
    return this.readText(
      response,
      Math.min(maxBytes, this.config.maxResponseBytes),
    );
  }

  private url(
    instance: GitlabInstance,
    path: string,
    query: GitlabQuery,
  ): string {
    const url = new URL(`${instance.baseUrl}/api/v4${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private async request(
    instance: GitlabInstance,
    token: string,
    path: string,
    query: GitlabQuery,
  ): Promise<Response> {
    const target = this.url(instance, path, query);
    let lastError: IntegrationError | undefined;
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        response = await this.fetcher(target, {
          method: "GET",
          // A GitLab that answers with a redirect is never followed: the token
          // must not travel to another origin.
          redirect: "error",
          headers: {
            "private-token": token,
            accept: "application/json",
          },
          signal: controller.signal,
        });
      } catch {
        // Aborts, DNS failures and refused connections: a transient network
        // fault is worth one more attempt, a permanent one keeps failing.
        lastError = new IntegrationError(
          "ProviderUnavailable",
          "Provider request failed",
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

  /** GitLab asks for a pause through `retry-after`; honour it, but bounded. */
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

  private failure(response: Response): IntegrationError {
    const status = response.status;
    if (status === 401) {
      return new IntegrationError(
        "CredentialRevoked",
        "GitLab rejected the stored token",
      );
    }
    if (status === 403) {
      return new IntegrationError(
        "ProviderPermissionDenied",
        "GitLab denied this operation",
      );
    }
    if (status === 404) {
      return new IntegrationError(
        "ResourceNotFound",
        "GitLab resource not found",
      );
    }
    if (status === 429) {
      return new IntegrationError("RateLimited", "GitLab rate limit reached");
    }
    if (status === 400 || status === 422) {
      return new IntegrationError(
        "InvalidRequest",
        "GitLab rejected the request",
      );
    }
    return new IntegrationError("ProviderUnavailable", "GitLab request failed");
  }

  /**
   * Read a body without letting upstream decide how much memory the broker
   * spends. A body over the cap is reported as truncated instead of surfacing a
   * raw `content-length` nobody can verify.
   */
  private async readText(
    response: Response,
    maxBytes: number,
  ): Promise<GitlabTextResponse> {
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
