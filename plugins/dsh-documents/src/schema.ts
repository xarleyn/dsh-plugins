/**
 * The settings schema of the document pipeline: the same shape the Cordis
 * loader and the settings card share, so a value the card writes is a value the
 * runtime resolves.
 *
 * Node-free on purpose: this module is bundled into the browser card, so a Node
 * builtin here would break the bundle rather than the test suite.
 * @module schema
 */

import z from "@deepseek-ai/schemastery";
import { DEFAULT_DOCUMENTS_CONFIG } from "./documents/defaults.js";
import type { DocumentsConfig } from "./documents/config.js";

const DD = DEFAULT_DOCUMENTS_CONFIG;

const nullableString = z.union([z.string(), z.const(null)]);

const configSchema = z
  .object({
    enabled: z.boolean().default(DD.enabled),
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
      }),
    templates: z
      .object({
        root: nullableString.default(DD.templates.root),
        default: z.string().default(DD.templates.default),
      })
      .default({ ...DD.templates }),
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
      }),
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
      }),
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
      .default({ ...DD.docling }),
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
      .default({ ...DD.pandoc }),
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
      .default({ ...DD.libreoffice }),
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
      .default({ ...DD.typst }),
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
      .default({ ...DD.markitdown }),
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
      .default({ ...DD.workers }),
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
      .default({ ...DD.retention }),
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
      }),
  })
  .default({
    ...DD,
    storage: {
      ...DD.storage,
      allowedInputRoots: [...DD.storage.allowedInputRoots],
    },
    templates: { ...DD.templates },
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

export const ConfigSchema = configSchema as unknown as z<DocumentsConfig>;
