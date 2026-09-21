import type { QaAttachmentLimits } from "../../src/client/attachments.js";
import { DEFAULT_QA_ATTACHMENT_EXTENSIONS } from "../../src/attachment-rules.js";

/** The resolved policy of an untouched deployment, for composer tests. */
export const DEFAULT_ATTACHMENT_LIMITS: QaAttachmentLimits = Object.freeze({
  textFiles: true,
  pastedTextLines: 200,
  maxFileBytes: 10_485_760,
  maxPending: 8,
  extensions: DEFAULT_QA_ATTACHMENT_EXTENSIONS,
});
