import type { ResolvedQaIntegrationsConfig } from "../../config.js";
import { IntegrationError } from "../../errors.js";
import {
  TLS_FAILURE,
  causeCode,
  fetchWithRetries,
  readBoundedText,
  type BoundedText,
} from "../shared/http.js";
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

export type TeamCityTextResponse = BoundedText;

export type TeamCityRequestRoot = "rest" | "server";

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
    const body = await readBoundedText(response, this.config.maxResponseBytes);
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
    return readBoundedText(
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
    return fetchWithRetries(
      this.fetcher,
      this.url(baseUrl, path, query, root),
      {
        timeoutMs,
        retries: this.flags.retries,
        headers: {
          authorization: `Bearer ${token}`,
          accept,
        },
        transportFailure: (error, timedOut) =>
          timedOut
            ? new IntegrationError("UpstreamTimeout", "TeamCity did not answer")
            : TLS_FAILURE.test(causeCode(error))
              ? new IntegrationError(
                  "TlsFailure",
                  "TeamCity TLS handshake failed",
                )
              : new IntegrationError(
                  "ProviderUnavailable",
                  "TeamCity request failed",
                ),
        // Every transport failure earns another attempt: a slow on-prem server
        // is more often busy than gone.
        retriable: () => true,
        statusFailure: (response) => this.failure(response),
      },
    );
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
}
