/**
 * The redaction seam of the review console.
 *
 * Review work needs user prompts, tool arguments and tool results — the exact
 * material most likely to carry credentials, customer data or internal
 * knowledge. The default implementation does not pretend to be a DLP engine; it
 * bounds every preview and masks the credential shapes that appear in tool
 * traffic. A deployment that needs more replaces this object, which is why the
 * projection takes a redactor rather than reading the environment.
 */
export interface QaAdminRedactor {
  /** One user or assistant message text, as the reviewer reads it. */
  redactMessage(text: string): string;
  /** One tool call's raw argument JSON. */
  redactToolArguments(value: string): string;
  /** One tool result preview. */
  redactToolResult(value: string): string;
}

/**
 * Preview bounds. A review needs enough to judge a call, not a full dump: a
 * large result would otherwise dominate the transcript and the wire payload.
 */
export const QA_ADMIN_TEXT_LIMIT = 8_000;
export const QA_ADMIN_ARGUMENTS_LIMIT = 2_000;
export const QA_ADMIN_RESULT_LIMIT = 6_000;

const MASK = "[redacted]";

/**
 * Credential shapes masked out of tool traffic. The list is deliberately short
 * and high-precision: a broad pattern would mangle legitimate review evidence,
 * and a reviewer who cannot trust the transcript stops using it. Each entry
 * keeps whatever prefix identifies the field and replaces only the value.
 */
const MASK_PATTERNS: readonly {
  readonly pattern: RegExp;
  readonly replace: string;
}[] = [
  // Authorization headers and bearer tokens.
  { pattern: /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/giu, replace: MASK },
  // key=value pairs whose key names a secret.
  {
    pattern:
      /((?:password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|private[_-]?key)\s*[=:]\s*)("?)[^\s",;]{4,}\2/giu,
    replace: `$1${MASK}`,
  },
  // JSON string fields whose name says secret.
  {
    pattern:
      /("(?:password|secret|token|api[_-]?key|apiKey|access[_-]?key|client[_-]?secret|private[_-]?key)"\s*:\s*)"(?:[^"\\]|\\.)*"/gu,
    replace: `$1"${MASK}"`,
  },
];

export function maskSecrets(value: string): string {
  let masked = value;
  for (const { pattern, replace } of MASK_PATTERNS) {
    masked = masked.replace(pattern, replace);
  }
  return masked;
}

function bound(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

/** The deployment default: bounded previews with credential shapes masked. */
export const defaultAdminRedactor: QaAdminRedactor = Object.freeze({
  redactMessage: (text: string) =>
    maskSecrets(bound(text, QA_ADMIN_TEXT_LIMIT)),
  redactToolArguments: (value: string) =>
    maskSecrets(bound(value, QA_ADMIN_ARGUMENTS_LIMIT)),
  redactToolResult: (value: string) =>
    maskSecrets(bound(value, QA_ADMIN_RESULT_LIMIT)),
});
