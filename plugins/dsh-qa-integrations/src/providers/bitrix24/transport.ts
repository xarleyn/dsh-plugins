import { IntegrationError } from "../../errors.js";
import type { ResolvedQaIntegrationsConfig } from "../../config.js";
import { hostMatchesSuffix } from "../shared/host.js";
import { readBoundedJson } from "../shared/http.js";

export interface BitrixCredential {
  readonly webhookBaseUrl: string;
}

interface BitrixEnvelope {
  readonly result?: unknown;
  readonly error?: unknown;
  readonly total?: unknown;
  readonly next?: unknown;
}

export interface BitrixResponse {
  readonly result: unknown;
  readonly total?: number | undefined;
  readonly next?: number | undefined;
}

export function credentialFromPlaintext(plaintext: string): BitrixCredential {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new IntegrationError(
      "CredentialRevoked",
      "Stored credential is invalid",
    );
  }
  const webhookBaseUrl = (parsed as { webhookBaseUrl?: unknown } | null)
    ?.webhookBaseUrl;
  if (typeof webhookBaseUrl !== "string" || webhookBaseUrl === "") {
    throw new IntegrationError(
      "CredentialRevoked",
      "Stored credential is invalid",
    );
  }
  let url: URL;
  try {
    url = new URL(webhookBaseUrl);
  } catch {
    throw new IntegrationError(
      "CredentialRevoked",
      "Stored credential is invalid",
    );
  }
  if (url.protocol !== "https:") {
    throw new IntegrationError(
      "CredentialRevoked",
      "Stored credential is invalid",
    );
  }
  return { webhookBaseUrl };
}

/** Parse a complete incoming-webhook URL without ever returning its secret part. */
export function parseBitrixWebhook(
  raw: string,
  allowedSuffixes: readonly string[],
): { readonly credential: string; readonly portal: string } {
  if (raw.length > 2_048) {
    throw new IntegrationError("InvalidCredential", "Webhook URL is too long");
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new IntegrationError("InvalidCredential", "Webhook URL is invalid");
  }
  const host = url.hostname.toLowerCase();
  const hostAllowed = allowedSuffixes.some((suffix) =>
    hostMatchesSuffix(host, suffix),
  );
  const match = /^\/rest\/(\d+)\/([A-Za-z0-9_-]{8,})\/?$/u.exec(url.pathname);
  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    !hostAllowed ||
    match === null
  ) {
    throw new IntegrationError(
      "InvalidCredential",
      "Use an HTTPS Bitrix24 incoming-webhook URL",
    );
  }
  return {
    credential: JSON.stringify({
      webhookBaseUrl: `${url.origin}/rest/${match[1]}/${match[2]}`,
    } satisfies BitrixCredential),
    portal: host,
  };
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * HTTP boundary of the provider: one webhook call, bounded in time and size,
 * with upstream failures folded into safe domain errors.
 */
export class BitrixTransport {
  constructor(
    private readonly config: ResolvedQaIntegrationsConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async call(
    credential: BitrixCredential,
    method: string,
    // A few Bitrix24 methods take a positional JSON array instead of an object.
    params: Readonly<Record<string, unknown>> | readonly unknown[],
  ): Promise<BitrixResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetcher(
        `${credential.webhookBaseUrl}/${method}.json`,
        {
          method: "POST",
          redirect: "error",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(params),
          signal: controller.signal,
        },
      );
      // The status is decided before the body is touched: a failed answer is
      // never read at all, exactly as in the shared transport loop.
      if (!response.ok) {
        const denied = response.status === 401 || response.status === 403;
        throw new IntegrationError(
          denied ? "ProviderPermissionDenied" : "ProviderUnavailable",
          denied ? "Provider denied this operation" : "Provider request failed",
        );
      }
      // One bounded read for every provider: the deployment's byte cap decides
      // how much is read, and a capped body is `ResultTooLarge`, not a
      // transport failure.
      const envelope = await readBoundedJson<BitrixEnvelope | null>(
        response,
        this.config.maxResponseBytes,
        "Provider",
      );
      if (envelope?.error !== undefined) {
        throw new IntegrationError(
          "ProviderUnavailable",
          "Provider request failed",
        );
      }
      return {
        result: envelope?.result,
        total: count(envelope?.total),
        next: count(envelope?.next),
      };
    } catch (error) {
      if (error instanceof IntegrationError) throw error;
      throw new IntegrationError(
        "ProviderUnavailable",
        "Provider request failed",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
