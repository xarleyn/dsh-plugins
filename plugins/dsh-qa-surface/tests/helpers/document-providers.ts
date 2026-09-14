/**
 * Stub provider set for orchestrator tests.
 *
 * The orchestrator's contract is "hand the right inputs to a renderer,
 * converter or extractor and record what came back", so most tests exercise it
 * against these in-process doubles: they write real fixture containers and
 * record every call, which keeps the assertions about *routing, containment and
 * manifests* fast and deterministic. The real spawn path is covered separately
 * by the provider tests with stub programs.
 */

import { readFile, writeFile } from "node:fs/promises";

import { sha256OfFile } from "../../src/documents/artifacts/store.js";
import { DocumentError } from "../../src/documents/errors.js";
import type { ProviderSet } from "../../src/documents/providers/registry.js";
import type {
  ConvertPdfInput,
  ConvertedDocument,
  DocumentExtractor,
  ExtractInput,
  ExtractedDocument,
  RenderDocxInput,
  RenderPdfInput,
  RenderedArtifact,
} from "../../src/documents/types.js";
import { docxBytes, pdfBytes, pngDataUri } from "./document-fixtures.js";

export interface StubCalls {
  readonly docx: RenderDocxInput[];
  readonly pdf: RenderPdfInput[];
  readonly convert: ConvertPdfInput[];
  readonly extract: ExtractInput[];
}

export interface StubProviderOptions {
  /** Bytes the DOCX renderer writes; defaults to a valid DOCX fixture. */
  readonly docxOutput?: Buffer;
  /** Bytes the PDF path writes; defaults to a valid PDF fixture. */
  readonly pdfOutput?: Buffer;
  /** Failure the DOCX renderer raises instead of writing. */
  readonly docxError?: DocumentError;
  /** Failure the PDF converter raises instead of writing. */
  readonly pdfError?: DocumentError;
  /** Markdown the extractor returns; defaults to text with one inline image. */
  readonly extractedMarkdown?: string;
  /** Failure the extractor raises (as if the backend were unreachable). */
  readonly extractError?: DocumentError;
  /** Extra warnings the extractor reports. */
  readonly extractWarnings?: ExtractedDocument["warnings"];
  readonly extractPages?: number;
  readonly typstPdf?: boolean;
}

export interface StubProviders {
  readonly providers: ProviderSet;
  readonly calls: StubCalls;
}

export function stubProviderSet(
  options: StubProviderOptions = {},
): StubProviders {
  const calls: StubCalls = { docx: [], pdf: [], convert: [], extract: [] };

  const write = async (
    path: string,
    bytes: Buffer,
    provider: string,
  ): Promise<RenderedArtifact> => {
    await writeFile(path, bytes);
    return {
      path,
      size: bytes.length,
      sha256: await sha256OfFile(path),
      backend: { provider, version: "test" },
      warnings: [],
    };
  };

  const docx = {
    name: "pandoc",
    async render(input: RenderDocxInput): Promise<RenderedArtifact> {
      calls.docx.push(input);
      if (options.docxError !== undefined) throw options.docxError;
      const bytes = options.docxOutput ?? docxBytes({ headings: ["Fixture"] });
      return await write(input.outputPath, bytes, "pandoc");
    },
  };

  const converter = {
    name: "libreoffice",
    supports: (source: string, target: string) =>
      source === "docx" && target === "pdf",
    async convert(input: ConvertPdfInput): Promise<ConvertedDocument> {
      calls.convert.push(input);
      if (options.pdfError !== undefined) throw options.pdfError;
      const bytes = options.pdfOutput ?? pdfBytes({ pages: 2 });
      await writeFile(input.outputPath, bytes);
      return {
        path: input.outputPath,
        size: bytes.length,
        sha256: await sha256OfFile(input.outputPath),
        backend: { provider: "libreoffice", version: "test" },
        warnings: [],
      };
    },
  };

  const extractor: DocumentExtractor = {
    name: "docling",
    supports: () => true,
    async extract(input: ExtractInput): Promise<ExtractedDocument> {
      calls.extract.push(input);
      if (options.extractError !== undefined) throw options.extractError;
      return {
        markdown:
          options.extractedMarkdown ??
          [
            "# Заголовок",
            "",
            "Абзац с картинкой.",
            "",
            `![Рисунок](${pngDataUri()})`,
            "",
          ].join("\n"),
        assets: [],
        ...(options.extractPages === undefined
          ? {}
          : { pages: options.extractPages }),
        backend: { provider: "docling", version: "test" },
        warnings: options.extractWarnings ?? [],
      };
    },
  };

  const typstPdf =
    options.typstPdf === true
      ? {
          name: "typst",
          async render(input: RenderPdfInput): Promise<RenderedArtifact> {
            calls.pdf.push(input);
            if (options.pdfError !== undefined) throw options.pdfError;
            return await write(
              input.outputPath,
              options.pdfOutput ?? pdfBytes(),
              "typst",
            );
          },
        }
      : undefined;

  const providers: ProviderSet = {
    docx,
    typstPdf,
    converter,
    docling: extractor,
    doclingHealth: async () => "ok",
    markitdown: undefined,
    markitdownHealth: undefined,
  };
  return { providers, calls };
}

/** Read a produced artifact file back for content assertions. */
export async function readArtifact(filePath: string): Promise<Buffer> {
  return await readFile(filePath);
}
