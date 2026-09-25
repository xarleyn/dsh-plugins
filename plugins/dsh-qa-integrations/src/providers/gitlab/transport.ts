import type { ResolvedQaIntegrationsConfig } from "../../config.js";
import { statusErrorOf, transportFailureOf } from "../kernel/errors.js";
import {
  fetchWithRetries,
  numberFrom,
  readBoundedJson,
  readBoundedText,
  type BoundedText,
} from "../kernel/read-policy.js";
import {
  decodeCredentialFields,
  requireConfiguredEndpoint,
} from "../kernel/token.js";
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
  const { instanceId, token } = decodeCredentialFields(plaintext, {
    instanceId: "text",
    token: "nonempty",
  });
  return { instanceId, token };
}

/**
 * The configured instance a credential belongs to: a credential minted for an
 * instance the operator has since removed fails closed.
 */
export function credentialInstance(
  flags: GitlabFlags,
  credential: GitlabCredential,
): GitlabInstance {
  return requireConfiguredEndpoint(
    gitlabInstance(flags, credential.instanceId),
    "GitLab instance is no longer configured",
  );
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

/** How GitLab reads an upstream status: the shared folding, in its own words. */
const statusFailure = statusErrorOf({ label: "GitLab" });

// Aborts, DNS failures and refused connections: a transient network fault is
// worth one more attempt, a permanent one keeps failing. The deadline is this
// deployment's own, so a request it already gave up on is not sent again.
const transportFailure = transportFailureOf({
  label: "GitLab",
  unreachable: "Provider request failed",
});

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
      transportFailure,
      retriable: (error) => error.code !== "UpstreamTimeout",
      statusFailure,
    });
  }
}
