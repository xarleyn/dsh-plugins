import type { QaServiceTokenScope } from "../types.js";

/**
 * The integration-token vocabulary and its bounds, on the browser side too.
 *
 * Minting lives in `accounts/service-token.ts`, which is Host-only (it hashes a
 * secret before storing it); the profile page has to name the same scopes and
 * enforce the same limits without importing that. Dependency-free like every
 * `src/shared` module, so both bundles inline it and there is exactly one copy
 * of the numbers the two halves have to agree on.
 */

/**
 * What an integration token may do. Scopes are checked per request rather than
 * per deployment: the same bridge token that asks questions carries no
 * permission to read back a conversation catalog it was not given.
 */
export const QA_SERVICE_TOKEN_SCOPES: readonly QaServiceTokenScope[] =
  Object.freeze(["ask", "sessions:read"]);

/** A token that carries no scope is useless; `ask` is what the API is for. */
export const QA_SERVICE_TOKEN_DEFAULT_SCOPES: readonly QaServiceTokenScope[] =
  Object.freeze(["ask"]);

/** Bounds the caller's label; it is a note to the operator, not a document. */
export const QA_SERVICE_TOKEN_LABEL_MAX = 80;

/** Bounds on a token's life; zero or a negative TTL would mint a dead token. */
export const QA_SERVICE_TOKEN_TTL_DAYS_MIN = 1;
export const QA_SERVICE_TOKEN_TTL_DAYS_MAX = 3650;
