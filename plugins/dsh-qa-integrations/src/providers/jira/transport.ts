import type { ResolvedQaIntegrationsConfig } from "../../config.js";
import { statusErrorOf, transportFailureOf } from "../kernel/errors.js";
import {
  fetchWithRetries,
  readBoundedJson,
  RESEND_AFTER_EVERY_FAULT,
  type ResponseRead,
} from "../kernel/read-policy.js";
import {
  decodeCredentialFields,
  requireConfiguredEndpoint,
} from "../kernel/token.js";
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

export function credentialFromPlaintext(plaintext: string): JiraCredential {
  // An empty e-mail is a Server / Data Center connection, which authenticates
  // on the token alone; whether one is *required* is decided by the site's
  // declared deployment type, at the moment the secret would be spent.
  const { siteId, email, token } = decodeCredentialFields(plaintext, {
    siteId: "nonempty",
    email: "text",
    token: "nonempty",
  });
  return { siteId, email, token };
}

/**
 * The configured site a credential belongs to: a credential minted for a site
 * the operator has since removed fails closed.
 */
export function credentialSite(
  flags: JiraFlags,
  credential: JiraCredential,
): JiraSite {
  return requireConfiguredEndpoint(
    jiraSite(flags, credential.siteId),
    "Jira site is no longer configured",
  );
}

export type JiraQuery = Readonly<
  Record<string, string | number | boolean | undefined>
>;

/**
 * The provider error model of Jira, folded by the shared policy. Jira answers a
 * refused permission with 403 — a permission scheme the connected user is not
 * in, an issue security level, or a project they cannot browse — and an unknown
 * or invisible resource with 404; both stay distinct so the model can tell "you
 * may not" from "it is not there". Jira historically also rate-limits with 403
 * and a rate-limit body — that case keeps its permission meaning and is left to
 * the user rather than retried, so only 429 and 5xx earn another attempt.
 */
const statusFailure = statusErrorOf({
  label: "Jira",
  rejectedCredential: "Jira rejected the stored API token",
  invalidRequestStatuses: [400, 405, 406, 422],
});

const transportFailure = transportFailureOf({ label: "Jira" });

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
    return this.request(site, credential, path, query, (response, signal) =>
      readBoundedJson<T>(
        response,
        this.config.maxResponseBytes,
        "Provider",
        signal,
      ),
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

  private async request<T>(
    site: JiraSite,
    credential: JiraCredential,
    path: string,
    query: JiraQuery,
    read: ResponseRead<T>,
  ): Promise<T> {
    const dialect = dialectOf(site);
    return fetchWithRetries(
      this.fetcher,
      this.url(site, path, query),
      {
        timeoutMs: this.config.timeoutMs,
        retries: this.flags.retries,
        headers: {
          authorization: authorizationFor(dialect, credential),
          accept: "application/json",
        },
        transportFailure,
        // The deviation from the shared default, named rather than implied:
        // Jira re-sends a call this deployment gave up on, so one read can cost
        // `retries × timeoutMs` rather than the `timeoutMs` the default promises.
        // A Jira read is a GET that answers the same question either way, which
        // is what makes paying the wait again acceptable here.
        retriable: RESEND_AFTER_EVERY_FAULT,
        statusFailure,
      },
      read,
    );
  }
}
