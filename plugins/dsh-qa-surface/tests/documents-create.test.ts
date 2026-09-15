/**
 * `document_create` end to end against stub backends: routing, artifact
 * layout, manifest contents, assets, templates and partial success (§8, §45).
 */

import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { readManifest } from "../src/documents/artifacts/manifest.js";
import { ArtifactStore } from "../src/documents/artifacts/store.js";
import { resolveDocumentsConfig } from "../src/documents/config.js";
import { DocumentError } from "../src/documents/errors.js";
import { DocumentRuntime } from "../src/documents/runtime.js";
import {
  docxBytes,
  markdownFixture,
  pdfBytes,
  pngBytes,
  pngDataUri,
} from "./helpers/document-fixtures.js";
import {
  stubProviderSet,
  type StubProviders,
} from "./helpers/document-providers.js";

let workspace: string;
let stub: StubProviders;
const FIXED_NOW = new Date("2026-09-14T10:00:00Z");

beforeEach(async () => {
  workspace = await path.join(
    tmpdir(),
    `qa-docs-create-${process.pid}-${Date.now()}`,
  );
  await mkdir(workspace, { recursive: true });
  stub = stubProviderSet();
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function runtime(
  options: {
    readonly providers?: StubProviders;
    readonly config?: Parameters<typeof resolveDocumentsConfig>[0];
  } = {},
): DocumentRuntime {
  return new DocumentRuntime({
    config: resolveDocumentsConfig(options.config ?? {}),
    providers: (options.providers ?? stub).providers,
    now: () => FIXED_NOW,
  });
}

const scope = (): { workspaceRoot: string; sessionId: string } => ({
  workspaceRoot: workspace,
  sessionId: "session-1",
});

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(filePath, "utf8")) as Record<
    string,
    unknown
  >;
}

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

  test("uses the Typst route when a template only provides a Typst layout", async () => {
    const templateRoot = path.join(workspace, "document-templates");
    await mkdir(path.join(templateRoot, "typst", "qa-report"), {
      recursive: true,
    });
    await writeFile(
      path.join(templateRoot, "typst", "qa-report", "main.typ"),
      "#let body = it\n",
      "utf8",
    );
    await writeFile(
      path.join(templateRoot, "manifest.yml"),
      "templates:\n  qa-report:\n    typst: ./typst/qa-report\n",
      "utf8",
    );
    const typst = stubProviderSet({ typstPdf: true });
    const result = await runtime({
      providers: typst,
      config: { typst: { enabled: true } },
    }).create(
      {
        content: "# Report",
        formats: ["pdf"],
        template: "qa-report",
        filename: "report",
      },
      scope(),
    );
    expect(result.files[0]?.status).toBe("created");
    expect(typst.calls.pdf).toHaveLength(1);
    expect(typst.calls.pdf[0]?.typstTemplateDir).toBe(
      path.join(templateRoot, "typst", "qa-report"),
    );
    expect(typst.calls.docx).toHaveLength(0);
  });

  test("refuses the Typst route when the deployment disables it", async () => {
    await expect(
      runtime().create(
        {
          content: "# Report",
          formats: ["pdf"],
          options: { pdfMode: "typst" },
        },
        scope(),
      ),
    ).rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE" });
  });

  test("inlines and rewrites assets, then validates the references", async () => {
    const content = "# Report\n\n![Скриншот](assets/shot.png)\n";
    const result = await runtime().create(
      {
        content,
        formats: ["docx"],
        filename: "report",
        assets: [
          { id: "shot", dataRef: pngDataUri(), filename: "login-error.png" },
        ],
      },
      scope(),
    );
    const source = await readFile(result.source?.path ?? "", "utf8");
    expect(source).toContain("![Скриншот](assets/login-error.png)");
    const assetsDir = path.join(path.dirname(result.manifestPath), "assets");
    expect(await readdir(assetsDir)).toEqual(["login-error.png"]);
    expect(stub.calls.docx[0]?.assetsDir).toBe(assetsDir);
  });

  test("copies a workspace asset and rewrites its path reference", async () => {
    const assetPath = path.join(workspace, "screens", "shot.png");
    await mkdir(path.dirname(assetPath), { recursive: true });
    await writeFile(assetPath, pngBytes());
    const result = await runtime().create(
      {
        content: `# Report\n\n![Shot](${assetPath.replace(/\\/gu, "/")})\n`,
        formats: ["docx"],
        filename: "report",
        assets: [{ id: "shot", path: "screens/shot.png" }],
      },
      scope(),
    );
    const source = await readFile(result.source?.path ?? "", "utf8");
    expect(source).toContain("![Shot](assets/shot.png)");
  });

  test("refuses a missing, remote or disallowed asset", async () => {
    await expect(
      runtime().create(
        { content: "![x](assets/missing.png)", formats: ["docx"] },
        scope(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_ASSET" });

    await expect(
      runtime().create(
        { content: "![x](https://example.com/x.png)", formats: ["docx"] },
        scope(),
      ),
    ).rejects.toThrow(/remote image/u);

    await expect(
      runtime().create(
        {
          content: "# x",
          formats: ["docx"],
          assets: [
            {
              id: "svg",
              dataRef: `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`,
            },
          ],
        },
        scope(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_ASSET" });

    await expect(
      runtime().create(
        {
          content: "# x",
          formats: ["docx"],
          assets: [{ id: "outside", path: "../../../etc/passwd" }],
        },
        scope(),
      ),
    ).rejects.toMatchObject({ code: "PATH_NOT_ALLOWED" });
  });

  test("refuses raw markup unless the deployment opts in", async () => {
    await expect(
      runtime().create(
        { content: "# x\n\n<script>alert(1)</script>", formats: ["docx"] },
        scope(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const allowed = await runtime({
      config: { create: { allowRawMarkup: true } },
    }).create(
      { content: "# x\n\n<script>alert(1)</script>", formats: ["docx"] },
      scope(),
    );
    expect(allowed.files[0]?.status).toBe("created");
  });

  test("honours a configured storage root outside the workspace", async () => {
    const storageRoot = path.join(
      tmpdir(),
      `qa-docs-storage-${process.pid}-${Date.now()}`,
    );
    try {
      const result = await runtime({
        config: { storage: { root: storageRoot } },
      }).create(
        { content: "# x", formats: ["docx"], filename: "report" },
        scope(),
      );
      expect(result.manifestPath.startsWith(storageRoot)).toBe(true);
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  test("fails closed without a session working directory", async () => {
    await expect(
      runtime().create(
        { content: "# x", formats: ["docx"] },
        { workspaceRoot: "" },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  test("the create runtime refuses to build when the subsystem is disabled", async () => {
    const { createDocumentRuntime } =
      await import("../src/documents/runtime.js");
    expect(() =>
      createDocumentRuntime({ config: { enabled: false }, env: {} }),
    ).toThrow(DocumentError);
  });

  test("warns when a requested page size cannot reach the DOCX layout", async () => {
    const result = await runtime().create(
      {
        content: "# x",
        formats: ["docx", "pdf"],
        options: { pageSize: "A4" },
        filename: "report",
      },
      scope(),
    );
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "PAGE_SIZE_NOT_APPLIED",
    );
    expect(stub.calls.pdf).toHaveLength(0);
  });

  test("the PDF route receives the requested page size", async () => {
    const typst = stubProviderSet({ typstPdf: true });
    await runtime({
      providers: typst,
      config: { typst: { enabled: true } },
    }).create(
      {
        content: "# x",
        formats: ["pdf"],
        options: { pdfMode: "typst", pageSize: "A4" },
      },
      scope(),
    );
    expect(typst.calls.pdf[0]?.pageSize).toBe("A4");
  });

  test("keeps the produced PDF bytes intact", async () => {
    const expected = pdfBytes({ pages: 3 });
    const providers = stubProviderSet({ pdfOutput: expected });
    const result = await runtime({ providers }).create(
      { content: "# x", formats: ["pdf", "docx"] },
      scope(),
    );
    const pdf = result.files.find((file) => file.format === "pdf");
    expect(await readFile(pdf?.path ?? "")).toEqual(expected);
  });
});
