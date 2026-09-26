import type { ResolvedQaIntegrationsConfig } from "../../config.js";
import { IntegrationError } from "../../errors.js";
import { statusErrorOf, transportFailureOf } from "../kernel/errors.js";
import {
  fetchWithRetries,
  readBoundedJson,
  type ResponseRead,
} from "../kernel/read-policy.js";
import {
  confluenceInstance,
  type ConfluenceFlags,
  type ConfluenceInstance,
} from "./config.js";
import {
  authorizationFor,
  dialectOf,
  type ConfluenceQuery,
} from "./dialect.js";

export type { ConfluenceQuery } from "./dialect.js";

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
 * account's address, not even by a bug in the broker. A Server / Data Center
 * connection authenticates on the token alone and keeps the field empty: the
 * instance's declared deployment type decides whether it is spent, which is why
 * a credential is never paired with the other product's scheme.
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
  // An empty e-mail is a Server / Data Center connection, which authenticates
  // on the token alone; whether one is *required* is decided by the instance's
  // declared deployment type, at the moment the secret would be spent.
  if (
    typeof record["instanceId"] !== "string" ||
    typeof record["email"] !== "string" ||
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

/** What a listing answers about its own pagination, in provider terms. */
export interface ConfluencePage {
  /**
   * Opaque token from the upstream `_links.next`: a cursor on Cloud, the row
   * offset of the next page on a Server / Data Center installation. It is never
   * a URL: the whole point is that the next request is rebuilt from our own
   * path and parameters, so a caller cannot steer it.
   */
  readonly nextCursor?: string | undefined;
}

export interface ConfluenceJsonResponse<T> {
  readonly data: T;
  readonly page?: ConfluencePage;
}

/**
 * The cursor a listing points at. Confluence puts the next page in
 * `_links.next` as a URL: Cloud's v2 collections carry an opaque `cursor`
 * there, while every offset-paged read — a CQL search on either product, any
 * v1 listing on a Server / Data Center installation — names the `start` of the
 * next page instead. Only that one parameter is kept, because every other part
 * of the URL is ours to build from operator configuration, and the read that
 * issued the token decides how it is spent.
 */
function cursorFrom(links: unknown): string | undefined {
  if (typeof links !== "object" || links === null) return undefined;
  const next = (links as Record<string, unknown>)["next"];
  if (typeof next !== "string" || next === "") return undefined;
  const query = next.includes("?") ? next.slice(next.indexOf("?") + 1) : next;
  const found = new Map<string, string>();
  for (const pair of query.split("&")) {
    const [key, value] = pair.split("=");
    if (value === undefined || value === "") continue;
    if (key !== "cursor" && key !== "start") continue;
    try {
      found.set(key, decodeURIComponent(value));
    } catch {
      found.set(key, value);
    }
  }
  return found.get("cursor") ?? found.get("start");
}

/**
 * The provider error model of Confluence, folded by the shared policy.
 * Confluence answers a page the account may not see with the same 404 as a page
 * that does not exist, and the provider keeps that ambiguity: the model must not
 * learn from an error whether someone else's page is there. A retired endpoint
 * is the one status this product answers unlike the others: it is a provider
 * bug, so it says so instead of blaming the caller's arguments.
 */
const statusFailure = statusErrorOf({
  label: "Confluence",
  rejectedCredential: "Confluence rejected the stored e-mail or API token",
  overrides: {
    410: ["ProviderUnavailable", "Confluence no longer serves this endpoint"],
  },
});

const transportFailure = transportFailureOf({ label: "Confluence" });

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
    return this.request(
      instance,
      credential,
      path,
      query,
      async (response, signal) => {
        const data = await readBoundedJson<T>(
          response,
          this.config.maxResponseBytes,
          "Confluence",
          signal,
        );
        const nextCursor =
          typeof data === "object" && data !== null
            ? cursorFrom((data as Record<string, unknown>)["_links"])
            : undefined;
        return nextCursor === undefined
          ? { data }
          : { data, page: { nextCursor } };
      },
    );
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

  private async request<T>(
    instance: ConfluenceInstance,
    credential: ConfluenceCredential,
    path: string,
    query: ConfluenceQuery,
    read: ResponseRead<T>,
  ): Promise<T> {
    // The one place the secret is spent. Which scheme carries it is the
    // instance's declared deployment type: Basic over `email:token` on Cloud,
    // a bearer token on a Server / Data Center installation.
    const authorization = authorizationFor(dialectOf(instance), credential);
    return fetchWithRetries(
      this.fetcher,
      this.url(instance, path, query),
      {
        timeoutMs: this.config.timeoutMs,
        retries: this.flags.retries,
        headers: {
          authorization,
          accept: "application/json",
        },
        transportFailure,
        statusFailure,
      },
      read,
    );
  }
}
