/**
 * Configuration of the document subsystem (§20).
 *
 * The subsystem is part of the `documents` namespace, so this resolver
 * follows the same shape as the other domains: it normalizes, validates and
 * freezes, and the schema in `src/config.ts` takes every default from
 * {@link DEFAULT_DOCUMENTS_CONFIG} so an untouched deployment sends the
 * resolver nothing at all.
 *
 * Environment overrides are applied in `applyDocumentsEnvOverrides`, on the
 * way into the plugin, and only for the documented variables — a deployment
 * that injects secrets into the process environment does not thereby get to
 * reconfigure the pipeline.
 */

import {
  DEFAULT_DOCUMENTS_CONFIG,
  type DocumentsConfig,
  type ResolvedDocumentsConfig,
} from "./defaults.js";
import { DocumentError } from "./errors.js";
import type { CreateFormat } from "./types.js";

export {
  DEFAULT_DOCUMENTS_CONFIG,
  type QaDocumentsCommandConfig,
  type QaDocumentsComparisonConfig,
  type ResolvedComparisonConfig,
  type DocumentsConfig,
  type QaDocumentsCreateConfig,
  type QaDocumentsEndpointConfig,
  type QaDocumentsExtractionConfig,
  type QaDocumentsLimitsConfig,
  type QaDocumentsRetentionConfig,
  type QaDocumentsStorageConfig,
  type QaDocumentsTemplatesConfig,
  type QaDocumentsWorkersConfig,
  type ResolvedDocumentsConfig,
} from "./defaults.js";

const MS_PER_MINUTE = 60_000;

/**
 * Absolute-path test for the configuration surface.
 *
 * A hand-rolled check rather than `node:path.isAbsolute`: the schema that reads
 * these defaults is bundled into the browser settings page, and the page cannot
 * load a Node builtin. Only absolute paths are accepted, so there is nothing to
 * resolve here — canonicalization happens host-side, when the path is used.
 */
function isAbsolutePath(value: string): boolean {
  return (
    /^[A-Za-z]:[\\/]/u.test(value) ||
    value.startsWith("/") ||
    value.startsWith("\\\\")
  );
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readInteger(
  value: unknown,
  fallback: number,
  bounds: { readonly min: number; readonly max: number },
  label: string,
): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DocumentError("INVALID_INPUT", `${label} must be a number`);
  }
  const rounded = Math.round(value);
  if (rounded < bounds.min || rounded > bounds.max) {
    throw new DocumentError(
      "INVALID_INPUT",
      `${label} must be between ${bounds.min} and ${bounds.max}`,
      { details: { label, value } },
    );
  }
  return rounded;
}

function readString(value: unknown, fallback: string, label: string): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") {
    throw new DocumentError("INVALID_INPUT", `${label} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed === "" ? fallback : trimmed;
}

function readNullableAbsolutePath(
  value: unknown,
  label: string,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new DocumentError("INVALID_INPUT", `${label} must be a path`);
  }
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!isAbsolutePath(trimmed)) {
    throw new DocumentError(
      "INVALID_INPUT",
      `${label} must be an absolute path (relative and traversal forms are refused)`,
      { details: { label } },
    );
  }
  return trimmed;
}

function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  label: string,
): T {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new DocumentError(
      "INVALID_INPUT",
      `${label} must be one of: ${allowed.join(", ")}`,
      { details: { label } },
    );
  }
  return value as T;
}

function readStringList(value: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const entries = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  return [...new Set(entries)];
}

function readAbsolutePathList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new DocumentError(
        "INVALID_INPUT",
        `${label} entries must be paths`,
      );
    }
    const entryPath = entry.trim();
    if (!isAbsolutePath(entryPath)) {
      throw new DocumentError(
        "INVALID_INPUT",
        `${label} entries must be absolute paths`,
      );
    }
    return entryPath;
  });
}

function assertHttpUrl(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new DocumentError("INVALID_INPUT", `${label} must be an http(s) URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new DocumentError("INVALID_INPUT", `${label} must be an http(s) URL`);
  }
  return value;
}

/** Materialize and validate the document configuration. */
export function resolveDocumentsConfig(
  input: DocumentsConfig = {},
): ResolvedDocumentsConfig {
  const D = DEFAULT_DOCUMENTS_CONFIG;
  const storage = input.storage ?? {};
  const templates = input.templates ?? {};
  const create = input.create ?? {};
  const extraction = input.extraction ?? {};
  const docling = input.docling ?? {};
  const pandoc = input.pandoc ?? {};
  const libreoffice = input.libreoffice ?? {};
  const typst = input.typst ?? {};
  const markitdown = input.markitdown ?? {};
  const workers = input.workers ?? {};
  const retention = input.retention ?? {};
  const limits = input.limits ?? {};
  const comparison = input.comparison ?? {};

  const allowFormats = readStringList(
    create.allowFormats,
    D.create.allowFormats,
  ).filter(
    (entry): entry is CreateFormat => entry === "docx" || entry === "pdf",
  );
  if (allowFormats.length === 0) {
    throw new DocumentError(
      "INVALID_INPUT",
      "documents.create.allowFormats must list at least one of: docx, pdf",
    );
  }

  return Object.freeze({
    enabled: readBoolean(input.enabled, D.enabled),
    comparison: Object.freeze({
      enabled: readBoolean(comparison.enabled, D.comparison.enabled),
      defaultMode: readEnum(
        comparison.defaultMode,
        ["default", "contract"] as const,
        D.comparison.defaultMode,
        "documents.comparison.defaultMode",
      ),
      detectMoves: readBoolean(
        comparison.detectMoves,
        D.comparison.detectMoves,
      ),
      includeHeaders: readBoolean(
        comparison.includeHeaders,
        D.comparison.includeHeaders,
      ),
      includeFooters: readBoolean(
        comparison.includeFooters,
        D.comparison.includeFooters,
      ),
      includeFootnotes: readBoolean(
        comparison.includeFootnotes,
        D.comparison.includeFootnotes,
      ),
      includeComments: readBoolean(
        comparison.includeComments,
        D.comparison.includeComments,
      ),
      ignoreWhitespace: readBoolean(
        comparison.ignoreWhitespace,
        D.comparison.ignoreWhitespace,
      ),
      ignoreFormatting: readBoolean(
        comparison.ignoreFormatting,
        D.comparison.ignoreFormatting,
      ),
      maxInputBytes: readInteger(
        comparison.maxInputBytes,
        D.comparison.maxInputBytes,
        { min: 1_024, max: 4_294_967_296 },
        "documents.comparison.maxInputBytes",
      ),
      maxNodes: readInteger(
        comparison.maxNodes,
        D.comparison.maxNodes,
        { min: 1, max: 5_000_000 },
        "documents.comparison.maxNodes",
      ),
      maxChanges: readInteger(
        comparison.maxChanges,
        D.comparison.maxChanges,
        { min: 1, max: 1_000_000 },
        "documents.comparison.maxChanges",
      ),
      maxUncompressedBytes: readInteger(
        comparison.maxUncompressedBytes,
        D.comparison.maxUncompressedBytes,
        { min: 1_024, max: 8_589_934_592 },
        "documents.comparison.maxUncompressedBytes",
      ),
      timeoutMs: readInteger(
        comparison.timeoutMs,
        D.comparison.timeoutMs,
        { min: 1_000, max: 3_600_000 },
        "documents.comparison.timeoutMs",
      ),
      inlineChanges: readInteger(
        comparison.inlineChanges,
        D.comparison.inlineChanges,
        { min: 0, max: 1_000 },
        "documents.comparison.inlineChanges",
      ),
      inlineTextCharsPerChange: readInteger(
        comparison.inlineTextCharsPerChange,
        D.comparison.inlineTextCharsPerChange,
        { min: 100, max: 1_000_000 },
        "documents.comparison.inlineTextCharsPerChange",
      ),
      defaultLimit: readInteger(
        comparison.pageSize,
        D.comparison.defaultLimit,
        { min: 1, max: 1_000 },
        "documents.comparison.pageSize",
      ),
      maxLimit: readInteger(
        comparison.maxPageSize,
        D.comparison.maxLimit,
        { min: 1, max: 5_000 },
        "documents.comparison.maxPageSize",
      ),
      retainNormalizedDocuments: readBoolean(
        comparison.retainNormalizedDocuments,
        D.comparison.retainNormalizedDocuments,
      ),
    }),
    storage: Object.freeze({
      root: readNullableAbsolutePath(storage.root, "documents.storage.root"),
      retainSource: readBoolean(storage.retainSource, D.storage.retainSource),
      retainInputs: readBoolean(storage.retainInputs, D.storage.retainInputs),
      allowedInputRoots: Object.freeze(
        readAbsolutePathList(
          storage.allowedInputRoots,
          "documents.storage.allowedInputRoots",
        ),
      ),
    }),
    templates: Object.freeze({
      root: readNullableAbsolutePath(
        templates.root,
        "documents.templates.root",
      ),
      default: readString(
        templates.default,
        D.templates.default,
        "documents.templates.default",
      ),
    }),
    create: Object.freeze({
      defaultPdfMode: readEnum(
        create.defaultPdfMode,
        ["auto", "office", "typst"] as const,
        D.create.defaultPdfMode,
        "documents.create.defaultPdfMode",
      ),
      allowFormats: Object.freeze(allowFormats),
      allowRawMarkup: readBoolean(
        create.allowRawMarkup,
        D.create.allowRawMarkup,
      ),
      toc: readBoolean(create.toc, D.create.toc),
    }),
    extraction: Object.freeze({
      defaultMode: readEnum(
        extraction.defaultMode,
        ["auto", "fast", "accurate"] as const,
        D.extraction.defaultMode,
        "documents.extraction.defaultMode",
      ),
      ocr: readEnum(
        extraction.ocr,
        ["auto", "off", "force"] as const,
        D.extraction.ocr,
        "documents.extraction.ocr",
      ),
      ocrLanguages: Object.freeze(
        readStringList(extraction.ocrLanguages, D.extraction.ocrLanguages),
      ),
      extractImages: readBoolean(
        extraction.extractImages,
        D.extraction.extractImages,
      ),
      extractTables: readBoolean(
        extraction.extractTables,
        D.extraction.extractTables,
      ),
      preservePageMarkers: readBoolean(
        extraction.preservePageMarkers,
        D.extraction.preservePageMarkers,
      ),
      allowFallback: readBoolean(
        extraction.allowFallback,
        D.extraction.allowFallback,
      ),
      maxInlineChars: readInteger(
        extraction.maxInlineChars,
        D.extraction.maxInlineChars,
        { min: 1_000, max: 5_000_000 },
        "documents.extraction.maxInlineChars",
      ),
    }),
    docling: Object.freeze({
      enabled: readBoolean(docling.enabled, D.docling.enabled),
      baseUrl: assertHttpUrl(
        readString(
          docling.baseUrl,
          D.docling.baseUrl,
          "documents.docling.baseUrl",
        ).replace(/\/+$/u, ""),
        "documents.docling.baseUrl",
      ),
      timeoutMs: readInteger(
        docling.timeoutMs,
        D.docling.timeoutMs,
        { min: 1_000, max: 600_000 },
        "documents.docling.timeoutMs",
      ),
    }),
    pandoc: Object.freeze({
      executable: readString(
        pandoc.executable,
        D.pandoc.executable,
        "documents.pandoc.executable",
      ),
      timeoutMs: readInteger(
        pandoc.timeoutMs,
        D.pandoc.timeoutMs,
        { min: 1_000, max: 600_000 },
        "documents.pandoc.timeoutMs",
      ),
    }),
    libreoffice: Object.freeze({
      executable: readString(
        libreoffice.executable,
        D.libreoffice.executable,
        "documents.libreoffice.executable",
      ),
      timeoutMs: readInteger(
        libreoffice.timeoutMs,
        D.libreoffice.timeoutMs,
        { min: 1_000, max: 600_000 },
        "documents.libreoffice.timeoutMs",
      ),
    }),
    typst: Object.freeze({
      enabled: readBoolean(typst.enabled, D.typst.enabled),
      executable: readString(
        typst.executable,
        D.typst.executable,
        "documents.typst.executable",
      ),
      timeoutMs: readInteger(
        typst.timeoutMs,
        D.typst.timeoutMs,
        { min: 1_000, max: 600_000 },
        "documents.typst.timeoutMs",
      ),
    }),
    markitdown: Object.freeze({
      enabled: readBoolean(markitdown.enabled, D.markitdown.enabled),
      executable: readString(
        markitdown.executable,
        D.markitdown.executable,
        "documents.markitdown.executable",
      ),
      timeoutMs: readInteger(
        markitdown.timeoutMs,
        D.markitdown.timeoutMs,
        { min: 1_000, max: 600_000 },
        "documents.markitdown.timeoutMs",
      ),
    }),
    workers: Object.freeze({
      renderConcurrency: readInteger(
        workers.renderConcurrency,
        D.workers.renderConcurrency,
        { min: 1, max: 16 },
        "documents.workers.renderConcurrency",
      ),
      extractionConcurrency: readInteger(
        workers.extractionConcurrency,
        D.workers.extractionConcurrency,
        { min: 1, max: 16 },
        "documents.workers.extractionConcurrency",
      ),
      ocrConcurrency: readInteger(
        workers.ocrConcurrency,
        D.workers.ocrConcurrency,
        { min: 1, max: 16 },
        "documents.workers.ocrConcurrency",
      ),
    }),
    retention: Object.freeze({
      enabled: readBoolean(retention.enabled, D.retention.enabled),
      maxAgeDays: readInteger(
        retention.maxAgeDays,
        D.retention.maxAgeDays,
        { min: 1, max: 3_650 },
        "documents.retention.maxAgeDays",
      ),
      cleanupIntervalHours: readInteger(
        retention.cleanupIntervalHours,
        D.retention.cleanupIntervalHours,
        { min: 1, max: 168 },
        "documents.retention.cleanupIntervalHours",
      ),
    }),
    limits: Object.freeze({
      maxInputBytes: readInteger(
        limits.maxInputBytes,
        D.limits.maxInputBytes,
        { min: 1_024, max: 4_294_967_296 },
        "documents.limits.maxInputBytes",
      ),
      maxMarkdownChars: readInteger(
        limits.maxMarkdownChars,
        D.limits.maxMarkdownChars,
        { min: 1_000, max: 50_000_000 },
        "documents.limits.maxMarkdownChars",
      ),
      maxPages: readInteger(
        limits.maxPages,
        D.limits.maxPages,
        { min: 1, max: 100_000 },
        "documents.limits.maxPages",
      ),
      maxExtractedImages: readInteger(
        limits.maxExtractedImages,
        D.limits.maxExtractedImages,
        { min: 0, max: 10_000 },
        "documents.limits.maxExtractedImages",
      ),
      maxAssetBytes: readInteger(
        limits.maxAssetBytes,
        D.limits.maxAssetBytes,
        { min: 1_024, max: 1_073_741_824 },
        "documents.limits.maxAssetBytes",
      ),
      maxResponseBytes: readInteger(
        limits.maxResponseBytes,
        D.limits.maxResponseBytes,
        { min: 1_024, max: 1_073_741_824 },
        "documents.limits.maxResponseBytes",
      ),
      maxExtractedMarkdownBytes: readInteger(
        limits.maxExtractedMarkdownBytes,
        D.limits.maxExtractedMarkdownBytes,
        { min: 1_024, max: 1_073_741_824 },
        "documents.limits.maxExtractedMarkdownBytes",
      ),
      allowedAssetMimeTypes: Object.freeze(
        readStringList(
          limits.allowedAssetMimeTypes,
          D.limits.allowedAssetMimeTypes,
        ).map((entry) => entry.toLowerCase()),
      ),
    }),
  });
}

/** Parse a boolean env value; unknown text leaves the configured value. */
function envBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function envInteger(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Apply the documented environment overrides (§20). Kept out of
 * {@link resolveDocumentsConfig} so the resolver stays a pure function of its
 * input — configuration tests never depend on the ambient environment.
 */
export function applyDocumentsEnvOverrides(
  config: DocumentsConfig,
  env: NodeJS.ProcessEnv,
): DocumentsConfig {
  const value = (key: string): string | undefined => {
    const raw = env[key];
    return raw === undefined || raw.trim() === "" ? undefined : raw.trim();
  };
  const storageRoot = value("DSH_DOCUMENTS_STORAGE_ROOT");
  const templatesRoot = value("DSH_DOCUMENTS_TEMPLATES_ROOT");
  const doclingBaseUrl = value("DSH_DOCUMENTS_DOCLING_BASE_URL");
  const doclingTimeout = value("DSH_DOCUMENTS_DOCLING_TIMEOUT_MS");
  const pandocExecutable = value("DSH_DOCUMENTS_PANDOC_EXECUTABLE");
  const libreofficeExecutable = value("DSH_DOCUMENTS_LIBREOFFICE_EXECUTABLE");
  const markitdownExecutable = value("DSH_DOCUMENTS_MARKITDOWN_EXECUTABLE");
  const ocrLanguages = value("DSH_DOCUMENTS_OCR_LANGUAGES");
  const maxInputBytes = value("DSH_DOCUMENTS_MAX_INPUT_BYTES");
  return {
    ...config,
    enabled: envBoolean(value("DSH_DOCUMENTS_ENABLED"), config.enabled ?? true),
    storage: {
      ...config.storage,
      ...(storageRoot === undefined ? {} : { root: storageRoot }),
    },
    templates: {
      ...config.templates,
      ...(templatesRoot === undefined ? {} : { root: templatesRoot }),
    },
    docling: {
      ...config.docling,
      ...(doclingBaseUrl === undefined ? {} : { baseUrl: doclingBaseUrl }),
      ...(doclingTimeout === undefined
        ? {}
        : {
            timeoutMs: envInteger(
              doclingTimeout,
              config.docling?.timeoutMs ?? 0,
            ),
          }),
    },
    pandoc: {
      ...config.pandoc,
      ...(pandocExecutable === undefined
        ? {}
        : { executable: pandocExecutable }),
    },
    libreoffice: {
      ...config.libreoffice,
      ...(libreofficeExecutable === undefined
        ? {}
        : { executable: libreofficeExecutable }),
    },
    markitdown: {
      ...config.markitdown,
      ...(markitdownExecutable === undefined
        ? {}
        : { executable: markitdownExecutable }),
    },
    extraction: {
      ...config.extraction,
      ...(ocrLanguages === undefined
        ? {}
        : {
            ocrLanguages: ocrLanguages.split(",").map((entry) => entry.trim()),
          }),
    },
    limits: {
      ...config.limits,
      ...(maxInputBytes === undefined
        ? {}
        : {
            maxInputBytes: envInteger(
              maxInputBytes,
              config.limits?.maxInputBytes ?? 0,
            ),
          }),
    },
  };
}

/** Milliseconds a retention sweep interval would wait. */
export function retentionIntervalMs(config: ResolvedDocumentsConfig): number {
  return config.retention.cleanupIntervalHours * 60 * MS_PER_MINUTE;
}
