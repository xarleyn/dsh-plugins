/**
 * The settings schema of the document pipeline: the same shape the Cordis
 * loader and the settings card share, so a value the card writes is a value the
 * runtime resolves.
 *
 * Every section carries `.volatile()`, which on this host is what makes a field
 * editable while the plugin runs: the settings namespace is the profile entry
 * id, a field is a form field iff its schema node is volatile, and the loader
 * then hands each volatile section to this plugin as a stable reference rather
 * than as a plain value. {@link snapshotDocumentsConfig} is the one hop back.
 *
 * Node-free on purpose: this module is bundled into the browser card, so a Node
 * builtin here would break the bundle rather than the test suite.
 * @module schema
 */

import type { Volatile } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { DEFAULT_DOCUMENTS_CONFIG } from "./documents/defaults.js";
import type { DocumentsConfig } from "./documents/config.js";

const DD = DEFAULT_DOCUMENTS_CONFIG;

const nullableString = z.union([z.string(), z.const(null)]);

/**
 * Comparison defaults as the settings namespace spells them: the resolver's
 * `defaultLimit`/`maxLimit` are the page size knobs of `document_diff_read`,
 * and the card edits them under the names a reader expects.
 */
const comparisonDefaults = {
  ...DD.comparison,
  pageSize: DD.comparison.defaultLimit,
  maxPageSize: DD.comparison.maxLimit,
};

const configSchema = z
  .object({
    enabled: z.boolean().default(DD.enabled).volatile(),
    comparison: z
      .object({
        enabled: z.boolean().default(DD.comparison.enabled),
        defaultMode: z
          .union(["default", "contract"] as const)
          .default(DD.comparison.defaultMode),
        detectMoves: z.boolean().default(DD.comparison.detectMoves),
        includeHeaders: z.boolean().default(DD.comparison.includeHeaders),
        includeFooters: z.boolean().default(DD.comparison.includeFooters),
        includeFootnotes: z.boolean().default(DD.comparison.includeFootnotes),
        includeComments: z.boolean().default(DD.comparison.includeComments),
        ignoreWhitespace: z.boolean().default(DD.comparison.ignoreWhitespace),
        ignoreFormatting: z.boolean().default(DD.comparison.ignoreFormatting),
        maxInputBytes: z
          .number()
          .step(1)
          .min(1_024)
          .max(4_294_967_296)
          .default(DD.comparison.maxInputBytes),
        maxNodes: z
          .number()
          .step(1)
          .min(1)
          .max(5_000_000)
          .default(DD.comparison.maxNodes),
        maxChanges: z
          .number()
          .step(1)
          .min(1)
          .max(1_000_000)
          .default(DD.comparison.maxChanges),
        maxUncompressedBytes: z
          .number()
          .step(1)
          .min(1_024)
          .max(8_589_934_592)
          .default(DD.comparison.maxUncompressedBytes),
        timeoutMs: z
          .number()
          .step(1)
          .min(1_000)
          .max(3_600_000)
          .default(DD.comparison.timeoutMs),
        inlineChanges: z
          .number()
          .step(1)
          .min(0)
          .max(1_000)
          .default(DD.comparison.inlineChanges),
        inlineTextCharsPerChange: z
          .number()
          .step(1)
          .min(100)
          .max(1_000_000)
          .default(DD.comparison.inlineTextCharsPerChange),
        pageSize: z
          .number()
          .step(1)
          .min(1)
          .max(1_000)
          .default(DD.comparison.defaultLimit),
        maxPageSize: z
          .number()
          .step(1)
          .min(1)
          .max(5_000)
          .default(DD.comparison.maxLimit),
        retainNormalizedDocuments: z
          .boolean()
          .default(DD.comparison.retainNormalizedDocuments),
      })
      .default(comparisonDefaults)
      .volatile(),
    storage: z
      .object({
        root: nullableString.default(DD.storage.root),
        retainSource: z.boolean().default(DD.storage.retainSource),
        retainInputs: z.boolean().default(DD.storage.retainInputs),
        allowedInputRoots: z
          .array(z.string())
          .default([...DD.storage.allowedInputRoots]),
      })
      .default({
        ...DD.storage,
        allowedInputRoots: [...DD.storage.allowedInputRoots],
      })
      .volatile(),
    cache: z
      .object({
        enabled: z.boolean().default(DD.cache.enabled),
        maxAgeDays: z
          .number()
          .step(1)
          .min(1)
          .max(3_650)
          .default(DD.cache.maxAgeDays),
        maxEntries: z
          .number()
          .step(1)
          .min(1)
          .max(100_000)
          .default(DD.cache.maxEntries),
        maxBytes: z
          .number()
          .step(1)
          .min(1_024)
          .max(1_099_511_627_776)
          .default(DD.cache.maxBytes),
      })
      .default({ ...DD.cache })
      .volatile(),
    templates: z
      .object({
        root: nullableString.default(DD.templates.root),
        default: z.string().default(DD.templates.default),
      })
      .default({ ...DD.templates })
      .volatile(),
    create: z
      .object({
        defaultPdfMode: z
          .union(["auto", "office", "typst"] as const)
          .default(DD.create.defaultPdfMode),
        allowFormats: z
          .array(z.union(["docx", "pdf"] as const))
          .default([...DD.create.allowFormats]),
        allowRawMarkup: z.boolean().default(DD.create.allowRawMarkup),
        toc: z.boolean().default(DD.create.toc),
      })
      .default({
        ...DD.create,
        allowFormats: [...DD.create.allowFormats],
      })
      .volatile(),
    extraction: z
      .object({
        defaultMode: z
          .union(["auto", "fast", "accurate"] as const)
          .default(DD.extraction.defaultMode),
        ocr: z
          .union(["auto", "off", "force"] as const)
          .default(DD.extraction.ocr),
        ocrLanguages: z
          .array(z.string())
          .default([...DD.extraction.ocrLanguages]),
        extractImages: z.boolean().default(DD.extraction.extractImages),
        extractTables: z.boolean().default(DD.extraction.extractTables),
        preservePageMarkers: z
          .boolean()
          .default(DD.extraction.preservePageMarkers),
        allowFallback: z.boolean().default(DD.extraction.allowFallback),
        maxInlineChars: z
          .number()
          .step(1)
          .min(1_000)
          .max(5_000_000)
          .default(DD.extraction.maxInlineChars),
      })
      .default({
        ...DD.extraction,
        ocrLanguages: [...DD.extraction.ocrLanguages],
      })
      .volatile(),
    docling: z
      .object({
        enabled: z.boolean().default(DD.docling.enabled),
        baseUrl: z.string().default(DD.docling.baseUrl),
        timeoutMs: z
          .number()
          .step(1)
          .min(1_000)
          .max(600_000)
          .default(DD.docling.timeoutMs),
      })
      .default({ ...DD.docling })
      .volatile(),
    pandoc: z
      .object({
        executable: z.string().default(DD.pandoc.executable),
        timeoutMs: z
          .number()
          .step(1)
          .min(1_000)
          .max(600_000)
          .default(DD.pandoc.timeoutMs),
      })
      .default({ ...DD.pandoc })
      .volatile(),
    libreoffice: z
      .object({
        executable: z.string().default(DD.libreoffice.executable),
        timeoutMs: z
          .number()
          .step(1)
          .min(1_000)
          .max(600_000)
          .default(DD.libreoffice.timeoutMs),
      })
      .default({ ...DD.libreoffice })
      .volatile(),
    typst: z
      .object({
        enabled: z.boolean().default(DD.typst.enabled),
        executable: z.string().default(DD.typst.executable),
        timeoutMs: z
          .number()
          .step(1)
          .min(1_000)
          .max(600_000)
          .default(DD.typst.timeoutMs),
      })
      .default({ ...DD.typst })
      .volatile(),
    markitdown: z
      .object({
        enabled: z.boolean().default(DD.markitdown.enabled),
        executable: z.string().default(DD.markitdown.executable),
        timeoutMs: z
          .number()
          .step(1)
          .min(1_000)
          .max(600_000)
          .default(DD.markitdown.timeoutMs),
      })
      .default({ ...DD.markitdown })
      .volatile(),
    workers: z
      .object({
        renderConcurrency: z
          .number()
          .step(1)
          .min(1)
          .max(16)
          .default(DD.workers.renderConcurrency),
        extractionConcurrency: z
          .number()
          .step(1)
          .min(1)
          .max(16)
          .default(DD.workers.extractionConcurrency),
        ocrConcurrency: z
          .number()
          .step(1)
          .min(1)
          .max(16)
          .default(DD.workers.ocrConcurrency),
      })
      .default({ ...DD.workers })
      .volatile(),
    retention: z
      .object({
        enabled: z.boolean().default(DD.retention.enabled),
        maxAgeDays: z
          .number()
          .step(1)
          .min(1)
          .max(3_650)
          .default(DD.retention.maxAgeDays),
        cleanupIntervalHours: z
          .number()
          .step(1)
          .min(1)
          .max(168)
          .default(DD.retention.cleanupIntervalHours),
      })
      .default({ ...DD.retention })
      .volatile(),
    limits: z
      .object({
        maxInputBytes: z
          .number()
          .step(1)
          .min(1_024)
          .max(4_294_967_296)
          .default(DD.limits.maxInputBytes),
        maxMarkdownChars: z
          .number()
          .step(1)
          .min(1_000)
          .max(50_000_000)
          .default(DD.limits.maxMarkdownChars),
        maxPages: z
          .number()
          .step(1)
          .min(1)
          .max(100_000)
          .default(DD.limits.maxPages),
        maxExtractedImages: z
          .number()
          .step(1)
          .min(0)
          .max(10_000)
          .default(DD.limits.maxExtractedImages),
        maxAssetBytes: z
          .number()
          .step(1)
          .min(1_024)
          .max(1_073_741_824)
          .default(DD.limits.maxAssetBytes),
        maxResponseBytes: z
          .number()
          .step(1)
          .min(1_024)
          .max(1_073_741_824)
          .default(DD.limits.maxResponseBytes),
        maxExtractedMarkdownBytes: z
          .number()
          .step(1)
          .min(1_024)
          .max(1_073_741_824)
          .default(DD.limits.maxExtractedMarkdownBytes),
        allowedAssetMimeTypes: z
          .array(z.string())
          .default([...DD.limits.allowedAssetMimeTypes]),
      })
      .default({
        ...DD.limits,
        allowedAssetMimeTypes: [...DD.limits.allowedAssetMimeTypes],
      })
      .volatile(),
  })
  .default({
    ...DD,
    comparison: comparisonDefaults,
    storage: {
      ...DD.storage,
      allowedInputRoots: [...DD.storage.allowedInputRoots],
    },
    templates: { ...DD.templates },
    cache: { ...DD.cache },
    create: {
      ...DD.create,
      allowFormats: [...DD.create.allowFormats],
    },
    extraction: {
      ...DD.extraction,
      ocrLanguages: [...DD.extraction.ocrLanguages],
    },
    docling: { ...DD.docling },
    pandoc: { ...DD.pandoc },
    libreoffice: { ...DD.libreoffice },
    typst: { ...DD.typst },
    markitdown: { ...DD.markitdown },
    workers: { ...DD.workers },
    retention: { ...DD.retention },
    limits: {
      ...DD.limits,
      allowedAssetMimeTypes: [...DD.limits.allowedAssetMimeTypes],
    },
  });

/**
 * The `Config` of the plugin entry: every section of {@link DocumentsConfig}
 * held as a live reference, because this schema marks each of them volatile.
 *
 * Derived from the plain shape section by section, so the two cannot drift and
 * the resolver keeps reading plain data.
 */
export interface DocumentsPluginConfig {
  readonly enabled: Volatile<boolean>;
  readonly comparison: Volatile<NonNullable<DocumentsConfig["comparison"]>>;
  readonly storage: Volatile<NonNullable<DocumentsConfig["storage"]>>;
  readonly cache: Volatile<NonNullable<DocumentsConfig["cache"]>>;
  readonly templates: Volatile<NonNullable<DocumentsConfig["templates"]>>;
  readonly create: Volatile<NonNullable<DocumentsConfig["create"]>>;
  readonly extraction: Volatile<NonNullable<DocumentsConfig["extraction"]>>;
  readonly docling: Volatile<NonNullable<DocumentsConfig["docling"]>>;
  readonly pandoc: Volatile<NonNullable<DocumentsConfig["pandoc"]>>;
  readonly libreoffice: Volatile<NonNullable<DocumentsConfig["libreoffice"]>>;
  readonly typst: Volatile<NonNullable<DocumentsConfig["typst"]>>;
  readonly markitdown: Volatile<NonNullable<DocumentsConfig["markitdown"]>>;
  readonly workers: Volatile<NonNullable<DocumentsConfig["workers"]>>;
  readonly retention: Volatile<NonNullable<DocumentsConfig["retention"]>>;
  readonly limits: Volatile<NonNullable<DocumentsConfig["limits"]>>;
}

/**
 * A configuration the plugin accepts: the live references the Cordis loader
 * hands a volatile `Config`, or — for a caller that builds the plugin in
 * process rather than through a profile entry — the plain sections themselves.
 */
export type DocumentsConfigSource = DocumentsPluginConfig | DocumentsConfig;

/** The value one volatile section carries right now. */
function current<T>(section: Volatile<T> | T | undefined): T | undefined {
  if (typeof section === "object" && section !== null && "get" in section) {
    return (section as Volatile<T>).get() as T;
  }
  return section as T | undefined;
}

/**
 * One plain snapshot of the live configuration, for a single operation.
 *
 * A reference is stable while its value is not, so reading it once per
 * operation is what keeps a long `refresh()` from resolving half old and half
 * new values; destructuring the config at startup would freeze it instead.
 */
export function snapshotDocumentsConfig(
  config: DocumentsConfigSource,
): DocumentsConfig {
  return {
    enabled: current(config.enabled),
    comparison: current(config.comparison),
    storage: current(config.storage),
    cache: current(config.cache),
    templates: current(config.templates),
    create: current(config.create),
    extraction: current(config.extraction),
    docling: current(config.docling),
    pandoc: current(config.pandoc),
    libreoffice: current(config.libreoffice),
    typst: current(config.typst),
    markitdown: current(config.markitdown),
    workers: current(config.workers),
    retention: current(config.retention),
    limits: current(config.limits),
  };
}

/**
 * The entry schema. Its input is the plain profile shape an operator writes;
 * what it yields is {@link DocumentsPluginConfig}, because every section is
 * marked volatile and parsing turns each into a live reference.
 */
export const ConfigSchema = configSchema as unknown as z<
  DocumentsConfig,
  DocumentsPluginConfig
>;
