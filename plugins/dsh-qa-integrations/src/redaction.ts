const SECRET_FIELD =
  /^(?:access_token|refresh_token|token|authorization|api_key|apikey|secret|credential|mcp_bearer|private_token|private-token|client_secret|pat|password|passwd|pwd|private_key|access_key)$/iu;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu;
const WEBHOOK = /\/rest\/\d+\/[A-Za-z0-9_-]{8,}/giu;
/** GitLab mints tokens with a typed prefix, so the shape alone identifies one. */
const GITLAB_TOKEN = /\bgl[a-z]{2,10}-[A-Za-z0-9_-]{16,}/gu;
/**
 * A secret a job printed as text. Log and artifact text arrives as a plain
 * string, so the field-name rule above can never see it; these two shapes are
 * what a build actually leaves behind — a key/value (`password=hunter2`,
 * `api_key: …`) and a command line flag (`--token …`). A bare word followed by
 * a space is deliberately not covered: redacting "token not found" would mangle
 * ordinary prose and hide nothing.
 */
const SECRET_KEY =
  "password|passwd|pwd|token|secret|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credential";
/** A value as a shell or a log writes it: bare, single- or double-quoted. */
const VALUE = "(?:\"[^\"]*\"|'[^']*'|\\S+)";
const KEY_VALUE_SECRET = new RegExp(
  `\\b(${SECRET_KEY})\\b(\\s*[=:]\\s*)${VALUE}`,
  "giu",
);
const FLAG_SECRET = new RegExp(`(--?(?:${SECRET_KEY})\\b\\s+)${VALUE}`, "giu");

/** Deep redaction for diagnostic material. Provider payloads are never logged. */
export function redactSecrets(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(BEARER, "Bearer [REDACTED]")
      .replace(WEBHOOK, "/rest/[REDACTED]")
      .replace(GITLAB_TOKEN, "[REDACTED]")
      .replace(
        KEY_VALUE_SECRET,
        (_match, name: string, separator: string) =>
          `${name}${separator}[REDACTED]`,
      )
      .replace(FLAG_SECRET, (_match, flag: string) => `${flag}[REDACTED]`);
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
