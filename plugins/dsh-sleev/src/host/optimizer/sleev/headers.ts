/** Default loopback listener installed by the Sleev CLI. */
export const DEFAULT_SLEEV_GATEWAY_URL = "http://127.0.0.1:17321/v1";

/**
 * Temporary compatibility choice for DSH's pi-ai transport.
 *
 * Sleev does not currently document a native DeepSeek Harness id. Keep this
 * value visible and user-overridable rather than presenting it as guaranteed.
 */
export const EXPERIMENTAL_DSH_HARNESS_ID = "pi";

/** Route a provider Sleev knows by its provider id. */
export interface SleevKnownProviderTarget {
  readonly kind: "provider";
  readonly provider: string;
  readonly harnessId: string;
}

/** Route an arbitrary OpenAI-compatible upstream URL through Sleev. */
export interface SleevCustomProviderTarget {
  readonly kind: "custom";
  readonly baseUrl: string;
  readonly harnessId: string;
}

/** Sleev routing target accepted by {@link buildSleevHeaders}. */
export type SleevRouteTarget =
  SleevKnownProviderTarget | SleevCustomProviderTarget;

function safeHeaderValue(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`dsh-sleev: ${field} must be non-empty`);
  }
  if (/\r|\n/u.test(normalized)) {
    throw new Error(`dsh-sleev: ${field} cannot contain a line break`);
  }
  return normalized;
}

function upstreamUrl(value: string): string {
  const normalized = safeHeaderValue(value, "baseUrl");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("dsh-sleev: baseUrl must be an absolute HTTP(S) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("dsh-sleev: baseUrl must use HTTP or HTTPS");
  }
  return normalized;
}

/**
 * Build only the public Sleev routing headers. Authorization remains owned by
 * DSH credentials and llm-pi-ai, so this result can be logged or inspected.
 */
export function buildSleevHeaders(
  target: SleevRouteTarget,
): Readonly<Record<string, string>> {
  const harness = safeHeaderValue(target.harnessId, "harnessId");
  if (target.kind === "provider") {
    return Object.freeze({
      "sleev-provider": safeHeaderValue(target.provider, "provider"),
      "sleev-harness": harness,
    });
  }
  return Object.freeze({
    "sleev-base-url": upstreamUrl(target.baseUrl),
    "sleev-harness": harness,
  });
}
