import type { ResolvedQaIntegrationsConfig } from "../../config.js";
import { IntegrationError } from "../../errors.js";
import {
  TLS_FAILURE,
  causeCode,
  fetchWithRetries,
  numberFrom,
  readBoundedJson,
  readBoundedText,
  type BoundedText,
} from "../shared/http.js";
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

export type GitlabTextResponse = BoundedText;

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
    const data = await readBoundedJson<T>(
      response,
      this.config.maxResponseBytes,
      "Provider",
    );
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
    return readBoundedText(
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
    return fetchWithRetries(this.fetcher, this.url(instance, path, query), {
      timeoutMs: this.config.timeoutMs,
      retries: this.flags.retries,
      headers: {
        "private-token": token,
        accept: "application/json",
      },
      // Aborts, DNS failures and refused connections: a transient network
      // fault is worth one more attempt, a permanent one keeps failing. The
      // deadline is this deployment's own, so a request it already gave up on
      // is not sent again.
      transportFailure: (error, timedOut) =>
        timedOut
          ? new IntegrationError("UpstreamTimeout", "GitLab did not answer")
          : TLS_FAILURE.test(causeCode(error))
            ? new IntegrationError("TlsFailure", "GitLab TLS handshake failed")
            : new IntegrationError(
                "ProviderUnavailable",
                "Provider request failed",
              ),
      retriable: (error) => error.code !== "UpstreamTimeout",
      statusFailure: (response) => this.failure(response),
    });
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
}
