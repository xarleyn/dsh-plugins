/**
 * The document subsystem (§38) of the `@yadsh/dsh-documents` plugin.
 *
 * Markdown is the canonical source for everything the agent creates, the
 * backends that turn it into DOCX/PDF (or read it back out of them) live
 * behind the provider interfaces in `providers/`, and the four semantic tools
 * in `tools/` are the only surface the model ever sees. Everything else —
 * artifact bundles, manifests, template resolution, path containment, limits —
 * exists to make those four tools predictable.
 *
 * The public entry point is {@link installDocumentSubsystem}.
 */

export {
  DOCUMENT_ERROR_CODES,
  DocumentError,
  asDocumentError,
  sanitizeBackendOutput,
  type DocumentErrorCode,
  type DocumentErrorFields,
} from "./errors.js";
export {
  DEFAULT_DOCUMENTS_CONFIG,
  applyDocumentsEnvOverrides,
  resolveDocumentsConfig,
  retentionIntervalMs,
  type DocumentsConfig,
  type ResolvedDocumentsConfig,
} from "./config.js";
export type * from "./types.js";
export {
  createDocumentRuntime,
  DocumentRuntime,
  type DocumentRuntimeOptions,
} from "./runtime.js";
export {
  createDocumentTools,
  documentToolNames,
  registerDocumentTools,
  DOCUMENT_COMPARISON_TOOL_NAMES,
  DOCUMENT_TOOL_NAMES,
  DOCUMENT_COMPARE_TOOL,
  DOCUMENT_CONVERT_TOOL,
  DOCUMENT_CREATE_TOOL,
  DOCUMENT_DIFF_READ_TOOL,
  DOCUMENT_FROM_URL_TOOL,
  DOCUMENT_INSPECT_TOOL,
  DOCUMENT_TO_MARKDOWN_TOOL,
  type DocumentToolRegistry,
} from "./tools/index.js";
export {
  CHANGE_KINDS,
  CHANGE_SIGNALS,
  SIGNAL_ALIASES,
  type ChangeKind,
  type ChangeLocation,
  type ChangeSignal,
  type ComparedSide,
  type ComparisonMode,
  type ComparisonOptions,
  type ComparisonPreviewEntry,
  type ComparisonQuality,
  type ComparisonScope,
  type ComparisonSummary,
  type DiffSpan,
  type DocumentChange,
  type DocumentCompareInput,
  type DocumentCompareResult,
  type DocumentDiffReadInput,
  type DocumentDiffReadResult,
  type DocumentReference,
} from "./comparison/types.js";
export {
  assessQuality,
  compareDocuments,
  filterDocument,
  resolveComparisonOptions,
  selectedParts,
  summarize,
} from "./comparison/compare.js";
export {
  DIFF_ENGINE,
  serializeChange,
  writeComparisonArtifact,
} from "./comparison/artifact/writer.js";
export {
  parseChange,
  readComparisonChanges,
} from "./comparison/artifact/reader.js";
export {
  buildComparisonPreview,
  locationLabel,
  renderComparisonReport,
} from "./comparison/report.js";
export {
  buildCanonicalDocument,
  comparisonKeyOf,
  DOCUMENT_PART_ORDER,
  EXTRACTION_LEVEL_OF,
  nodesOfPart,
  serializeCanonicalDocument,
  type CanonicalDocument,
  type CanonicalExtractionKind,
  type CanonicalNode,
  type CanonicalTableCell,
  type CanonicalTableRow,
  type DocumentNodeType,
  type DocumentPart,
  type NodeRevision,
  type NodeSource,
} from "./comparison/canonical/document-ir.js";
export { tokenize, type TextToken } from "./comparison/canonical/tokenizer.js";
export {
  collapseWhitespace,
  normalizeForComparison,
} from "./comparison/canonical/normalize.js";
export { alignSequences } from "./comparison/alignment/block-align.js";
export { diffText, diffTokens } from "./comparison/diff/token-diff.js";
export { detectMoves } from "./comparison/diff/move-detection.js";
export { diffDocuments } from "./comparison/diff/block-diff.js";
export { detectSignals } from "./comparison/signals/index.js";
export { DocxStructuredExtractor } from "./comparison/extractors/docx.js";
export {
  MarkdownStructuredExtractor,
  PlainTextStructuredExtractor,
} from "./comparison/extractors/markdown.js";
export {
  PdfStructuredExtractor,
  type PdfTextSource,
} from "./comparison/extractors/pdf.js";
export { parseXml, XmlParseError } from "./comparison/ooxml/xml.js";
export {
  createComparisonId,
  isComparisonId,
  isDocumentArtifactId,
} from "./artifacts/ids.js";
export {
  createProviders,
  type ProviderSeams,
  type ProviderSet,
} from "./providers/registry.js";
export { documentCapabilities, documentHealth } from "./capabilities.js";
export { ArtifactStore, sha256Hex, sha256OfFile } from "./artifacts/store.js";
export {
  CACHE_DIRECTORY,
  CACHE_ENTRY_VERSION,
  CacheStore,
  ConversionCache,
  cacheKey,
  canonicalJson,
  conversionCacheKey,
  extractionCacheKey,
  pipelineFingerprint,
  probeProviderVersion,
  type CacheHandle,
  type CacheProviderRef,
  type CachePruneReport,
  type ConversionRequest,
  type ConversionCacheOptions,
  type DocumentCacheEntry,
  type DocumentCacheOperation,
  type DocumentCacheOutput,
  type DocumentCacheProvider,
  type ExtractionRequest,
  type StoreOutputSpec,
} from "./cache/index.js";
export type { DocumentCacheRecord } from "./types.js";
export { createArtifactId, createUlid, isArtifactId } from "./artifacts/ids.js";
export { fromUrl, normalizeSourceUrl } from "./orchestrator/fetch-document.js";
export {
  MANIFEST_FILE,
  MANIFEST_SCHEMA_VERSION,
  readManifest,
  writeManifest,
} from "./artifacts/manifest.js";
export {
  BUILTIN_TEMPLATE_NAME,
  TEMPLATE_MANIFEST_FILE,
  loadTemplateRegistry,
  templateNames,
  type DocumentTemplate,
  type TemplateRegistry,
} from "./templates/registry.js";
export {
  resolveTemplate,
  type ResolvedTemplate,
} from "./templates/resolver.js";
export { CONVERSION_ROUTES } from "./orchestrator/convert-document.js";
export {
  defaultArtifactRoot,
  resolveDocumentScope,
  type DocumentScope,
  type ResolvedDocumentScope,
} from "./orchestrator/scope.js";
export {
  silentDocumentLogger,
  type DocumentFetchSource,
  type DocumentLogger,
} from "./orchestrator/runtime-deps.js";
export {
  assertInsideRoot,
  canonicalizeForContainment,
  isInsideRoot,
  resolveInsideRoot,
  sanitizeFilename,
} from "./security/paths.js";
export {
  DEFAULT_ASSET_MIME_TYPES,
  detectFormatByExtension,
  describeUnsupported,
  sniffDocument,
  supportedFormatOf,
  type SniffedDocument,
} from "./security/file-types.js";
export { applyDirectives } from "./markdown/directives.js";
export { normalizeExtractedMarkdown } from "./markdown/normalize.js";
export { parseFrontMatter } from "./markdown/frontmatter.js";
export {
  readPdfFacts,
  readDocxFacts,
  readDocxMetadata,
} from "./inspect/facts.js";
export {
  readZipEntries,
  readZipEntry,
  readZipEntryByName,
} from "./inspect/zip.js";

import type { Context } from "@deepseek-ai/cordis";

import {
  resolveDocumentsConfig,
  retentionIntervalMs,
  type DocumentsConfig,
} from "./config.js";
import type { DocumentLogger } from "./orchestrator/runtime-deps.js";
import type { DocumentFetchSource } from "./orchestrator/runtime-deps.js";
import type { ProviderSeams } from "./providers/registry.js";
import { DocumentRuntime } from "./runtime.js";
import {
  documentToolNames,
  registerDocumentTools,
  DOCUMENT_TOOL_NAMES,
  type DocumentToolRegistry,
} from "./tools/index.js";

export interface InstallDocumentSubsystemOptions {
  readonly config: DocumentsConfig;
  readonly logger: DocumentLogger;
  /** The host tool registry (`ctx.tools`). */
  readonly register: DocumentToolRegistry["register"];
  readonly seams?: ProviderSeams;
  /**
   * Retrieval for `document_from_url`, resolving the web provider at call time.
   * Omitted when the deployment has no web provider; that tool then answers
   * BACKEND_UNAVAILABLE instead of pretending the source is unreachable.
   */
  readonly fetchSource?: DocumentFetchSource;
  /** Environment overrides are applied by the caller, which owns the process. */
  readonly now?: () => Date;
}

export interface DocumentSubsystem {
  readonly runtime: DocumentRuntime;
  readonly toolNames: readonly string[];
  dispose(): void;
}

/**
 * Wire the subsystem into a host context: build the runtime, register the four
 * tools, and schedule the retention sweep when a storage root is pinned.
 *
 * `enabled: false` is answered with `undefined` — the caller then leaves both
 * the tools and the timer absent instead of registering inert definitions.
 */
export function installDocumentSubsystem(
  ctx: Context,
  options: InstallDocumentSubsystemOptions,
): DocumentSubsystem | undefined {
  const config = resolveDocumentsConfig(options.config);
  if (!config.enabled) return undefined;

  const runtime = new DocumentRuntime({
    config,
    logger: options.logger,
    ...(options.seams === undefined ? {} : { seams: options.seams }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.fetchSource === undefined
      ? {}
      : { fetchSource: options.fetchSource }),
  });
  const disposeTools = registerDocumentTools(
    { register: options.register },
    { runtime },
  );

  if (config.retention.enabled && config.storage.root !== null) {
    const timer = setInterval(() => {
      void runtime.cleanup().catch((error: unknown) => {
        options.logger.warn("documents.retention.failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      });
    }, retentionIntervalMs(config));
    timer.unref?.();
    ctx.effect(
      () => () => clearInterval(timer),
      "dsh-documents.documents-retention",
    );
  }

  options.logger.info("documents.installed", {
    tools: DOCUMENT_TOOL_NAMES,
    storageRoot: config.storage.root,
    templatesDefault: config.templates.default,
    docling: config.docling.enabled ? config.docling.baseUrl : "disabled",
  });

  return {
    runtime,
    toolNames: documentToolNames(config),
    dispose: () => {
      disposeTools();
    },
  };
}
