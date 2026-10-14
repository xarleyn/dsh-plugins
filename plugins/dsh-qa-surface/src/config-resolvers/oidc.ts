import type { QaSurfaceConfig, ResolvedQaOidcConfig } from "../types.js";
import { DEFAULT_QA_SURFACE_CONFIG } from "./defaults.js";
import { assertIntInRange } from "./shared.js";

export function resolveOidc(input: QaSurfaceConfig): ResolvedQaOidcConfig {
  const raw = input.accounts?.oidc;
  const defaults = DEFAULT_QA_SURFACE_CONFIG.accounts.oidc;
  const value = { ...defaults, ...raw };
  for (const key of [
    "issuer",
    "clientId",
    "clientSecretEnv",
    "redirectUri",
    "buttonLabel",
    "requiredRole",
    "adminRole",
    "reviewerRole",
  ] as const) {
    if (typeof value[key] !== "string")
      throw new TypeError(`accounts.oidc.${key} must be a string`);
    value[key] = value[key].trim();
  }
  assertIntInRange(
    "accounts.oidc.sessionTtlSeconds",
    value.sessionTtlSeconds,
    60,
    3600,
  );
  if (value.enabled) {
    if (!input.accounts?.enabled)
      throw new TypeError("accounts.oidc requires accounts.enabled");
    for (const key of ["issuer", "redirectUri"] as const) {
      const url = new URL(value[key]);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      ) {
        throw new TypeError(`accounts.oidc.${key} must be a plain HTTPS URL`);
      }
      value[key] = url.href;
    }
    if (!value.clientId || !value.buttonLabel)
      throw new TypeError("accounts.oidc requires clientId and buttonLabel");
    if (
      value.clientSecretEnv &&
      !/^[A-Z_][A-Z0-9_]*$/u.test(value.clientSecretEnv)
    ) {
      throw new TypeError(
        "accounts.oidc.clientSecretEnv must name an environment variable",
      );
    }
    if (value.adminRole && value.adminRole === value.reviewerRole) {
      throw new TypeError("accounts.oidc role mappings must be distinct");
    }
  }
  if (
    input.accounts?.enabled &&
    input.accounts.localLogin === false &&
    !value.enabled
  ) {
    throw new TypeError(
      "accounts.localLogin=false requires accounts.oidc.enabled",
    );
  }
  return Object.freeze(value);
}
