/**
 * Controlled document directives (§36).
 *
 * Markdown stays the canonical source, so the few structures Markdown cannot
 * express — a page break, a callout — are written as fences the orchestrator
 * rewrites into the target backend's own representation before the renderer
 * sees the text:
 *
 * ```md
 * :::pagebreak
 * :::
 *
 * :::note
 * Important information.
 * :::
 * ```
 *
 * Anything else is refused rather than passed through: an unknown `:::`
 * directive would otherwise reach pandoc as literal text, and raw markup
 * (HTML, LaTeX, Typst escapes) is only accepted when a deployment explicitly
 * opts in with `documents.create.allowRawMarkup`.
 */

import { DocumentError } from "../errors.js";
import type { DocumentWarning } from "../types.js";

/** Backends whose directive spelling differs. */
export type DirectiveBackend = "docx" | "typst";

export interface DirectiveOptions {
  readonly backend: DirectiveBackend;
  readonly allowRawMarkup: boolean;
}

export interface DirectiveResult {
  readonly markdown: string;
  readonly warnings: readonly DocumentWarning[];
}

const DIRECTIVE_OPEN = /^[ \t]*:::[ \t]*([A-Za-z][A-Za-z0-9_-]*)[ \t]*$/u;
const DIRECTIVE_CLOSE = /^[ \t]*:::[ \t]*$/u;
const KNOWN_DIRECTIVES = new Set(["pagebreak", "note", "warning", "info"]);

const PAGEBREAK_OPENXML =
  '```{=openxml}\n<w:p><w:r><w:br w:type="page"/></w:r></w:p>\n```';

const RAW_MARKUP_PATTERNS: readonly {
  readonly pattern: RegExp;
  readonly label: string;
}[] = [
  {
    pattern:
      /<\s*(?:script|style|iframe|object|embed|applet|form|link|meta|base)\b/iu,
    label: "HTML element",
  },
  { pattern: /<\?|<!ENTITY/iu, label: "processing instruction" },
  {
    pattern: /\\(?:input|include|write18|directlua|usepackage)\s*[{[]/iu,
    label: "LaTeX command",
  },
  { pattern: /#(?:import|include|read)\s*[( "]/iu, label: "Typst command" },
  { pattern: /\{\{|\{%/u, label: "template placeholder" },
];

function assertNoRawMarkup(markdown: string, allowRawMarkup: boolean): void {
  if (allowRawMarkup) return;
  for (const { pattern, label } of RAW_MARKUP_PATTERNS) {
    if (pattern.test(markdown)) {
      throw new DocumentError(
        "INVALID_INPUT",
        `the content carries raw markup (${label}); raw markup is disabled in this deployment`,
        { details: { kind: label } },
      );
    }
  }
}

function renderPageBreak(backend: DirectiveBackend): string {
  if (backend === "typst") return "#pagebreak()";
  // Pandoc's openxml raw block is understood for DOCX output; for the PDF path
  // the document is rendered through DOCX first, so the same spelling applies.
  return PAGEBREAK_OPENXML;
}

function renderNote(
  kind: string,
  body: string,
  backend: DirectiveBackend,
): string {
  const label =
    kind === "note" ? "Note" : kind === "warning" ? "Warning" : "Info";
  const text = body.trim();
  const header = backend === "typst" ? `*${label}.* ` : `> **${label}.** `;
  if (text === "") return header.trimEnd();
  if (backend === "typst") {
    return header + text.replace(/\n{2,}/gu, "\n\n");
  }
  return header + text.split(/\r?\n/u).join("\n> ");
}

/**
 * Rewrite directives for one backend. Line-oriented on purpose: a fence that
 * appears inside a code block is content, not a directive.
 */
export function applyDirectives(
  markdown: string,
  options: DirectiveOptions,
): DirectiveResult {
  assertNoRawMarkup(markdown, options.allowRawMarkup);
  const lines = markdown.split(/\r?\n/u);
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const fence = /^[ \t]*(`{3,}|~{3,})/u.exec(line);
    if (fence !== null) {
      const marker = fence[1] ?? "```";
      output.push(line);
      index += 1;
      while (index < lines.length) {
        const inner = lines[index] ?? "";
        output.push(inner);
        index += 1;
        if (inner.trimStart().startsWith(marker)) break;
      }
      continue;
    }

    const directive = DIRECTIVE_OPEN.exec(line);
    if (directive === null) {
      output.push(line);
      index += 1;
      continue;
    }

    const rawName = (directive[1] ?? "").toLowerCase();
    const directiveName = rawName === "page-break" ? "pagebreak" : rawName;
    const openedAt = index + 1;
    if (!KNOWN_DIRECTIVES.has(directiveName)) {
      throw new DocumentError(
        "INVALID_INPUT",
        `unsupported document directive ":::${rawName}" (supported: pagebreak, note, warning, info)`,
        { details: { directive: rawName, line: openedAt } },
      );
    }

    index += 1;
    const body: string[] = [];
    let closed = false;
    while (index < lines.length) {
      const inner = lines[index] ?? "";
      if (DIRECTIVE_CLOSE.test(inner)) {
        closed = true;
        index += 1;
        break;
      }
      if (DIRECTIVE_OPEN.test(inner)) {
        throw new DocumentError(
          "INVALID_INPUT",
          `document directive ":::${directiveName}" on line ${openedAt} contains a nested directive`,
          { details: { directive: directiveName, line: openedAt } },
        );
      }
      body.push(inner);
      index += 1;
    }

    if (directiveName === "pagebreak") {
      if (body.some((entry) => entry.trim() !== "")) {
        throw new DocumentError(
          "INVALID_INPUT",
          `":::pagebreak" on line ${openedAt} takes no body`,
          { details: { directive: directiveName, line: openedAt } },
        );
      }
      output.push(renderPageBreak(options.backend));
      continue;
    }

    if (!closed) {
      throw new DocumentError(
        "INVALID_INPUT",
        `document directive ":::${directiveName}" opened on line ${openedAt} is never closed`,
        { details: { directive: directiveName, line: openedAt } },
      );
    }
    output.push(renderNote(directiveName, body.join("\n"), options.backend));
  }

  return { markdown: output.join("\n"), warnings: [] };
}
