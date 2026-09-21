import type { ResolvedQaIntegrationsConfig } from "../../config.js";
import { IntegrationError } from "../../errors.js";
import { backoff, readBoundedJson, retryDelay, sleep } from "../shared/http.js";
import {
  confluenceInstance,
  type ConfluenceFlags,
  type ConfluenceInstance,
} from "./config.js";

/**
 * Encrypted credential payload of one Confluence connection: which configured
 * site it belongs to, the Atlassian account e-mail and the API token. The base
 * URL is not stored — it is re-resolved from operator config on every call, so
 * removing or repointing a site takes effect at once instead of at the next
 * connect.
 *
 * The e-mail is not a secret, but it is part of the authentication pair, and it
 * comes from the connect form through the operator-facing RPC. Keeping both
 * halves in one encrypted record means a token can never be paired with another
 * account's address, not even by a bug in the broker.
 */
export interface ConfluenceCredential {
  readonly instanceId: string;
  readonly email: string;
  readonly token: string;
}

export function credentialFromPlaintext(
  plaintext: string,
): ConfluenceCredential {
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
    typeof record["email"] !== "string" ||
    record["email"] === "" ||
    typeof record["token"] !== "string" ||
    record["token"] === ""
  ) {
    throw new IntegrationError(
      "CredentialRevoked",
      "Stored credential is invalid",
    );
  }
  return {
    instanceId: record["instanceId"],
    email: record["email"],
    token: record["token"],
  };
}

/**
 * The configured site a credential belongs to. A credential minted for a site
 * the operator has since removed fails closed: it never falls back to another
 * site, however permissive that one is.
 */
export function credentialInstance(
  flags: ConfluenceFlags,
  credential: ConfluenceCredential,
): ConfluenceInstance {
  const instance = confluenceInstance(flags, credential.instanceId);
  if (instance === undefined) {
    throw new IntegrationError(
      "CredentialRevoked",
      "Confluence site is no longer configured",
    );
  }
  return instance;
}

export interface ConfluenceQuery {
  readonly [key: string]: string | number | boolean | undefined;
}

/** What a listing answers about its own pagination, in provider terms. */
export interface ConfluencePage {
  /**
   * Opaque token from the upstream `_links.next`, when the API is cursor-based.
   * It is never a URL: the whole point is that the next request is rebuilt from
   * our own path and parameters, so a caller cannot steer it.
   */
  readonly nextCursor?: string | undefined;
}

export interface ConfluenceJsonResponse<T> {
  readonly data: T;
  readonly page?: ConfluencePage;
}

/**
 * The cursor a v2 listing points at. Confluence puts the next page in
 * `_links.next` as a URL; only the `cursor` parameter is kept, because every
 * other part of that URL is ours to build from operator configuration.
 */
function cursorFrom(links: unknown): string | undefined {
  if (typeof links !== "object" || links === null) return undefined;
  const next = (links as Record<string, unknown>)["next"];
  if (typeof next !== "string" || next === "") return undefined;
  const query = next.includes("?") ? next.slice(next.indexOf("?") + 1) : next;
  for (const pair of query.split("&")) {
    const [key, value] = pair.split("=");
    if (key !== "cursor" || value === undefined || value === "") continue;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}

/**
 * HTTP boundary of the provider: one documented Confluence REST read, bounded
 * in time and size, with upstream failures folded into safe domain errors and
 * bounded retries for the transient ones.
 */
export class ConfluenceTransport {
  constructor(
    private readonly config: ResolvedQaIntegrationsConfig,
    private readonly flags: ConfluenceFlags,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async getJson<T>(
    instance: ConfluenceInstance,
    credential: ConfluenceCredential,
    path: string,
    query: ConfluenceQuery = {},
  ): Promise<ConfluenceJsonResponse<T>> {
    const response = await this.request(instance, credential, path, query);
    const data = await readBoundedJson<T>(
      response,
      this.config.maxResponseBytes,
      "Confluence",
    );
    const nextCursor =
      typeof data === "object" && data !== null
        ? cursorFrom((data as Record<string, unknown>)["_links"])
        : undefined;
    return nextCursor === undefined ? { data } : { data, page: { nextCursor } };
  }

  private url(
    instance: ConfluenceInstance,
    path: string,
    query: ConfluenceQuery,
  ): string {
    const url = new URL(`${instance.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  /**
   * The one place the secret is spent. Basic authentication carries the account
   * e-mail and the API token; nothing else in the request names the user.
   */
  private authorization(credential: ConfluenceCredential): string {
    const pair = Buffer.from(
      `${credential.email}:${credential.token}`,
      "utf8",
    ).toString("base64");
    return `Basic ${pair}`;
  }

  private async request(
    instance: ConfluenceInstance,
    credential: ConfluenceCredential,
    path: string,
    query: ConfluenceQuery,
  ): Promise<Response> {
    const target = this.url(instance, path, query);
    const authorization = this.authorization(credential);
    let lastError: IntegrationError | undefined;
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        response = await this.fetcher(target, {
          method: "GET",
          // A Confluence that answers with a redirect is never followed: the
          // credential must not travel to another origin.
          redirect: "error",
          headers: {
            authorization,
            accept: "application/json",
          },
          signal: controller.signal,
        });
      } catch {
        // Aborts, DNS failures and refused connections: a transient network
        // fault is worth one more attempt, a permanent one keeps failing.
        lastError = new IntegrationError(
          "ProviderUnavailable",
          "Confluence request failed",
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
      // not-found answer will not change by asking again.
      const transient = response.status === 429 || response.status >= 500;
      if (!transient || attempt >= this.flags.retries) throw lastError;
      await sleep(backoff(response, attempt));
    }
  }

  /**
   * Confluence answers a page the account may not see with the same 404 as a
   * page that does not exist, and the provider keeps that ambiguity: the model
   * must not learn from an error whether someone else's page is there.
   */
  private failure(response: Response): IntegrationError {
    const status = response.status;
    if (status === 401) {
      return new IntegrationError(
        "CredentialRevoked",
        "Confluence rejected the stored e-mail or API token",
      );
    }
    if (status === 403) {
      return new IntegrationError(
        "ProviderPermissionDenied",
        "Confluence denied this operation",
      );
    }
    if (status === 404) {
      return new IntegrationError(
        "ResourceNotFound",
        "Confluence resource not found",
      );
    }
    if (status === 429) {
      return new IntegrationError(
        "RateLimited",
        "Confluence rate limit reached",
      );
    }
    if (status === 400 || status === 422) {
      return new IntegrationError(
        "InvalidRequest",
        "Confluence rejected the request",
      );
    }
    if (status === 410) {
      // A retired endpoint is a provider bug, not a user mistake: the message
      // says so instead of blaming the caller's arguments.
      return new IntegrationError(
        "ProviderUnavailable",
        "Confluence no longer serves this endpoint",
      );
    }
    return new IntegrationError(
      "ProviderUnavailable",
      "Confluence request failed",
    );
  }
}
