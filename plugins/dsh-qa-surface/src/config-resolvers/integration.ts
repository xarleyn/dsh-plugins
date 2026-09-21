import type { QaIntegrationConfig, ResolvedQaSurfaceConfig } from "../types.js";
import { DEFAULT_QA_SURFACE_CONFIG } from "./defaults.js";
import { assertIntInRange } from "./shared.js";

type ResolvedIntegration = ResolvedQaSurfaceConfig["integration"];

/** Operator-tunable bounds; the values the settings card shows as hard limits. */
export const QA_INTEGRATION_TTL_DAYS_MIN = 1;
export const QA_INTEGRATION_TTL_DAYS_MAX = 3650;
export const QA_INTEGRATION_TIMEOUT_MS_MIN = 5_000;
export const QA_INTEGRATION_TIMEOUT_MS_MAX = 600_000;
export const QA_INTEGRATION_CONCURRENCY_MIN = 1;
export const QA_INTEGRATION_CONCURRENCY_MAX = 16;
export const QA_INTEGRATION_RATE_MIN = 1;
export const QA_INTEGRATION_RATE_MAX = 600;
export const QA_INTEGRATION_BODY_BYTES_MIN = 1_048_576;
export const QA_INTEGRATION_BODY_BYTES_MAX = 67_108_864;
export const QA_INTEGRATION_ATTACHMENT_BYTES_MIN = 1024;
export const QA_INTEGRATION_ANSWER_CHARS_MIN = 256;
export const QA_INTEGRATION_ANSWER_CHARS_MAX = 65_536;

/**
 * Normalize the integration API's base path.
 *
 * It is a route namespace rather than a page: it may live under `/qa` (the
 * default does), because the web server tries its exact table before the QA
 * navigation's prefix, so `/qa/api/ask` never falls into the page route. What
 * it may not do is claim the operator root, the first-party `/api` namespace
 * or the plugin asset namespace.
 * @param value - the configured path.
 * @returns the path without a trailing slash.
 */
export function normalizeIntegrationBasePath(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "" || !trimmed.startsWith("/")) {
    throw new TypeError(
      "dsh-qa-surface: integration.basePath must start with /",
    );
  }
  const path = trimmed.replace(/\/+$/u, "");
  if (path === "" || path === "/") {
    throw new TypeError(
      "dsh-qa-surface: integration.basePath cannot claim the operator root",
    );
  }
  if (path === "/api" || path.startsWith("/api/")) {
    throw new TypeError(
      "dsh-qa-surface: integration.basePath cannot claim /api",
    );
  }
  if (path === "/plugins" || path.startsWith("/plugins/")) {
    throw new TypeError(
      "dsh-qa-surface: integration.basePath cannot claim /plugins",
    );
  }
  return path;
}

/**
 * The integration API's slice of the resolved configuration.
 *
 * The endpoint is off unless a deployment asks for it: it is a network
 * surface reachable by anything that holds a token, and a QA stand that never
 * integrates anything must not grow one by accident.
 *
 * It also needs accounts. Integration tokens are issued to an account and
 * verified against it, so a deployment with `accounts.enabled: false` has
 * nothing to authenticate a caller with; switching the API on there is a
 * configuration mistake, and it is refused rather than served open.
 *
 * @param input - raw integration config.
 * @param accounts - the resolved accounts domain, for the cross-check.
 * @returns the frozen resolved slice.
 */
export function resolveIntegration(
  input: QaIntegrationConfig | undefined,
  accounts: ResolvedQaSurfaceConfig["accounts"],
): ResolvedIntegration {
  const fallback = DEFAULT_QA_SURFACE_CONFIG.integration;
  const enabled = input?.enabled ?? fallback.enabled;
  const basePath = normalizeIntegrationBasePath(
    input?.basePath ?? fallback.basePath,
  );
  const tokenTtlDays = input?.tokenTtlDays ?? fallback.tokenTtlDays;
  const requestTimeoutMs = input?.requestTimeoutMs ?? fallback.requestTimeoutMs;
  const maxConcurrent = input?.maxConcurrent ?? fallback.maxConcurrent;
  const requestsPerMinute =
    input?.requestsPerMinute ?? fallback.requestsPerMinute;
  const maxRequestBytes = input?.maxRequestBytes ?? fallback.maxRequestBytes;
  const maxAttachmentBytes =
    input?.maxAttachmentBytes ?? fallback.maxAttachmentBytes;
  const maxAnswerCharacters =
    input?.maxAnswerCharacters ?? fallback.maxAnswerCharacters;

  assertIntInRange(
    "integration.tokenTtlDays",
    tokenTtlDays,
    QA_INTEGRATION_TTL_DAYS_MIN,
    QA_INTEGRATION_TTL_DAYS_MAX,
  );
  assertIntInRange(
    "integration.requestTimeoutMs",
    requestTimeoutMs,
    QA_INTEGRATION_TIMEOUT_MS_MIN,
    QA_INTEGRATION_TIMEOUT_MS_MAX,
  );
  assertIntInRange(
    "integration.maxConcurrent",
    maxConcurrent,
    QA_INTEGRATION_CONCURRENCY_MIN,
    QA_INTEGRATION_CONCURRENCY_MAX,
  );
  assertIntInRange(
    "integration.requestsPerMinute",
    requestsPerMinute,
    QA_INTEGRATION_RATE_MIN,
    QA_INTEGRATION_RATE_MAX,
  );
  assertIntInRange(
    "integration.maxRequestBytes",
    maxRequestBytes,
    QA_INTEGRATION_BODY_BYTES_MIN,
    QA_INTEGRATION_BODY_BYTES_MAX,
  );
  assertIntInRange(
    "integration.maxAttachmentBytes",
    maxAttachmentBytes,
    QA_INTEGRATION_ATTACHMENT_BYTES_MIN,
    maxRequestBytes,
  );
  assertIntInRange(
    "integration.maxAnswerCharacters",
    maxAnswerCharacters,
    QA_INTEGRATION_ANSWER_CHARS_MIN,
    QA_INTEGRATION_ANSWER_CHARS_MAX,
  );
  if (enabled && !accounts.enabled) {
    throw new TypeError(
      "dsh-qa-surface: integration.enabled requires accounts.enabled: the API authenticates with an account's integration token",
    );
  }
  return Object.freeze({
    enabled,
    basePath,
    tokenTtlDays,
    requestTimeoutMs,
    maxConcurrent,
    requestsPerMinute,
    maxRequestBytes,
    maxAttachmentBytes,
    maxAnswerCharacters,
  });
}
