import path from "node:path";
import { describe, expect, test } from "vitest";

import {
  documentCapabilities,
  documentHealth,
} from "../src/documents/capabilities.js";
import { resolveDocumentsConfig } from "../src/documents/config.js";
import { CONVERSION_ROUTES } from "../src/documents/orchestrator/convert-document.js";
import { createProviders } from "../src/documents/providers/registry.js";
import { loadTemplateRegistry } from "../src/documents/templates/registry.js";
import { stubProviderSet } from "./helpers/document-providers.js";

import { runtime, scope, workspace } from "./documents-convert.helpers.js";

describe("capabilities and health", () => {
  test("reports what the deployment can do", async () => {
    const config = resolveDocumentsConfig({ typst: { enabled: true } });
    const providers = stubProviderSet({ typstPdf: true }).providers;
    const capabilities = documentCapabilities({
      config,
      providers,
      templates: await loadTemplateRegistry(undefined),
    });
    expect(capabilities.enabled).toBe(true);
    expect(capabilities.create).toEqual(["docx", "pdf"]);
    expect(capabilities.extract).toEqual(["docx", "pdf"]);
    expect(capabilities.convert).toEqual(CONVERSION_ROUTES);
    expect(capabilities.ocr).toBe(true);
    expect(capabilities.templates).toEqual(["default"]);
    expect(capabilities.pdfModes).toEqual(["auto", "office", "typst"]);
  });

  test("a deployment without an extractor advertises no extraction", () => {
    const config = resolveDocumentsConfig({ docling: { enabled: false } });
    const providers = {
      ...createProviders(config),
      docling: undefined,
      doclingHealth: undefined,
    };
    const capabilities = documentCapabilities({
      config,
      providers,
      templates: { templates: new Map(), warnings: [] },
    });
    expect(capabilities.extract).toEqual([]);
    expect(capabilities.convert).toEqual([
      ["md", "docx"],
      ["md", "pdf"],
    ]);
    expect(capabilities.ocr).toBe(false);
  });

  test("health separates required from optional backends", async () => {
    const config = resolveDocumentsConfig();
    const health = await documentHealth({
      config,
      providers: {
        ...stubProviderSet().providers,
        doclingHealth: async () => "unavailable",
      },
      probeProcessBackends: false,
    });
    expect(health.status).toBe("degraded");
    expect(health.required["pandoc"]).toBe("ok");
    expect(health.required["docling"]).toBe("unavailable");
    expect(health.optional).toEqual({
      typst: "disabled",
      markitdown: "disabled",
    });
  });

  test("health reports a missing process backend as unavailable", async () => {
    const config = resolveDocumentsConfig({
      pandoc: { executable: "definitely-not-installed-xyz" },
    });
    const health = await documentHealth({
      config,
      providers: stubProviderSet().providers,
    });
    expect(health.required["pandoc"]).toBe("unavailable");
    expect(health.status).toBe("degraded");
  });
});

describe("artifact store", () => {
  test("lists and sweeps bundles by age", async () => {
    const result = await runtime().create(
      { content: "# x", formats: ["docx"] },
      scope(),
    );
    const store = new (
      await import("../src/documents/artifacts/store.js")
    ).ArtifactStore({
      root: path.join(workspace, ".qa", "artifacts", "documents"),
    });
    expect((await store.list()).map((entry) => entry.artifactId)).toContain(
      result.artifactId,
    );
    const future = new Date(Date.now() + 40 * 86_400_000);
    const swept = await store.cleanup({ maxAgeDays: 30, now: future });
    expect(swept.removed).toContain(result.artifactId);
    expect(await store.exists(result.artifactId)).toBe(false);
  });

  test("refuses an artifact id that was not issued by this pipeline", async () => {
    const { ArtifactStore } =
      await import("../src/documents/artifacts/store.js");
    const store = new ArtifactStore({ root: workspace });
    expect(() => store.artifactDir("../../etc")).toThrow(/not an artifact id/u);
    expect(() => store.path("../../../escape.txt")).toThrow(
      /outside the allowed document scope/u,
    );
  });
});
