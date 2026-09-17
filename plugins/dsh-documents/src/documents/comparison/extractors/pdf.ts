/**
 * PDF extraction (§26 P1, §25).
 *
 * A PDF has no paragraphs to read: it has glyphs at coordinates. The pipeline
 * therefore does what the whole plugin does with PDFs — it asks the configured
 * text-extraction backend (Docling, or MarkItDown when a deployment prefers
 * it) for Markdown — and then runs the Markdown extractor over the answer. That
 * is a deliberate limitation, and the comparison reports it: a PDF pair is
 * rated `medium` when the pages carried a text layer and `low` when OCR was
 * involved, so the model knows how much of the delta to trust before it
 * interprets any of it.
 *
 * Nothing here is a fallback to a weaker comparison: the extraction backend is
 * the same one `document_to_markdown` uses, with the same availability rules,
 * and a deployment without a PDF backend gets `BACKEND_UNAVAILABLE` — not an
 * approximate answer.
 */

import {
  canonicalFromMarkdown,
  MarkdownStructuredExtractor,
} from "./markdown.js";
import type {
  StructuredDocumentExtractor,
  StructuredExtractionInput,
} from "./extractor.js";
import type { CanonicalDocument } from "../canonical/document-ir.js";
import type { DocumentWarning } from "../../types.js";

export interface PdfTextResult {
  readonly markdown: string;
  /** Backend that produced the text, for the manifest. */
  readonly backend: string;
  readonly ocrUsed: boolean;
  readonly pages?: number;
  readonly warnings: readonly DocumentWarning[];
}

/** One retrieval of a PDF's text through the deployment's backends. */
export type PdfTextSource = (input: {
  readonly inputPath: string;
  readonly filename: string;
  readonly signal?: AbortSignal;
}) => Promise<PdfTextResult>;

export class PdfStructuredExtractor implements StructuredDocumentExtractor {
  readonly name = "pdf";

  constructor(private readonly source: PdfTextSource) {}

  supports(filename: string): boolean {
    return /\.pdf$/iu.test(filename);
  }

  async extract(input: StructuredExtractionInput): Promise<CanonicalDocument> {
    const extracted = await this.source({
      inputPath: input.inputPath,
      filename: input.filename,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    return canonicalFromMarkdown(extracted.markdown, {
      maxNodes: input.maxNodes,
      kind: extracted.ocrUsed ? "pdf-ocr" : "pdf-text",
      extractor: extracted.backend,
      ocrUsed: extracted.ocrUsed,
      warnings: extracted.warnings,
    });
  }
}

export { MarkdownStructuredExtractor };
