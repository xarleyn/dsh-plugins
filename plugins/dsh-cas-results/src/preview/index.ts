/**
 * Preview dispatcher (SPEC §18): picks the deterministic preview builder for
 * a content class. Binary payloads never get a body — their marker is the
 * whole model-facing representation.
 */

import { previewHtml } from "./html.js";
import { previewLog } from "./log.js";
import { previewText } from "./text.js";
import type { PreviewOptions } from "./options.js";
import type { CasKind } from "../cas/types.js";

export { previewText } from "./text.js";
export { previewLog } from "./log.js";
export { previewHtml } from "./html.js";
export type { PreviewOptions } from "./options.js";

export function buildPreviewBody(kind: Exclude<CasKind, "binary">, value: string, options: PreviewOptions): string {
  if (kind === "log") return previewLog(value, options).body;
  if (kind === "html") return previewHtml(value, options).body;
  return previewText(value, options).body;
}
