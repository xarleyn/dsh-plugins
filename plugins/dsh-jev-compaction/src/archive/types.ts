/**
 * Archive contract (result-shaping SPEC §22).
 *
 * Immediate shaping happens before DSH persists the final tool result, so the
 * pre-shaping content is not recoverable from session replay. The archive is
 * the plugin's own copy, addressed by the hash of what it stores, and it is
 * the only reason a shaped result can ever be inspected again.
 */

import type { ContentBlockLike } from "../result-shaping/text.js";

/** One archived pre-shaping result. */
export interface ArchivedToolResult {
  /** Schema version of the stored record. */
  readonly version: 1;
  /** ISO-8601 creation timestamp. */
  readonly createdAt: string;
  readonly sessionId?: string;
  readonly callId: string;
  readonly toolName: string;
  /** The rendered content that would have been persisted. */
  readonly content: readonly ContentBlockLike[];
  /** `sha256:<hex>` over the canonical form of `content`. */
  readonly contentHash: string;
  /** Code-point length of the joined text, for reporting. */
  readonly charCount: number;
}

/** Opaque handle to one archived entry: `sha256:<hex>`. */
export type ArchiveRef = string;

/** Storage abstraction; the local store is one implementation. */
export interface OriginalResultArchive {
  put(
    entry: ArchivedToolResult,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ArchiveRef>;
  get(ref: ArchiveRef): Promise<ArchivedToolResult | null>;
  delete?(ref: ArchiveRef): Promise<void>;
}

/** Short form for model-visible markers: `sha256:0123456789ab`. */
export function shortRef(ref: ArchiveRef, hexChars = 12): string {
  const separator = ref.indexOf(":");
  if (separator < 0) return ref.slice(0, hexChars);
  const prefix = ref.slice(0, separator + 1);
  return `${prefix}${ref.slice(separator + 1, separator + 1 + hexChars)}`;
}
