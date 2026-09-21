import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  QA_SERVICE_TOKEN_DEFAULT_SCOPES,
  QA_SERVICE_TOKEN_LABEL_MAX,
  QA_SERVICE_TOKEN_SCOPES,
  QA_SERVICE_TOKEN_TTL_DAYS_MAX,
  QA_SERVICE_TOKEN_TTL_DAYS_MIN,
} from "../shared/integration-tokens.js";
import type { QaServiceTokenScope } from "../types.js";

// The scope list and the limits are declared in `shared`, because the profile
// page enforces the same ones and must not import this module's crypto. They
// are re-exported here so the Host's own callers keep one import site.
export {
  QA_SERVICE_TOKEN_DEFAULT_SCOPES,
  QA_SERVICE_TOKEN_LABEL_MAX,
  QA_SERVICE_TOKEN_SCOPES,
  QA_SERVICE_TOKEN_TTL_DAYS_MAX,
  QA_SERVICE_TOKEN_TTL_DAYS_MIN,
};
export type { QaServiceTokenScope };

/**
 * Integration tokens: the credential a non-browser application presents to the
 * QA HTTP API.
 *
 * They are deliberately a second, separate credential from the browser auth
 * token (`accounts/token.ts`). The browser token is an HMAC over a payload that
 * carries the account's `tokenVersion`; bumping that version — what a password
 * change does — signs every browser out. An integration token must survive
 * that: a service that keeps a Jira bridge running cannot be logged out by a
 * human editing their profile. What it *does* share is the accounts database,
 * so a disabled account and the operator's "revoke every token" command still
 * reach it.
 *
 * The plaintext is minted once and never stored. What rests in the database is
 * a SHA-256 digest of the secret, so a leaked database is not a leaked
 * credential, and the token id in front of the secret makes verification one
 * indexed lookup instead of a scan over every account's digests.
 */

/** Marks a credential as an integration token in a log line, a paste or a grep. */
export const QA_SERVICE_TOKEN_PREFIX = "qsat";

const SECRET_BYTES = 32;

/** One minted token: the plaintext to hand over, plus what storage keeps. */
export interface MintedQaServiceToken {
  /** Shown once and never recoverable. */
  readonly token: string;
  readonly tokenId: string;
  /** The digest the store persists. */
  readonly hash: string;
}

/** The parts a presented token splits into, or null when it is not our shape. */
export interface ParsedQaServiceToken {
  readonly tokenId: string;
  readonly secret: string;
}

/**
 * Normalize a scope list: known scopes only, duplicates dropped, declared
 * order preserved. An unknown scope is not an error the caller can see
 * through — it is simply not granted.
 * @param values - scope tokens as configured or requested.
 * @returns the accepted scopes.
 */
export function normalizeServiceTokenScopes(
  values: readonly string[],
): readonly QaServiceTokenScope[] {
  const seen = new Set<string>();
  const accepted: QaServiceTokenScope[] = [];
  for (const value of values) {
    const candidate = typeof value === "string" ? value.trim() : "";
    if (candidate === "" || seen.has(candidate)) continue;
    seen.add(candidate);
    if (
      (QA_SERVICE_TOKEN_SCOPES as readonly string[]).includes(candidate) &&
      !accepted.includes(candidate as QaServiceTokenScope)
    ) {
      accepted.push(candidate as QaServiceTokenScope);
    }
  }
  return Object.freeze(accepted);
}

/** The digest of one secret, hex encoded, in the one shape verification expects. */
export function serviceTokenHash(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/**
 * Mint one token. The id is a UUID so the operator can name a token in a
 * revocation request without ever holding its plaintext again.
 * @returns the plaintext, its id and the digest storage keeps.
 */
export function mintServiceToken(): MintedQaServiceToken {
  const tokenId = randomUUID();
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  return {
    token: `${QA_SERVICE_TOKEN_PREFIX}.${tokenId}.${secret}`,
    tokenId,
    hash: serviceTokenHash(secret),
  };
}

/**
 * Split a presented token. Anything that is not exactly
 * `qsat.<uuid>.<secret>` is refused here rather than looked up: a malformed
 * credential must not reach the database at all.
 * @param token - the raw `Authorization: Bearer` value.
 * @returns the id and secret, or null.
 */
export function parseServiceToken(token: string): ParsedQaServiceToken | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [prefix, tokenId, secret] = parts;
  if (prefix !== QA_SERVICE_TOKEN_PREFIX) return null;
  if (tokenId === undefined || secret === undefined) return null;
  if (!/^[0-9a-f-]{36}$/u.test(tokenId) || secret.length === 0) return null;
  return { tokenId, secret };
}

/**
 * Constant-time digest comparison. Both sides are hex digests of a fixed
 * length, so the length check leaks nothing beyond "this is not a digest".
 * @param secret - the presented secret.
 * @param hash - the digest storage holds.
 * @returns whether they are the same secret.
 */
export function serviceTokenMatches(secret: string, hash: string): boolean {
  const expected = serviceTokenHash(secret);
  if (expected.length !== hash.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(hash));
}
