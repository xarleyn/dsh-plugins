import {
  QA_MAX_FILE_BYTES_MAX,
  QA_MAX_FILE_BYTES_MIN,
  QA_MAX_PENDING_MAX,
  QA_MAX_PENDING_MIN,
  QA_PASTED_TEXT_LINES_MAX,
  QA_PASTED_TEXT_LINES_MIN,
  normalizeTextExtensions,
} from "../attachment-rules.js";
import type { QaSurfaceConfig, ResolvedQaSurfaceConfig } from "../types.js";
import { DEFAULT_QA_SURFACE_CONFIG } from "./defaults.js";
import { assertIntInRange } from "./shared.js";

type AttachmentsSlice = ResolvedQaSurfaceConfig["attachments"];

/** Resolve the attachments domain: intake toggles and byte/line bounds. */
export function resolveAttachments(input: QaSurfaceConfig): AttachmentsSlice {
  const pastedTextLines =
    input.attachments?.pastedTextLines ??
    DEFAULT_QA_SURFACE_CONFIG.attachments.pastedTextLines;
  const maxFileBytes =
    input.attachments?.maxFileBytes ??
    DEFAULT_QA_SURFACE_CONFIG.attachments.maxFileBytes;
  const maxPending =
    input.attachments?.maxPending ??
    DEFAULT_QA_SURFACE_CONFIG.attachments.maxPending;
  assertIntInRange(
    "attachments.pastedTextLines",
    pastedTextLines,
    QA_PASTED_TEXT_LINES_MIN,
    QA_PASTED_TEXT_LINES_MAX,
  );
  assertIntInRange(
    "attachments.maxFileBytes",
    maxFileBytes,
    QA_MAX_FILE_BYTES_MIN,
    QA_MAX_FILE_BYTES_MAX,
  );
  assertIntInRange(
    "attachments.maxPending",
    maxPending,
    QA_MAX_PENDING_MIN,
    QA_MAX_PENDING_MAX,
  );
  return Object.freeze({
    textFiles:
      input.attachments?.textFiles ??
      DEFAULT_QA_SURFACE_CONFIG.attachments.textFiles,
    pastedTextLines,
    maxFileBytes,
    maxPending,
    // An operator names extensions; anything the browser reports as
    // `text/*` still passes the composer's own check, so an empty list is a
    // narrowing, not a lockout.
    extensions: normalizeTextExtensions(
      input.attachments?.extensions ??
        DEFAULT_QA_SURFACE_CONFIG.attachments.extensions,
    ),
  });
}
