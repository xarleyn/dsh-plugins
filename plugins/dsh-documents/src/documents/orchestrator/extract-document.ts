/**
 * `document_to_markdown` orchestration (§9, §15, §16).
 *
 * The tool returns the extracted Markdown, and the bundle keeps it: the model
 * may only see a truncated view (a 300-page PDF is not a conversation), while
 * the artifact always carries the full text with its assets and manifest.
 *
 * Extraction is the most expensive provider call in the pipeline, so it is the
 * one the cache helps most: a repeat of the same document with the same options
 * copies the stored Markdown into a fresh bundle instead of running Docling
 * again. What is cached is what the backend produced — the response's inline
 * truncation is recomputed per call, so a hit reports exactly what a run would.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { readPdfFacts } from "../inspect/facts.js";
import {
  buildManifest,
  outputRecord,
  writeManifest,
} from "../artifacts/manifest.js";
import { sha256Hex } from "../artifacts/store.js";
import { ConversionCache } from "../cache/index.js";
import type { MaterializedHit } from "../cache/materialize.js";
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
  DocumentFormat,
  DocumentToMarkdownInput,
  DocumentToMarkdownResult,
  DocumentWarning,
  ExtractionMode,
  OcrMode,
} from "../types.js";
import type { CacheSpec } from "./cache-spec.js";
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
  cacheSpec?: CacheSpec,
): Promise<DocumentToMarkdownResult> {
  const config = deps.config;
  const started = Date.now();
  const scope = await resolveDocumentScope(config, scopeInput);
  const signals = scope.signal === undefined ? {} : { signal: scope.signal };
  await ensureArtifactRoot(scope);
  const inputPath = await resolveInputPath(config, scope, params.file, "file");
  const bytes = await readInputBytes(inputPath, config, "file");
  const inputSha256 = cacheSpec?.inputSha256 ?? sha256Hex(bytes);
  const inputFilename = cacheSpec?.inputFilename ?? path.basename(inputPath);
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
  const extractImages = params.extractImages ?? config.extraction.extractImages;
  const extractTables = params.extractTables ?? config.extraction.extractTables;
  const preservePageMarkers =
    params.preservePageMarkers ?? config.extraction.preservePageMarkers;
  const selection = selectExtractor(deps.providers, config, mode, sourceFormat);

  const { artifactId } = await scope.store.create(deps.now().getTime());
  const markdownName = sanitizeFilename(
    params.outputFilename,
    "extracted",
    ".md",
  );
  const cache = await beginCache(deps, scope.store, {
    sourceFormat,
    targetFormat: "md",
    inputSha256,
    inputFilename,
    mode,
    ocr,
    ocrLanguages,
    extractImages,
    extractTables,
    preservePageMarkers,
    extractor: selection.extractor,
  });

  const cached = await cache?.lookup(artifactId, () => markdownName);
  if (cached !== undefined) {
    return await hitResult(deps, scope, {
      artifactId,
      operation,
      sourceFormat,
      inputSha256,
      inputFilename,
      bytes,
      markdownName,
      hit: cached,
    });
  }

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
        extractImages,
        extractTables,
        preservePageMarkers,
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
        sha256: inputSha256,
        filename: inputFilename,
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

    await cache?.remember({
      outputs: [
        {
          role: "extract",
          artifactId,
          outputName: markdownName,
          format: "md",
          path: written.path,
          mediaType: mediaTypeFor("md"),
          sha256: written.sha256,
        },
      ],
      warnings,
      backends: { extract: extracted.backend },
      extras: {
        pages: extracted.pages,
        assets: extracted.assets,
      },
    });

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

    const inline = inlineMarkdown(
      normalized.markdown,
      config.extraction.maxInlineChars,
    );
    if (inline.length < normalized.markdown.length) {
      warnings.push(
        truncatedWarning(normalized.markdown.length, inline.length),
      );
    }

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

/** Rebuild the result of a cached extraction, warning included. */
async function hitResult(
  deps: DocumentRuntimeDeps,
  scope: Awaited<ReturnType<typeof resolveDocumentScope>>,
  options: {
    readonly artifactId: string;
    readonly operation: ExtractionOperation;
    readonly sourceFormat: DocumentFormat;
    readonly inputSha256: string;
    readonly inputFilename: string;
    readonly bytes: Buffer;
    readonly markdownName: string;
    readonly hit: MaterializedHit;
  },
): Promise<DocumentToMarkdownResult> {
  const markdownPath = options.hit.outputs[0]?.path ?? "";
  const markdown =
    markdownPath === "" ? "" : (await readFile(markdownPath)).toString("utf8");
  const pages = readExtraNumber(options.hit, "pages");
  const assets = readExtraAssets(options.hit);
  const warnings = [...options.hit.warnings];
  const inlineLimit = deps.config.extraction.maxInlineChars;
  const inline = inlineMarkdown(markdown, inlineLimit);
  if (inline.length < markdown.length) {
    warnings.push(truncatedWarning(markdown.length, inline.length));
  }
  const manifest = buildManifest({
    artifactId: options.artifactId,
    operation: options.operation,
    createdAt: deps.now().toISOString(),
    input: {
      format: options.sourceFormat,
      sha256: options.inputSha256,
      filename: options.inputFilename,
      bytes: options.bytes.length,
    },
    outputs: options.hit.outputs.map((output) =>
      outputRecord({
        format: "md",
        path: output.path,
        mediaType: output.mediaType,
        size: output.size,
        sha256: output.sha256,
        status: "created",
      }),
    ),
    backends: Object.fromEntries(
      options.hit.backends.map((backend) => [backend.role, backend]),
    ),
    warnings,
    scope: {
      ...(scope.sessionId === undefined ? {} : { sessionId: scope.sessionId }),
      workspace: scope.workspaceRoot,
    },
    cache: {
      hit: true,
      ...(options.hit.sourceArtifactId === undefined
        ? {}
        : { sourceArtifactId: options.hit.sourceArtifactId }),
    },
  });
  const manifestPath = await writeManifest(
    scope.store,
    options.artifactId,
    manifest,
  );
  return {
    artifactId: options.artifactId,
    markdown: inline,
    markdownPath,
    ...(assets === undefined ? {} : { assets }),
    ...(pages === undefined ? {} : { pages }),
    backend:
      options.hit.backends.find((backend) => backend.role === "extract")
        ?.provider ?? "unknown",
    warnings,
    manifestPath,
  };
}

/** Truncate the response body to the inline budget. */
function inlineMarkdown(markdown: string, limit: number): string {
  return markdown.length > limit ? markdown.slice(0, limit) : markdown;
}

/** The response was cut; the artifact keeps the whole text (§16). */
function truncatedWarning(chars: number, inline: number): DocumentWarning {
  return {
    code: "MARKDOWN_TRUNCATED",
    message: `the extracted Markdown is ${chars} characters; the response carries the first ${inline} and the artifact keeps the whole text`,
    details: { chars, inline },
  };
}

function readExtraNumber(
  hit: MaterializedHit,
  key: string,
): number | undefined {
  const value = readExtra(hit, key);
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readExtraAssets(
  hit: MaterializedHit,
):
  readonly { readonly path: string; readonly mediaType: string }[] | undefined {
  const value = readExtra(hit, "assets");
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value.filter(
    (entry): entry is { path: string; mediaType: string } =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { path?: unknown }).path === "string" &&
      typeof (entry as { mediaType?: unknown }).mediaType === "string",
  );
}

function readExtra(hit: MaterializedHit, key: string): unknown {
  return hit.extras?.[key];
}

async function beginCache(
  deps: DocumentRuntimeDeps,
  store: Awaited<ReturnType<typeof resolveDocumentScope>>["store"],
  request: {
    readonly sourceFormat: DocumentFormat;
    readonly targetFormat: DocumentFormat;
    readonly inputSha256: string;
    readonly inputFilename: string;
    readonly mode: ExtractionMode;
    readonly ocr: OcrMode;
    readonly ocrLanguages: readonly string[];
    readonly extractImages: boolean;
    readonly extractTables: boolean;
    readonly preservePageMarkers: boolean;
    readonly extractor: { readonly name: string };
  },
): Promise<
  Awaited<ReturnType<ConversionCache["beginExtraction"]>> | undefined
> {
  if (!deps.config.cache.enabled) return undefined;
  const cache = new ConversionCache({
    config: deps.config,
    store,
    logger: deps.logger,
    now: deps.now,
  });
  return await cache.beginExtraction({
    sourceFormat: request.sourceFormat,
    targetFormat: request.targetFormat,
    inputSha256: request.inputSha256,
    inputFilename: request.inputFilename,
    mode: request.mode,
    ocr: request.ocr,
    ocrLanguages: request.ocrLanguages,
    extractImages: request.extractImages,
    extractTables: request.extractTables,
    preservePageMarkers: request.preservePageMarkers,
    providers: [
      {
        role: "extract",
        name: request.extractor.name,
        instance: request.extractor,
      },
    ],
  });
}
