/**
 * Document configuration: defaults, normalization, rejection and the
 * documented environment overrides.
 */

import { describe, expect, test } from "vitest";

import {
  applyDocumentsEnvOverrides,
  DEFAULT_QA_DOCUMENTS_CONFIG,
  resolveDocumentsConfig,
  retentionIntervalMs,
} from "../src/documents/config.js";
import { DocumentError } from "../src/documents/errors.js";
import { resolveConfig } from "../src/config.js";
import { DEFAULT_QA_SURFACE_CONFIG } from "../src/config-resolvers/defaults.js";

describe("documents config", () => {
  test("resolves the documented defaults", () => {
    const config = resolveDocumentsConfig();
    expect(config.enabled).toBe(true);
    expect(config.storage.root).toBeNull();
    expect(config.storage.retainSource).toBe(true);
    expect(config.storage.retainInputs).toBe(true);
    expect(config.templates).toEqual({ root: null, default: "default" });
    expect(config.create).toEqual({
      defaultPdfMode: "auto",
      allowFormats: ["docx", "pdf"],
      allowRawMarkup: false,
      toc: false,
    });
    expect(config.extraction.defaultMode).toBe("accurate");
    expect(config.extraction.ocr).toBe("auto");
    expect(config.docling).toEqual({
      enabled: true,
      baseUrl: "http://docling:5001",
      timeoutMs: 120_000,
    });
    expect(config.pandoc).toEqual({ executable: "pandoc", timeoutMs: 60_000 });
    expect(config.typst.enabled).toBe(false);
    expect(config.markitdown.enabled).toBe(false);
    expect(config.workers).toEqual({
      renderConcurrency: 2,
      extractionConcurrency: 2,
      ocrConcurrency: 1,
    });
    expect(config.retention).toEqual({
      enabled: true,
      maxAgeDays: 30,
      cleanupIntervalHours: 12,
    });
    expect(config.limits.maxInputBytes).toBe(52_428_800);
    expect(config.limits.maxExtractedImages).toBe(500);
    expect(config.limits.allowedAssetMimeTypes).toContain("image/png");
  });

  test("the QA surface config carries the same resolved document defaults", () => {
    expect(resolveConfig().documents).toEqual(DEFAULT_QA_DOCUMENTS_CONFIG);
  });

  test("normalizes paths, unions and lists", () => {
    const config = resolveDocumentsConfig({
      storage: { root: "  D:\\data\\docs  " },
      templates: { root: "/srv/templates", default: "qa-report" },
      create: { allowFormats: ["pdf", "pdf"], defaultPdfMode: "typst" },
      docling: { baseUrl: "http://docling:5001/" },
      extraction: { ocrLanguages: [" rus ", "eng", ""] },
      limits: { maxInputBytes: 1024 },
    });
    expect(config.storage.root).toBe("D:\\data\\docs");
    expect(config.templates.default).toBe("qa-report");
    expect(config.create.allowFormats).toEqual(["pdf"]);
    expect(config.create.defaultPdfMode).toBe("typst");
    expect(config.docling.baseUrl).toBe("http://docling:5001");
    expect(config.extraction.ocrLanguages).toEqual(["rus", "eng"]);
    expect(config.limits.maxInputBytes).toBe(1024);
  });

  test("refuses relative storage and template roots", () => {
    expect(() =>
      resolveDocumentsConfig({ storage: { root: "./relative" } }),
    ).toThrow(DocumentError);
    expect(() =>
      resolveDocumentsConfig({ templates: { root: "templates" } }),
    ).toThrow(/absolute path/u);
  });

  test("refuses an empty format allow-list and unknown enum values", () => {
    expect(() =>
      resolveDocumentsConfig({ create: { allowFormats: [] } }),
    ).toThrow(/at least one of/u);
    expect(() =>
      resolveDocumentsConfig({ create: { defaultPdfMode: "latex" as "auto" } }),
    ).toThrow(/must be one of/u);
  });

  test("refuses a non-http docling endpoint and out-of-range limits", () => {
    expect(() =>
      resolveDocumentsConfig({ docling: { baseUrl: "file:///tmp/x" } }),
    ).toThrow(/http\(s\)/u);
    expect(() =>
      resolveDocumentsConfig({ limits: { maxInputBytes: 10 } }),
    ).toThrow(/between/u);
  });

  test("environment overrides touch only the documented variables", () => {
    const applied = applyDocumentsEnvOverrides(
      { storage: { root: null } },
      {
        QA_DOCUMENTS_ENABLED: "false",
        QA_DOCUMENTS_STORAGE_ROOT: "/srv/artifacts",
        QA_DOCLING_BASE_URL: "http://docling.internal:5001",
        QA_DOCLING_TIMEOUT_MS: "45000",
        QA_DOCUMENTS_MAX_INPUT_BYTES: "2048",
        QA_DOCUMENTS_OCR_LANGUAGES: "rus,eng",
        QA_PANDOC_EXECUTABLE: "/opt/pandoc",
        UNRELATED_SECRET: "ignored",
      },
    );
    expect(applied.enabled).toBe(false);
    expect(applied.storage?.root).toBe("/srv/artifacts");
    expect(applied.docling?.baseUrl).toBe("http://docling.internal:5001");
    expect(applied.docling?.timeoutMs).toBe(45_000);
    expect(applied.limits?.maxInputBytes).toBe(2048);
    expect(applied.extraction?.ocrLanguages).toEqual(["rus", "eng"]);
    expect(applied.pandoc?.executable).toBe("/opt/pandoc");
    expect(JSON.stringify(applied)).not.toContain("ignored");
  });

  test("an empty environment leaves the configured values alone", () => {
    const configured = resolveDocumentsConfig({ enabled: false });
    const applied = applyDocumentsEnvOverrides(
      { enabled: false, docling: { timeoutMs: 30_000 } },
      {},
    );
    expect(applied.enabled).toBe(false);
    expect(applied.docling?.timeoutMs).toBe(30_000);
    expect(resolveDocumentsConfig(applied).docling.timeoutMs).toBe(30_000);
    expect(configured.enabled).toBe(false);
  });

  test("retention interval is reported in milliseconds", () => {
    expect(retentionIntervalMs(resolveDocumentsConfig())).toBe(
      12 * 60 * 60 * 1000,
    );
  });

  test("the schema defaults never reach the resolver as explicit values", () => {
    // `ConfigSchema.parse({})` must produce a config the resolver accepts
    // unchanged, which is the invariant the settings layer depends on.
    const schema = DEFAULT_QA_SURFACE_CONFIG;
    expect(resolveConfig({ documents: schema.documents }).documents).toEqual(
      schema.documents,
    );
  });
});
