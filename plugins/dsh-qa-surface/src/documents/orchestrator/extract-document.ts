/**
 * `document_to_markdown` orchestration (§9, §15, §16).
 *
 * The tool returns the extracted Markdown, and the bundle keeps it: the model
 * may only see a truncated view (a 300-page PDF is not a conversation), while
 * the artifact always carries the full text with its assets and manifest.
 */

import path from "node:path";

import { readPdfFacts } from "../inspect/facts.js";
import {
  buildManifest,
  outputRecord,
  writeManifest,
} from "../artifacts/manifest.js";
import { sha256Hex } from "../artifacts/store.js";
import { DocumentError, asDocumentError } from "../errors.js";
import { normalizeExtractedMarkdown } from "../markdown/normalize.js";
import { extractWithFallback, selectExtractor } from "../providers/registry.js";
import { assertCountWithinBudget } from "../security/limits.js";
import { sanitizeFilename } from "../security/paths.js";
import {
  describeUnsupported,
  mediaTypeFor,
  sniffDocument,
  supportedFormatOf,
} from "../security/file-types.js";
import type {
  DocumentToMarkdownInput,
  DocumentToMarkdownResult,
  DocumentWarning,
  ExtractionMode,
  OcrMode,
} from "../types.js";
import {
  ensureArtifactRoot,
  readInputBytes,
  resolveDocumentScope,
  resolveInputPath,
  type DocumentScope,
} from "./scope.js";
import {
  withExtractionSlot,
  withOcrSlot,
  type DocumentRuntimeDeps,
} from "./runtime-deps.js";

export type ExtractionOperation = "document_to_markdown" | "document_convert";

export interface ExtractToMarkdownParams {
  readonly file: string;
  readonly mode?: ExtractionMode;
  readonly ocr?: OcrMode;
  readonly ocrLanguages?: readonly string[];
  readonly extractImages?: boolean;
  readonly extractTables?: boolean;
  readonly preservePageMarkers?: boolean;
  readonly outputFilename?: string;
}

export async function extractToMarkdown(
  deps: DocumentRuntimeDeps,
  params: ExtractToMarkdownParams,
  scopeInput: DocumentScope,
  operation: ExtractionOperation,
): Promise<DocumentToMarkdownResult> {
  const config = deps.config;
  const started = Date.now();
  const scope = await resolveDocumentScope(config, scopeInput);
  const signals = scope.signal === undefined ? {} : { signal: scope.signal };
  await ensureArtifactRoot(scope);
  const inputPath = await resolveInputPath(config, scope, params.file, "file");
  const bytes = await readInputBytes(inputPath, config, "file");
  const sniffed = sniffDocument(bytes, inputPath);
  const sourceFormat = supportedFormatOf(sniffed);
  if (sourceFormat === undefined) {
    throw new DocumentError(
      sniffed.format === "docm"
        ? "MACRO_ENABLED_DOCUMENT"
        : "UNSUPPORTED_FORMAT",
      describeUnsupported(sniffed, inputPath),
    );
  }
  if (sourceFormat === "pdf" && readPdfFacts(bytes).encrypted) {
    throw new DocumentError(
      "ENCRYPTED_DOCUMENT",
      "the PDF is encrypted; password-protected documents are not processed",
    );
  }

  const mode = params.mode ?? config.extraction.defaultMode;
  const ocr = params.ocr ?? config.extraction.ocr;
  const ocrLanguages = params.ocrLanguages ?? config.extraction.ocrLanguages;
  const selection = selectExtractor(deps.providers, config, mode, sourceFormat);

  const { artifactId } = await scope.store.create(deps.now().getTime());
  const workDir = await scope.store.createWorkDir(artifactId);
  try {
    if (config.storage.retainInputs) {
      await scope.store.write(
        path.join(artifactId, "input", path.basename(inputPath)),
        bytes,
      );
    }
    const assetsDir = await scope.store.ensureDir(
      path.join(artifactId, "assets"),
    );
    const runExtraction = async (): Promise<
      Awaited<ReturnType<typeof extractWithFallback>>
    > =>
      await extractWithFallback(selection, {
        inputPath,
        workDir,
        assetsDir,
        ocr,
        ocrLanguages,
        extractImages: params.extractImages ?? config.extraction.extractImages,
        extractTables: params.extractTables ?? config.extraction.extractTables,
        preservePageMarkers:
          params.preservePageMarkers ?? config.extraction.preservePageMarkers,
        maxPages: config.limits.maxPages,
        maxImages: config.limits.maxExtractedImages,
        ...signals,
      });
    // OCR is the one stage with its own concurrency slot (§27).
    const { document: extracted, fellBackFrom } =
      ocr === "force"
        ? await withOcrSlot(deps, scope.signal, runExtraction)
        : await withExtractionSlot(deps, scope.signal, runExtraction);

    const warnings: DocumentWarning[] = [...extracted.warnings];
    if (fellBackFrom !== undefined) {
      warnings.push({
        code: "BACKEND_FALLBACK_USED",
        message: `${fellBackFrom} was unreachable; the operation continued with ${extracted.backend.provider}`,
        details: { from: fellBackFrom, to: extracted.backend.provider },
      });
    }
    if (extracted.pages !== undefined) {
      assertCountWithinBudget(
        extracted.pages,
        config.limits.maxPages,
        "the document's pages",
      );
    }

    const normalized = normalizeExtractedMarkdown(extracted.markdown);
    warnings.push(...normalized.warnings);

    const markdownName = sanitizeFilename(
      params.outputFilename,
      "extracted",
      ".md",
    );
    const written = await scope.store.write(
      path.join(artifactId, markdownName),
      normalized.markdown,
    );

    const manifest = buildManifest({
      artifactId,
      operation,
      createdAt: deps.now().toISOString(),
      input: {
        format: sourceFormat,
        sha256: sha256Hex(bytes),
        filename: path.basename(inputPath),
        bytes: bytes.length,
      },
      outputs: [
        outputRecord({
          format: "md",
          path: written.path,
          mediaType: mediaTypeFor("md"),
          size: written.size,
          sha256: written.sha256,
          status: "created",
        }),
      ],
      backends: { extract: extracted.backend },
      warnings,
      scope: {
        ...(scope.sessionId === undefined
          ? {}
          : { sessionId: scope.sessionId }),
        workspace: scope.workspaceRoot,
      },
    });
    const manifestPath = await writeManifest(scope.store, artifactId, manifest);
    await scope.store.removeWorkDir(workDir);

    const inlineLimit = config.extraction.maxInlineChars;
    const inline =
      normalized.markdown.length > inlineLimit
        ? normalized.markdown.slice(0, inlineLimit)
        : normalized.markdown;
    if (inline.length < normalized.markdown.length) {
      warnings.push({
        code: "MARKDOWN_TRUNCATED",
        message: `the extracted Markdown is ${normalized.markdown.length} characters; the response carries the first ${inlineLimit} and the artifact keeps the whole text`,
        details: { chars: normalized.markdown.length, inline: inlineLimit },
      });
    }

    deps.logger.info("documents.extract", {
      artifactId,
      operation,
      format: sourceFormat,
      backend: extracted.backend.provider,
      ocr,
      pages: extracted.pages,
      durationMs: Date.now() - started,
      bytes: bytes.length,
      outBytes: written.size,
      status: "ok",
    });

    return {
      artifactId,
      markdown: inline,
      markdownPath: written.path,
      ...(extracted.assets.length === 0 ? {} : { assets: extracted.assets }),
      ...(extracted.pages === undefined ? {} : { pages: extracted.pages }),
      backend: extracted.backend.provider,
      warnings,
      manifestPath,
    };
  } catch (error) {
    await scope.store.removeWorkDir(workDir);
    const failure = asDocumentError(error, "EXTRACTION_FAILED");
    deps.logger.error("documents.extract.failed", {
      artifactId,
      format: sourceFormat,
      backend: selection.extractor.name,
      durationMs: Date.now() - started,
      code: failure.code,
    });
    throw failure;
  }
}

export async function toMarkdown(
  deps: DocumentRuntimeDeps,
  input: DocumentToMarkdownInput,
  scope: DocumentScope,
): Promise<DocumentToMarkdownResult> {
  return await extractToMarkdown(deps, input, scope, "document_to_markdown");
}
