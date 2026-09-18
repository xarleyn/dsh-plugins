/**
 * Content identity for one audit.
 *
 * The fingerprint answers exactly one question — "are these the same bytes the
 * registry already holds?" — and is only ever computed after the cheap
 * size/mtime gate has already said something moved. A writer that rewrites a
 * file with identical contents, or a filesystem that reports a coarse mtime,
 * therefore costs one read instead of one spurious reload and one spurious
 * `audit.updated` to every subscriber.
 */
import { createHash } from "node:crypto";

/**
 * SHA-256 over the analysis bytes, a separator, and the report bytes.
 *
 * The separator keeps the two documents from being confusable: without it,
 * moving a byte between the end of one file and the start of the other would
 * leave the digest unchanged.
 */
export function computeFingerprint(
  analysisText: string,
  reportText: string,
): string {
  return createHash("sha256")
    .update(analysisText, "utf8")
    .update("\u0000", "utf8")
    .update(reportText, "utf8")
    .digest("hex");
}
