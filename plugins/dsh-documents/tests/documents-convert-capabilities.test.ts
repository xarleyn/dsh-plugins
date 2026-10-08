import { stat, utimes } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

import {
  documentCapabilities,
  documentHealth,
  documentPrograms,
} from "../src/documents/capabilities.js";
import { resolveDocumentsConfig } from "../src/documents/config.js";
import { CONVERSION_ROUTES } from "../src/documents/orchestrator/convert-document.js";
import { createProviders } from "../src/documents/providers/registry.js";
import { loadTemplateRegistry } from "../src/documents/templates/registry.js";
import { DOCUMENTS_STARTUP_PROGRAMS } from "../src/shared/settings.js";
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

  test("the startup check answers for exactly the programs the card may name", async () => {
    const programs = await documentPrograms(
      resolveDocumentsConfig({
        pandoc: { executable: "definitely-not-installed-xyz" },
      }),
    );
    expect(Object.keys(programs)).toEqual([...DOCUMENTS_STARTUP_PROGRAMS]);
    expect(programs["pandoc"]).toBe("unavailable");
    // A route the deployment never enabled is not a missing program (§42).
    expect(programs["typst"]).toBe("disabled");
    expect(programs["markitdown"]).toBe("disabled");
  });

  test("the startup check probes a route the deployment did enable", async () => {
    const programs = await documentPrograms(
      resolveDocumentsConfig({
        typst: { enabled: true, executable: "definitely-not-installed-xyz" },
        markitdown: {
          enabled: true,
          executable: "definitely-not-installed-xyz",
        },
      }),
    );
    expect(programs["typst"]).toBe("unavailable");
    expect(programs["markitdown"]).toBe("unavailable");
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

  test("sweeps a stale temp directory without touching a job in flight", async () => {
    // Retention used to remove the whole `.tmp` root, so a sweep landed on the
    // fresh working directory of a job that had not finished yet (§47).
    const store = new (
      await import("../src/documents/artifacts/store.js")
    ).ArtifactStore({
      root: path.join(workspace, "sweep"),
    });
    const stale = await store.createWorkDir("stale-job");
    const active = await store.createWorkDir("active-job");
    const longAgo = new Date(Date.now() - 40 * 86_400_000);
    await utimes(stale, longAgo, longAgo);

    const swept = await store.cleanup({ maxAgeDays: 30 });
    expect(swept.removed).toEqual([]);
    expect((await stat(active)).isDirectory()).toBe(true);
    expect(await store.exists(path.join(".tmp", "active-job"))).toBe(true);
    expect(await store.exists(path.join(".tmp", "stale-job"))).toBe(false);
    expect(await store.exists(".tmp")).toBe(true);
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
