import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { DocumentError } from "../src/documents/errors.js";
import { pdfBytes, pngBytes, pngDataUri } from "./helpers/document-fixtures.js";
import { stubProviderSet } from "./helpers/document-providers.js";

import { runtime, scope, stub, workspace } from "./documents-create.helpers.js";

describe("document_create", () => {
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
