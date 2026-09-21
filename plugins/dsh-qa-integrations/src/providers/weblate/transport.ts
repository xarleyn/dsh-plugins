import type { ResolvedQaIntegrationsConfig } from "../../config.js";
import { IntegrationError } from "../../errors.js";
import {
  TLS_FAILURE,
  causeCode,
  fetchWithRetries,
  readBoundedJson,
} from "../shared/http.js";
import {
  weblateInstance,
  type WeblateFlags,
  type WeblateInstance,
} from "./config.js";

/**
 * Encrypted credential payload of one Weblate connection: which configured
 * instance the token belongs to, and the token itself. The base URL is not
 * stored — it is re-resolved from operator config on every call, so removing or
 * repointing an instance takes effect at once instead of at the next connect.
 */
export interface WeblateCredential {
  readonly instanceId: string;
  readonly token: string;
}

export function credentialFromPlaintext(plaintext: string): WeblateCredential {
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
  flags: WeblateFlags,
  credential: WeblateCredential,
): WeblateInstance {
  const instance = weblateInstance(flags, credential.instanceId);
  if (instance === undefined) {
    throw new IntegrationError(
      "CredentialRevoked",
      "Weblate instance is no longer configured",
    );
  }
  return instance;
}

export interface WeblateQuery {
  readonly [key: string]: string | number | undefined;
}

/**
 * One page of a Weblate collection. Weblate paginates in the body
 * (`count`/`next`/`previous`/`results`), not in headers, and its `next` is an
 * absolute URL: only the page number is read out of it, and only when it points
 * at the configured instance, so a hostile or misconfigured upstream cannot move
 * a follow-up request to another origin.
 */
export interface WeblatePage {
  readonly page: number;
  readonly perPage: number;
  readonly nextPage?: number;
  readonly total?: number;
}

export interface WeblateJsonResponse<T> {
  readonly data: T;
  readonly page?: WeblatePage;
}

/** The `results` array of a paginated answer, or an empty list. */
export function resultsOf(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "object" && value !== null) {
    const results = (value as Record<string, unknown>)["results"];
    if (Array.isArray(results)) return results;
  }
  return [];
}

/** Total item count of a paginated answer, when upstream reported one. */
function countOf(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const count = (value as Record<string, unknown>)["count"];
  return typeof count === "number" && Number.isFinite(count)
    ? count
    : undefined;
}

/**
 * The page number inside Weblate's `next` link, kept only for our own origin.
 * `undefined` means "either there is no further page or we were not told about
 * one we may follow", and the caller reports the list as complete either way.
 */
function nextPageOf(
  value: unknown,
  instance: WeblateInstance,
  page: number,
): number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const next = (value as Record<string, unknown>)["next"];
  if (typeof next !== "string" || next.trim() === "") return undefined;
  let url: URL;
  try {
    url = new URL(next);
  } catch {
    return undefined;
  }
  if (url.origin !== new URL(instance.baseUrl).origin) return undefined;
  const requested = Number(url.searchParams.get("page"));
  return Number.isInteger(requested) && requested > page
    ? requested
    : undefined;
}

/**
 * HTTP boundary of the provider: one documented Weblate REST call, bounded in
 * time and size, with upstream failures folded into safe domain errors and
 * bounded retries for the transient ones.
 */
export class WeblateTransport {
  constructor(
    private readonly config: ResolvedQaIntegrationsConfig,
    private readonly flags: WeblateFlags,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async getJson<T>(
    instance: WeblateInstance,
    token: string,
    path: string,
    query: WeblateQuery = {},
    requested?: { readonly page: number; readonly perPage: number },
  ): Promise<WeblateJsonResponse<T>> {
    const response = await this.request(instance, token, path, query);
    const data = await readBoundedJson<T>(
      response,
      this.config.maxResponseBytes,
      "Provider",
    );
    if (requested === undefined) return { data };
    const nextPage = nextPageOf(data, instance, requested.page);
    const total = countOf(data);
    return {
      data,
      page: {
        page: requested.page,
        perPage: requested.perPage,
        ...(nextPage === undefined ? {} : { nextPage }),
        ...(total === undefined ? {} : { total }),
      },
    };
  }

  private url(
    instance: WeblateInstance,
    path: string,
    query: WeblateQuery,
  ): string {
    const url = new URL(`${instance.baseUrl}/api${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private async request(
    instance: WeblateInstance,
    token: string,
    path: string,
    query: WeblateQuery,
  ): Promise<Response> {
    return fetchWithRetries(this.fetcher, this.url(instance, path, query), {
      timeoutMs: this.config.timeoutMs,
      retries: this.flags.retries,
      headers: {
        // The long-standing scheme Weblate documents; `Bearer` is accepted
        // upstream as well, but a token that only works with one of the two
        // should not depend on which one this provider happened to pick.
        authorization: `Token ${token}`,
        accept: "application/json",
      },
      // Aborts, DNS failures and refused connections: a transient network
      // fault is worth one more attempt, a permanent one keeps failing. The
      // deadline is this deployment's own, so a request it already gave up on
      // is not sent again.
      transportFailure: (error, timedOut) =>
        timedOut
          ? new IntegrationError("UpstreamTimeout", "Weblate did not answer")
          : TLS_FAILURE.test(causeCode(error))
            ? new IntegrationError("TlsFailure", "Weblate TLS handshake failed")
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
        "Weblate rejected the stored token",
      );
    }
    if (status === 403) {
      return new IntegrationError(
        "ProviderPermissionDenied",
        "Weblate denied this operation",
      );
    }
    if (status === 404) {
      return new IntegrationError(
        "ResourceNotFound",
        "Weblate resource not found",
      );
    }
    if (status === 405) {
      // A read this Weblate release does not offer: the provider only issues
      // GETs, so "method not allowed" means the endpoint itself is absent here.
      return new IntegrationError(
        "ResourceNotFound",
        "This Weblate release does not offer the operation",
      );
    }
    if (status === 429) {
      return new IntegrationError("RateLimited", "Weblate rate limit reached");
    }
    if (status === 400 || status === 422) {
      return new IntegrationError(
        "InvalidRequest",
        "Weblate rejected the request",
      );
    }
    return new IntegrationError(
      "ProviderUnavailable",
      "Weblate request failed",
    );
  }
}
