/**
 * HTML preview: title extraction plus text-only beginning/ending (SPEC §18).
 * Inline scripts, styles, comments and markup never reach the preview; the
 * raw source stays in the CAS object.
 */

import { formatOmitted } from "./text.js";
import type { PreviewOptions } from "./options.js";

const TITLE_PATTERN = /<title[^>]*>([\s\S]*?)<\/title>/i;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

export interface HtmlPreview {
  readonly body: string;
}

export function previewHtml(value: string, options: PreviewOptions): HtmlPreview {
  const title = TITLE_PATTERN.exec(value)?.[1]?.trim() ?? "";
  const text = htmlToText(value);
  const half = Math.floor(options.maxChars / 2);
  const head = text.slice(0, half);
  const tail = text.length > half ? text.slice(text.length - half) : "";
  const omittedChars = Math.max(0, text.length - head.length - tail.length);

  const header: string[] = ["HTML document"];
  if (title !== "") header.push(`title: ${title}`);
  const parts: string[] = [header.join("\n")];
  if (head !== "") parts.push(head.trim());
  if (omittedChars > 0) parts.push(`[dsh-cas-results: ${formatOmitted(omittedChars)} characters of markup omitted]`);
  if (tail !== "") parts.push(tail.trim());
  return { body: parts.join("\n\n") };
}

/** Reduce an HTML document to readable text without any external dependency. */
export function htmlToText(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/header|\/footer)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n")
    .trim();
}
