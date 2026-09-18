import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

import {
  readDocxFacts,
  readDocxMetadata,
  readPdfFacts,
} from "../src/documents/inspect/facts.js";
import {
  loadTemplateRegistry,
  templateNames,
} from "../src/documents/templates/registry.js";
import { resolveTemplate } from "../src/documents/templates/resolver.js";
import {
  readZipEntries,
  readZipEntry,
  readZipEntryByName,
} from "../src/documents/inspect/zip.js";
import { docxBytes, pdfBytes } from "./helpers/document-fixtures.js";

import { workspace } from "./documents-convert.helpers.js";

describe("zip reader and fact readers", () => {
  test("reads stored and deflated entries", () => {
    const bytes = docxBytes({
      headings: ["Заголовок"],
      paragraphs: ["тело"],
      images: 1,
    });
    const entries = readZipEntries(bytes);
    expect(entries?.map((entry) => entry.name)).toContain("word/document.xml");
    const document = readZipEntryByName(bytes, "word/document.xml");
    expect(document?.toString("utf8")).toContain("Заголовок");
    const stored = entries?.find(
      (entry) => entry.name === "word/media/image1.png",
    );
    expect(document).toBeDefined();
    const bogus = {
      name: "x",
      compressionMethod: 8,
      compressedSize: 4,
      uncompressedSize: 4,
      localHeaderOffset: 10_000_000,
    };
    expect(readZipEntry(bytes, bogus)).toBeUndefined();
    expect(stored?.compressionMethod).toBe(0);
  });

  test("answers undefined for a non-archive or a truncated one", () => {
    expect(readZipEntries(Buffer.from("not a zip at all"))).toBeUndefined();
    const bytes = docxBytes();
    expect(readZipEntries(bytes.subarray(0, 40))).toBeUndefined();
    expect(readZipEntryByName(bytes, "word/missing.xml")).toBeUndefined();
  });

  test("PDF facts tolerate a document without an Info dictionary", () => {
    const facts = readPdfFacts(pdfBytes({ pages: 2 }));
    expect(facts.pages).toBe(2);
    expect(facts.encrypted).toBe(false);
  });

  test("DOCX metadata is empty when the package has no core properties", () => {
    const facts = readDocxFacts(docxBytes({ headings: ["A"] }));
    expect(facts.headings).toBe(1);
    const metadata = readDocxMetadata(docxBytes({ headings: ["A"] }));
    expect(metadata).toEqual({});
  });
});

describe("templates", () => {
  test("loads a registry, rejects escapes and refuses unknown names", async () => {
    const root = path.join(workspace, "templates");
    await mkdir(path.join(root, "docx"), { recursive: true });
    await writeFile(path.join(root, "docx", "qa-report.docx"), docxBytes());
    await writeFile(
      path.join(root, "manifest.yml"),
      "templates:\n  qa-report:\n    docx: ./docx/qa-report.docx\n",
      "utf8",
    );
    const registry = await loadTemplateRegistry(root);
    expect(registry.root).toBe(root);
    expect(templateNames(registry)).toEqual(["default", "qa-report"]);
    expect(
      resolveTemplate(registry, "qa-report", "default").resolved.name,
    ).toBe("qa-report");
    expect(
      resolveTemplate(registry, undefined, "default").resolved.source,
    ).toBe("builtin");
    expect(
      resolveTemplate(registry, undefined, "qa-report").warnings.map(
        (w) => w.code,
      ),
    ).toContain("TEMPLATE_DEFAULTED");
    expect(() => resolveTemplate(registry, "corporate", "default")).toThrow(
      /not registered/u,
    );
  });

  test("refuses a template path that leaves the template root", async () => {
    const root = path.join(workspace, "templates");
    await mkdir(root, { recursive: true });
    await writeFile(
      path.join(root, "manifest.yml"),
      "templates:\n  evil:\n    docx: ../../etc/passwd\n",
      "utf8",
    );
    await expect(loadTemplateRegistry(root)).rejects.toMatchObject({
      code: "PATH_NOT_ALLOWED",
    });
  });

  test("an invalid registry is refused and a malformed one warns", async () => {
    const root = path.join(workspace, "bad");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "manifest.yml"), "other: {}\n", "utf8");
    await expect(loadTemplateRegistry(root)).rejects.toMatchObject({
      code: "INVALID_TEMPLATE",
    });

    const warnRoot = path.join(workspace, "warn");
    await mkdir(warnRoot, { recursive: true });
    await writeFile(
      path.join(warnRoot, "manifest.yml"),
      "templates: [broken\n",
      "utf8",
    );
    const registry = await loadTemplateRegistry(warnRoot);
    expect(registry.warnings).toHaveLength(1);
  });
});
