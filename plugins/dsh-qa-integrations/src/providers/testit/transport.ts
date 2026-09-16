import type { ResolvedQaIntegrationsConfig } from "../../config.js";
import { IntegrationError } from "../../errors.js";
import {
  TLS_FAILURE,
  causeCode,
  fetchWithRetries,
  readBoundedText,
  type BoundedText,
} from "../shared/http.js";
import {
  testitInstance,
  type TestitFlags,
  type TestitInstance,
} from "./config.js";

/**
 * Encrypted credential payload of one Test IT connection: which configured
 * installation the API token belongs to, and the token itself. The base URL is
 * not stored — it is re-resolved from operator config on every call, so
 * removing or repointing an instance takes effect at once instead of at the
 * next connect.
 */
export interface TestitCredential {
  readonly instanceId: string;
  readonly token: string;
}

export function credentialFromPlaintext(plaintext: string): TestitCredential {
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
 * The configured installation a credential belongs to. A token minted for an
 * instance the operator has since removed fails closed: it never falls back to
 * another instance, however permissive that one is.
 */
export function credentialInstance(
  flags: TestitFlags,
  credential: TestitCredential,
): TestitInstance {
  const instance = testitInstance(flags, credential.instanceId);
  if (instance === undefined) {
    throw new IntegrationError(
      "CredentialRevoked",
      "Test IT instance is no longer configured",
    );
  }
  return instance;
}

export interface TestitQuery {
  readonly [key: string]: string | number | boolean | undefined;
}

/** What Test IT reports about the page it just answered with. */
export interface TestitPage {
  readonly skip?: number | undefined;
  readonly take?: number | undefined;
  readonly total?: number | undefined;
  readonly pages?: number | undefined;
}

export interface TestitJsonResponse<T> {
  readonly data: T;
  readonly page?: TestitPage | undefined;
}

export type TestitTextResponse = BoundedText;

function numberFrom(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * The `Pagination-*` headers Test IT puts on a paged answer. They are the only
 * way to learn the total: the response body is a bare array, and the search
 * endpoints that would report a count are POST-only.
 */
function pageFrom(headers: Headers): TestitPage | undefined {
  const page: TestitPage = {
    skip: numberFrom(headers.get("pagination-skip")),
    take: numberFrom(headers.get("pagination-take")),
    total: numberFrom(headers.get("pagination-total-items")),
    pages: numberFrom(headers.get("pagination-pages")),
  };
  // Each header is read on its own: an installation that reports the total but
  // not the window still tells the model where the end of the collection is.
  return Object.values(page).every((value) => value === undefined)
    ? undefined
    : page;
}

/**
 * HTTP boundary of the provider: one documented Test IT API call, bounded in
 * time and size, with upstream failures folded into safe domain errors and
 * bounded retries for the transient ones.
 *
 * The API token reaches Test IT as the `PrivateToken` authorization header and
 * nowhere else: no query parameter, URL segment or body this provider builds
 * ever carries it.
 */
export class TestitTransport {
  constructor(
    private readonly config: ResolvedQaIntegrationsConfig,
    private readonly flags: TestitFlags,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async getJson<T>(
    instance: TestitInstance,
    token: string,
    path: string,
    query: TestitQuery = {},
  ): Promise<TestitJsonResponse<T>> {
    const response = await this.request(
      instance,
      token,
      path,
      query,
      this.config.timeoutMs,
    );
    const body = await readBoundedText(response, this.config.maxResponseBytes);
    if (body.truncated) {
      throw new IntegrationError(
        "ResultTooLarge",
        "Test IT response is too large",
      );
    }
    let data: T;
    try {
      data = JSON.parse(body.text) as T;
    } catch {
      throw new IntegrationError(
        "ProviderUnavailable",
        "Test IT returned invalid JSON",
      );
    }
    const page = pageFrom(response.headers);
    return page === undefined ? { data } : { data, page };
  }

  /**
   * A bounded byte read: the one attachment download, which is not JSON and
   * whose budget is the caller's, capped by the deployment.
   */
  async getText(
    instance: TestitInstance,
    token: string,
    path: string,
    maxBytes: number,
    query: TestitQuery = {},
  ): Promise<TestitTextResponse> {
    const response = await this.request(
      instance,
      token,
      path,
      query,
      this.flags.attachmentTimeoutMs,
    );
    return readBoundedText(
      response,
      Math.min(maxBytes, this.config.maxResponseBytes),
    );
  }

  private url(
    instance: TestitInstance,
    path: string,
    query: TestitQuery,
  ): string {
    const url = new URL(`${instance.baseUrl}/api/v2${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private async request(
    instance: TestitInstance,
    token: string,
    path: string,
    query: TestitQuery,
    timeoutMs: number,
  ): Promise<Response> {
    return fetchWithRetries(this.fetcher, this.url(instance, path, query), {
      timeoutMs,
      retries: this.flags.retries,
      headers: {
        authorization: `PrivateToken ${token}`,
        accept: "application/json",
      },
      transportFailure: (error, timedOut) =>
        timedOut
          ? new IntegrationError("UpstreamTimeout", "Test IT did not answer")
          : TLS_FAILURE.test(causeCode(error))
            ? new IntegrationError("TlsFailure", "Test IT TLS handshake failed")
            : new IntegrationError(
                "ProviderUnavailable",
                "Test IT request failed",
              ),
      // A refused connection stays refused; a slow installation is more often
      // busy than gone, so anything else earns another bounded attempt.
      retriable: (error) => error.code !== "UpstreamTimeout",
      statusFailure: (response) => this.failure(response),
    });
  }

  /**
   * The provider error model. Test IT answers a missing or hidden resource with
   * 404 and a refused permission with 403; both stay distinct so the model can
   * tell "you may not" from "it is not there", and neither ever carries an
   * upstream body, which can name internal hosts or echo the request.
   */
  private failure(response: Response): IntegrationError {
    const status = response.status;
    if (status === 401) {
      return new IntegrationError(
        "CredentialRevoked",
        "Test IT rejected the stored token",
      );
    }
    if (status === 403) {
      return new IntegrationError(
        "ProviderPermissionDenied",
        "Test IT denied this operation",
      );
    }
    if (status === 404) {
      return new IntegrationError(
        "ResourceNotFound",
        "Test IT resource not found",
      );
    }
    if (status === 413) {
      return new IntegrationError(
        "ResultTooLarge",
        "Test IT response is too large",
      );
    }
    if (status === 429) {
      return new IntegrationError("RateLimited", "Test IT rate limit reached");
    }
    if (status === 400 || status === 409 || status === 422) {
      return new IntegrationError(
        "InvalidRequest",
        "Test IT rejected the request",
      );
    }
    return new IntegrationError(
      "ProviderUnavailable",
      "Test IT request failed",
    );
  }
}
