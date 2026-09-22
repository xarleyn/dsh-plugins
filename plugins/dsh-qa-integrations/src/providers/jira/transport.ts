import type { ResolvedQaIntegrationsConfig } from "../../config.js";
import { IntegrationError } from "../../errors.js";
import {
  backoff,
  causeCode,
  readBoundedJson,
  retryDelay,
  sleep,
  TLS_FAILURE,
} from "../shared/http.js";
import { jiraSite, type JiraFlags, type JiraSite } from "./config.js";
import { authorizationFor, dialectOf } from "./dialect.js";

export { basicAuthorization } from "./dialect.js";

/**
 * Encrypted payload of one Jira connection: which configured site the token
 * belongs to, the Atlassian account it authenticates as, and the API token
 * itself.
 *
 * The site's address is not stored — it is re-resolved from operator config on
 * every call, so removing or repointing a site takes effect at once instead of
 * at the next connect. The e-mail is not a secret, but it is what makes a Cloud
 * token usable (Jira Cloud authenticates an API token with HTTP Basic over
 * `email:token`), so it travels in the same encrypted blob rather than in a
 * second record that could go missing. A Server / Data Center connection
 * authenticates on the token alone and keeps the field empty: the site's
 * declared deployment type decides whether it is spent, which is why a
 * credential is never paired with the other product's scheme.
 */
export interface JiraCredential {
  readonly siteId: string;
  readonly email: string;
  readonly token: string;
}

function invalidCredential(): never {
  throw new IntegrationError(
    "CredentialRevoked",
    "Stored credential is invalid",
  );
}

export function credentialFromPlaintext(plaintext: string): JiraCredential {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    invalidCredential();
  }
  if (typeof parsed !== "object" || parsed === null) invalidCredential();
  const record = parsed as Record<string, unknown>;
  const siteId = record["siteId"];
  const email = record["email"];
  const token = record["token"];
  // An empty e-mail is a Server / Data Center connection, which authenticates
  // on the token alone; whether one is *required* is decided by the site's
  // declared deployment type, at the moment the secret would be spent.
  if (
    typeof siteId !== "string" ||
    typeof email !== "string" ||
    typeof token !== "string" ||
    siteId === "" ||
    token === ""
  ) {
    invalidCredential();
  }
  return { siteId, email, token };
}

/**
 * The configured site a credential belongs to. A credential minted for a site
 * the operator has since removed fails closed: it never falls back to another
 * site, however permissive that one is.
 */
export function credentialSite(
  flags: JiraFlags,
  credential: JiraCredential,
): JiraSite {
  const site = jiraSite(flags, credential.siteId);
  if (site === undefined) {
    throw new IntegrationError(
      "CredentialRevoked",
      "Jira site is no longer configured",
    );
  }
  return site;
}

export type JiraQuery = Readonly<
  Record<string, string | number | boolean | undefined>
>;

/**
 * HTTP boundary of the provider: one documented Jira Cloud REST call, bounded in
 * time and size, with upstream failures folded into safe domain errors and
 * bounded retries for the transient ones.
 *
 * Requests are GET-only and never follow a redirect: the token must not travel
 * to another origin, and an Atlassian login page is an authentication answer
 * rather than a new address to try.
 */
export class JiraTransport {
  constructor(
    private readonly config: ResolvedQaIntegrationsConfig,
    private readonly flags: JiraFlags,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async getJson<T>(
    site: JiraSite,
    credential: JiraCredential,
    path: string,
    query: JiraQuery = {},
  ): Promise<T> {
    const response = await this.request(site, credential, path, query);
    return readBoundedJson<T>(
      response,
      this.config.maxResponseBytes,
      "Provider",
    );
  }

  private url(site: JiraSite, path: string, query: JiraQuery): string {
    const url = new URL(`${site.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private async request(
    site: JiraSite,
    credential: JiraCredential,
    path: string,
    query: JiraQuery,
  ): Promise<Response> {
    const target = this.url(site, path, query);
    const dialect = dialectOf(site);
    const authorization = authorizationFor(dialect, credential);
    let lastError: IntegrationError | undefined;
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      let timedOut = false;
      const controller = new AbortController();
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.config.timeoutMs);
      try {
        response = await this.fetcher(target, {
          method: "GET",
          redirect: "error",
          headers: {
            authorization,
            accept: "application/json",
          },
          signal: controller.signal,
        });
      } catch (error) {
        lastError = timedOut
          ? new IntegrationError("UpstreamTimeout", "Jira did not answer")
          : TLS_FAILURE.test(causeCode(error))
            ? new IntegrationError("TlsFailure", "Jira TLS handshake failed")
            : new IntegrationError(
                "ProviderUnavailable",
                "Jira request failed",
              );
        if (attempt >= this.flags.retries) throw lastError;
        await sleep(retryDelay(attempt));
        continue;
      } finally {
        clearTimeout(timer);
      }
      if (response.ok) return response;
      lastError = this.failure(response);
      // Only throttling and upstream faults are retried; an authorization or
      // not-found answer will not change by asking again. Jira rate-limits with
      // 429 and, historically, 403 with a rate-limit body — the 403 case keeps
      // its permission meaning and is left to the user.
      const transient = response.status === 429 || response.status >= 500;
      if (!transient || attempt >= this.flags.retries) throw lastError;
      await sleep(backoff(response, attempt));
    }
  }

  /**
   * The provider error model. Jira answers a refused permission with 403 — a
   * permission scheme the connected user is not in, an issue security level, or
   * a project they cannot browse — and an unknown or invisible resource with
   * 404; both stay distinct so the model can tell "you may not" from "it is not
   * there". Neither answer ever carries the upstream body.
   */
  private failure(response: Response): IntegrationError {
    const status = response.status;
    if (status === 401) {
      return new IntegrationError(
        "CredentialRevoked",
        "Jira rejected the stored API token",
      );
    }
    if (status === 403) {
      return new IntegrationError(
        "ProviderPermissionDenied",
        "Jira denied this operation",
      );
    }
    if (status === 404) {
      return new IntegrationError(
        "ResourceNotFound",
        "Jira resource not found",
      );
    }
    if (status === 429) {
      return new IntegrationError("RateLimited", "Jira rate limit reached");
    }
    if (status === 400 || status === 405 || status === 406 || status === 422) {
      return new IntegrationError(
        "InvalidRequest",
        "Jira rejected the request",
      );
    }
    return new IntegrationError("ProviderUnavailable", "Jira request failed");
  }
}
