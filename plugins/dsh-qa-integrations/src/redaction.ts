const SECRET_FIELD =
  /^(?:access_token|refresh_token|token|authorization|api_key|secret|credential|mcp_bearer)$/iu;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu;
const WEBHOOK = /\/rest\/\d+\/[A-Za-z0-9_-]{8,}/giu;

/** Deep redaction for diagnostic material. Provider payloads are never logged. */
export function redactSecrets(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(BEARER, "Bearer [REDACTED]")
      .replace(WEBHOOK, "/rest/[REDACTED]");
  }
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SECRET_FIELD.test(key) ? "[REDACTED]" : redactSecrets(item),
    ]),
  );
}
