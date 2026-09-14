/**
 * Derived from OpenViking's @openviking/dsh-memory-plugin.
 * Original project: https://github.com/volcengine/OpenViking
 * Licensed under the Apache License, Version 2.0.
 *
 * Modified by the @yadsh/dsh-openviking-memory project.
 */

// GENERATED FROM examples/memory-plugin-shared/lib. DO NOT EDIT.

/**
 * The structural shape of an OpenViking HTTP result this predicate reads.
 * Only `ok`, `status`, and `error.details.retryable` are consulted; anything
 * else a transport layer attaches is left opaque.
 */
export interface RetryableResult {
  readonly ok?: boolean;
  readonly status?: number;
  readonly error?: {
    readonly code?: string;
    readonly details?: unknown;
  } | null;
}

export function isRetryableFailure(
  result: RetryableResult | null | undefined,
): boolean {
  if (!result || result.ok) return false;
  const status = Number(result.status || 0);
  if (!status || status === 408 || status === 429 || status >= 500) {
    return true;
  }
  return status === 409 && retryableFlag(result.error?.details) === true;
}

/**
 * `error.details` is an untyped wire value, so the single field this predicate
 * trusts is read behind an explicit object guard.
 */
function retryableFlag(details: unknown): unknown {
  if (!details || typeof details !== "object") return undefined;
  return (details as { readonly retryable?: unknown }).retryable;
}
