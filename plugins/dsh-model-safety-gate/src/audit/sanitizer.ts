/**
 * Audit sanitization (design SPEC §23).
 *
 * By default audit records carry a content hash, never the content itself:
 * raw blocked content, secret values, and matched spans stay out of logs and
 * session events unless `audit.includeRawContent` is explicitly enabled.
 */

import { createHash } from "node:crypto";

/** SHA-256 of the checked content; the stable audit identifier. */
export function contentSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Bounded raw-content preview for opt-in raw logging. Control characters and
 * zero-width tricks are neutralized so logs stay single-line and readable.
 */
export function rawPreview(content: string, maxChars: number): string {
  // Stripping control characters is the purpose of this expression.
  // eslint-disable-next-line no-control-regex
  const flattened = content.replace(/[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, " ");
  return flattened.length <= maxChars ? flattened : `${flattened.slice(0, Math.max(0, maxChars - 1))}…`;
}
