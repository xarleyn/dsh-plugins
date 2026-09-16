/**
 * Structured error taxonomy (SPEC §13). Every failure the provider can surface
 * is a `WebError` with a plugin-specific `AUTH_FETCH_*` code (the seam allows
 * provider-specific codes; `dsh-tool-web` exposes them in structured error
 * metadata). Messages are constructed here once, from sanitized fragments —
 * never from raw transport dumps — and the `detail` helper scrubs anything
 * derived from free text (invariant 8).
 * @module errors
 */

import { WebError } from "@deepseek-ai/dsh-web";
import { redactSecretsInText } from "./audit/redact.js";
import { truncateForMessage } from "./policy/url.js";

export const AUTH_FETCH_ERROR_CODES = {
  noMatchingRule: "AUTH_FETCH_NO_MATCHING_RULE",
  ruleDisabled: "AUTH_FETCH_RULE_DISABLED",
  ambiguousMatch: "AUTH_FETCH_AMBIGUOUS_MATCH",
  credentialMissing: "AUTH_FETCH_CREDENTIAL_MISSING",
  credentialInvalid: "AUTH_FETCH_CREDENTIAL_INVALID",
  networkDenied: "AUTH_FETCH_NETWORK_DENIED",
  dnsDenied: "AUTH_FETCH_DNS_POLICY_DENIED",
  redirectDenied: "AUTH_FETCH_REDIRECT_DENIED",
  responseTooLarge: "AUTH_FETCH_RESPONSE_TOO_LARGE",
  unsupportedContent: "AUTH_FETCH_UNSUPPORTED_CONTENT",
  documentTooLarge: "AUTH_FETCH_DOCUMENT_TOO_LARGE",
  documentUnreadable: "AUTH_FETCH_DOCUMENT_UNREADABLE",
  timeout: "AUTH_FETCH_TIMEOUT",
  invalidUrl: "AUTH_FETCH_INVALID_URL",
  providerError: "AUTH_FETCH_PROVIDER_ERROR",
  adapterFailed: "AUTH_FETCH_ADAPTER_FAILED",
} as const;

/** Scrub free text before it enters an error message. */
export function sanitizedDetail(error: unknown, maxLength = 300): string {
  return redactSecretsInText(
    truncateForMessage(describePlain(error), maxLength),
  );
}

function describePlain(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function noMatchingRule(url: string, ruleCount: number): WebError {
  return new WebError(
    `no enabled authenticated-fetch rule matches "${truncateForMessage(url)}" (${ruleCount} rules configured)`,
    AUTH_FETCH_ERROR_CODES.noMatchingRule,
  );
}

export function ambiguousMatch(
  url: string,
  ruleIds: readonly string[],
): WebError {
  return new WebError(
    `multiple enabled rules match "${truncateForMessage(url)}" (${ruleIds.join(", ")}); rules must be unambiguous`,
    AUTH_FETCH_ERROR_CODES.ambiguousMatch,
  );
}

export function ruleDisabled(ruleId: string): WebError {
  return new WebError(
    `authenticated-fetch rule "${ruleId}" is disabled`,
    AUTH_FETCH_ERROR_CODES.ruleDisabled,
  );
}

export function invalidUrl(message: string): WebError {
  return new WebError(message, AUTH_FETCH_ERROR_CODES.invalidUrl);
}

export function credentialMissing(ref: string, ruleId: string): WebError {
  return new WebError(
    `credential "${ref}" required by rule "${ruleId}" is not configured`,
    AUTH_FETCH_ERROR_CODES.credentialMissing,
  );
}

export function credentialInvalid(ref: string, ruleId: string): WebError {
  return new WebError(
    `credential reference "${ref}" of rule "${ruleId}" is not a valid credential name`,
    AUTH_FETCH_ERROR_CODES.credentialInvalid,
  );
}

export function networkDenied(detail: string): WebError {
  return new WebError(
    `network access denied by policy: ${detail}`,
    AUTH_FETCH_ERROR_CODES.networkDenied,
  );
}

export function dnsResolutionFailed(detail: string): WebError {
  return new WebError(detail, AUTH_FETCH_ERROR_CODES.dnsDenied);
}

export function redirectDenied(detail: string): WebError {
  return new WebError(detail, AUTH_FETCH_ERROR_CODES.redirectDenied);
}

export function responseTooLarge(maxResponseBytes: number): WebError {
  return new WebError(
    `response exceeds the maximum of ${maxResponseBytes} bytes`,
    AUTH_FETCH_ERROR_CODES.responseTooLarge,
  );
}

export function unsupportedContent(contentType: string | null): WebError {
  return new WebError(
    `unsupported content type "${contentType ?? "unknown"}"`,
    AUTH_FETCH_ERROR_CODES.unsupportedContent,
  );
}

export function unsupportedCharset(charset: string): WebError {
  return new WebError(
    `unsupported charset "${charset}"`,
    AUTH_FETCH_ERROR_CODES.unsupportedContent,
  );
}

/** An attachment is a document this plugin cannot turn into text (SPEC §15.3). */
export function documentNotExtractable(
  filename: string,
  reason: string,
): WebError {
  const label =
    filename.trim().length > 0
      ? `"${truncateForMessage(filename, 120)}"`
      : "the attachment";
  return new WebError(
    `${label} cannot be read: ${sanitizedDetail(reason)}`,
    AUTH_FETCH_ERROR_CODES.documentUnreadable,
  );
}

/** A document exceeded the configured extraction download cap (SPEC §15.3). */
export function documentTooLarge(filename: string, maxBytes: number): WebError {
  const label =
    filename.trim().length > 0
      ? `"${truncateForMessage(filename, 120)}"`
      : "the document";
  return new WebError(
    `${label} is larger than the configured extraction limit of ${maxBytes} bytes; raise documents.maxBytes to read it`,
    AUTH_FETCH_ERROR_CODES.documentTooLarge,
  );
}

/** Bytes that claimed to be a document but are not one this plugin reads. */
export function documentUnreadable(filename: string): WebError {
  const label =
    filename.trim().length > 0
      ? `"${truncateForMessage(filename, 120)}"`
      : "the attachment";
  return new WebError(
    `${label} is not a readable Word or OpenDocument file`,
    AUTH_FETCH_ERROR_CODES.documentUnreadable,
  );
}

export function timeout(): WebError {
  return new WebError(
    "authenticated fetch timed out",
    AUTH_FETCH_ERROR_CODES.timeout,
  );
}

export function aborted(cause?: unknown): WebError {
  return new WebError(
    "authenticated fetch aborted",
    "WEB_ABORTED",
    cause === undefined ? undefined : { cause },
  );
}

export function providerError(detail: string, cause?: unknown): WebError {
  return new WebError(
    `authenticated fetch failed: ${detail}`,
    AUTH_FETCH_ERROR_CODES.providerError,
    cause === undefined ? undefined : { cause },
  );
}

/** A content adapter could not produce its normalized text (SPEC §15.2). */
export function adapterFailed(detail: string, cause?: unknown): WebError {
  return new WebError(
    `content adapter failed: ${detail}`,
    AUTH_FETCH_ERROR_CODES.adapterFailed,
    cause === undefined ? undefined : { cause },
  );
}
