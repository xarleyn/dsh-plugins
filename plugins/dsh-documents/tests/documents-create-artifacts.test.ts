/**
 * `document_create` end to end against stub backends: routing, artifact
 * layout, manifest contents, assets, templates and partial success (§8, §45).
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { readManifest } from "../src/documents/artifacts/manifest.js";
import { ArtifactStore } from "../src/documents/artifacts/store.js";
import { DocumentError } from "../src/documents/errors.js";
import {
  docxBytes,
  markdownFixture,
  pngDataUri,
} from "./helpers/document-fixtures.js";
import { stubProviderSet } from "./helpers/document-providers.js";

import {
  FIXED_NOW,
  readJson,
  runtime,
  scope,
  stub,
  workspace,
} from "./documents-create.helpers.js";

describe("document_create", () => {
  test("creates a DOCX artifact with a manifest", async () => {
    const result = await runtime().create(
      {
        content: "# Report\n\nBody text.\n",
        filename: "../../foo report?.docx",
        formats: ["docx"],
      },
      scope(),
    );

    expect(result.artifactId).toMatch(/^doc_[0-9A-HJKMNP-TV-Z]{26}$/u);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.status).toBe("created");
    expect(path.basename(result.files[0]?.path ?? "")).toBe("foo-report.docx");
    expect(result.source?.mediaType).toBe("text/markdown");
    expect(result.manifestPath).toBe(
      path.join(
        workspace,
        ".qa",
        "artifacts",
        "documents",
        result.artifactId,
        "manifest.json",
      ),
    );

    const store = new ArtifactStore({
      root: path.join(workspace, ".qa", "artifacts", "documents"),
    });
    const manifest = await readManifest(store, result.artifactId);
    expect(manifest.operation).toBe("document_create");
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.createdAt).toBe(FIXED_NOW.toISOString());
    expect(manifest.input.format).toBe("md");
    expect(manifest.outputs).toHaveLength(1);
    expect(manifest.outputs[0]?.format).toBe("docx");
    expect(manifest.outputs[0]?.sha256).toBe(result.files[0]?.sha256);
    expect(manifest.backends["docx"]).toEqual({
      provider: "pandoc",
      version: "test",
    });
    expect(manifest.scope).toEqual({ sessionId: "session-1", workspace });
  });

  test("renders DOCX and PDF through the office route with one DOCX render", async () => {
    const result = await runtime().create(
      {
        content: "# Report\n\nBody.",
        formats: ["docx", "pdf"],
        filename: "report",
      },
      scope(),
    );
    expect(result.files.map((file) => file.status)).toEqual([
      "created",
      "created",
    ]);
    expect(stub.calls.docx).toHaveLength(1);
    expect(stub.calls.convert).toHaveLength(1);
    // The PDF is converted from the DOCX that stays in the bundle (§14.1).
    expect(stub.calls.convert[0]?.inputPath).toBe(result.files[0]?.path);
    expect(stub.calls.convert[0]?.outputPath).toBe(result.files[1]?.path);
  });

  test("reports partial success when only the PDF fails", async () => {
    const failing = stubProviderSet({
      pdfError: new DocumentError(
        "BACKEND_TIMEOUT",
        "libreoffice exceeded its time budget",
      ),
    });
    const result = await runtime({ providers: failing }).create(
      { content: "# Report", formats: ["docx", "pdf"], filename: "report" },
      scope(),
    );
    expect(result.files[0]?.status).toBe("created");
    expect(result.files[1]?.status).toBe("failed");
    expect(result.files[1]?.error).toBe("BACKEND_TIMEOUT");
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "FORMAT_FAILED",
    );
    // The DOCX really exists, and no empty PDF was left behind.
    await expect(stat(result.files[0]?.path ?? "")).resolves.toBeDefined();
    await expect(stat(result.files[1]?.path ?? "")).rejects.toThrow();
  });

  test("fails when no requested format could be produced", async () => {
    const failing = stubProviderSet({
      docxError: new DocumentError(
        "BACKEND_UNAVAILABLE",
        "pandoc is not installed",
      ),
    });
    await expect(
      runtime({ providers: failing }).create(
        { content: "# Report", formats: ["docx"] },
        scope(),
      ),
    ).rejects.toThrow(/pandoc is not installed/u);
  });

  test("refuses formats outside the deployment allow-list", async () => {
    await expect(
      runtime({ config: { create: { allowFormats: ["docx"] } } }).create(
        { content: "# x", formats: ["pdf"] },
        scope(),
      ),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT" });
    await expect(
      runtime().create({ content: "# x", formats: ["odt" as "docx"] }, scope()),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT" });
    await expect(
      runtime().create({ content: "# x", formats: [] }, scope()),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  test("enforces the Markdown size budget", async () => {
    await expect(
      runtime({ config: { limits: { maxMarkdownChars: 1000 } } }).create(
        { content: "x".repeat(2000), formats: ["docx"] },
        scope(),
      ),
    ).rejects.toMatchObject({ code: "DOCUMENT_TOO_LARGE" });
  });

  test("writes the source with directives applied and keeps the bundle tidy", async () => {
    const result = await runtime().create(
      {
        content: markdownFixture(),
        formats: ["docx"],
        filename: "report",
        assets: [{ id: "shot", dataRef: pngDataUri() }],
      },
      scope(),
    );
    const source = await readFile(result.source?.path ?? "", "utf8");
    expect(source).toContain("{=openxml}");
    expect(source).not.toContain(":::pagebreak");
    const bundle = await readdir(path.dirname(result.manifestPath));
    expect(new Set(bundle)).toEqual(
      new Set(["assets", "manifest.json", "report.docx", "source.md"]),
    );
    // The job temp directory is removed on success (§47).
    const artifactsRoot = path.dirname(path.dirname(result.manifestPath));
    expect(
      await readdir(path.join(artifactsRoot, ".tmp")).catch(() => []),
    ).toEqual([]);
  });

  test("drops the source from the bundle when retention says so", async () => {
    const result = await runtime({
      config: { storage: { retainSource: false } },
    }).create(
      { content: "# x", formats: ["docx"], filename: "report" },
      scope(),
    );
    expect(result.source).toBeUndefined();
    const bundle = await readdir(path.dirname(result.manifestPath));
    expect(bundle).not.toContain("source.md");
  });

  test("applies a registered template and records its hash", async () => {
    const templateRoot = path.join(workspace, "document-templates");
    await mkdir(path.join(templateRoot, "docx"), { recursive: true });
    await writeFile(
      path.join(templateRoot, "docx", "qa-report.docx"),
      docxBytes({ title: "T" }),
    );
    await writeFile(
      path.join(templateRoot, "manifest.yml"),
      "templates:\n  qa-report:\n    docx: ./docx/qa-report.docx\n",
      "utf8",
    );

    const result = await runtime().create(
      {
        content: "# Report",
        formats: ["docx"],
        template: "qa-report",
        filename: "report",
      },
      scope(),
    );
    expect(result.template).toBe("qa-report");
    expect(stub.calls.docx[0]?.referenceDocPath).toBe(
      path.join(templateRoot, "docx", "qa-report.docx"),
    );
    const manifest = await readJson(result.manifestPath);
    expect(manifest["template"]).toBe("qa-report");
    expect(typeof manifest["templateSha256"]).toBe("string");
  });

  test("refuses an unregistered template instead of falling back", async () => {
    await expect(
      runtime().create(
        { content: "# Report", formats: ["docx"], template: "corporate" },
        scope(),
      ),
    ).rejects.toMatchObject({ code: "TEMPLATE_NOT_FOUND" });
  });
});
