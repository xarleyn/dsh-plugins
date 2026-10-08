/**
 * The real spawn path: argv construction, version probing, timeouts, output
 * verification and environment filtering (§26.1, §26.5, §28).
 *
 * The backends are replaced by stub programs — a test seam the providers
 * expose as `programPrefixArgs` — so the assertions cover the exact command
 * line that would reach pandoc or LibreOffice, including what must *not* be on
 * it.
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { readZipEntryByName } from "../src/documents/inspect/zip.js";
import { LibreOfficePdfConverter } from "../src/documents/providers/libreoffice.js";
import { metadataArguments } from "../src/documents/providers/shared.js";
import {
  PandocDocxRenderer,
  PandocTypstPdfRenderer,
} from "../src/documents/providers/pandoc.js";
import { docxBytes } from "./helpers/document-fixtures.js";

import {
  argvLog,
  dir,
  docxSrc,
  pandocOptions,
  sofficeOptions,
} from "./documents-providers.helpers.js";

describe("pandoc provider", () => {
  test("renders DOCX with a fixed, orchestrator-owned command line", async () => {
    const renderer = new PandocDocxRenderer(pandocOptions());
    const outputPath = path.join(dir, "out", "report.docx");
    const assets = path.join(dir, "assets");
    const reference = path.join(dir, "reference.docx");
    await mkdir(assets, { recursive: true });
    await writeFile(reference, docxBytes());

    const artifact = await renderer.render({
      sourcePath: path.join(dir, "source.md"),
      outputPath,
      workDir: dir,
      assetsDir: assets,
      referenceDocPath: reference,
      title: "Отчёт",
      metadata: { author: "QA" },
      toc: true,
    });

    expect(artifact.size).toBeGreaterThan(0);
    expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(artifact.backend).toEqual({ provider: "pandoc", version: "9.9.9" });

    const [call] = await argvLog();
    const argv = call?.argv ?? [];
    expect(argv).toContain("--from=gfm");
    expect(argv).toContain("--to=docx");
    expect(argv).toContain(`--output=${outputPath}`);
    expect(argv).toContain(`--reference-doc=${reference}`);
    expect(argv).toContain(`--resource-path=${assets}`);
    expect(argv).toContain("--toc");
    // The metadata reaches the backend as a UTF-8 file, never as an argument
    // whose decoding the backend's own locale decides (§13).
    expect(argv.some((arg) => arg.startsWith("--metadata="))).toBe(false);
    const metadataArg = argv.find((arg) => arg.startsWith("--metadata-file="));
    expect(metadataArg).toBeDefined();
    const metadataYaml = await readFile(
      metadataArg?.slice("--metadata-file=".length) ?? "",
      "utf8",
    );
    expect(metadataYaml).toContain('"title": "Отчёт"');
    expect(metadataYaml).toContain('"author": "QA"');
    // No caller-supplied flags of any kind reach the backend (§26.1).
    for (const forbidden of [
      "--lua-filter",
      "--pdf-engine-opt",
      "--template",
    ]) {
      expect(argv.some((arg) => arg.startsWith(forbidden))).toBe(false);
    }
  });

  test("carries a Cyrillic title to the backend without losing its encoding", async () => {
    const renderer = new PandocDocxRenderer(pandocOptions("locale-docx"));
    const outputPath = path.join(dir, "out", "otchet.docx");
    const artifact = await renderer.render({
      sourcePath: path.join(dir, "source.md"),
      outputPath,
      workDir: dir,
      title: "Отчёт по работе",
    });
    expect(artifact.size).toBeGreaterThan(0);

    const [call] = await argvLog();
    const argv = call?.argv ?? [];
    // The command line carries no document text at all: an argument is decoded
    // in whatever locale the backend runs under, and that is where the title
    // used to be lost.
    expect(argv.some((arg) => arg.includes("Отчёт"))).toBe(false);
    expect(argv.some((arg) => arg.startsWith("--metadata="))).toBe(false);

    const document = readZipEntryByName(
      await readFile(outputPath),
      "word/document.xml",
    )?.toString("utf8");
    expect(document).toContain('<w:pStyle w:val="Title"/>');
    expect(document).toContain("Отчёт по работе");
    expect(document).not.toContain("\uFFFD");
  });

  test("reports a failing backend with a sanitized message", async () => {
    const renderer = new PandocDocxRenderer(pandocOptions("fail"));
    await expect(
      renderer.render({
        sourcePath: path.join(dir, "source.md"),
        outputPath: path.join(dir, "out.docx"),
        workDir: dir,
      }),
    ).rejects.toMatchObject({ code: "RENDER_FAILED" });
    await expect(
      renderer.render({
        sourcePath: path.join(dir, "source.md"),
        outputPath: path.join(dir, "out.docx"),
        workDir: dir,
      }),
    ).rejects.toThrow(/backend failed while reading <path>/u);
  });

  test("maps a timeout onto BACKEND_TIMEOUT and kills the child", async () => {
    const renderer = new PandocDocxRenderer({
      ...pandocOptions("sleep:5000"),
      timeoutMs: 300,
    });
    const started = Date.now();
    await expect(
      renderer.render({
        sourcePath: path.join(dir, "source.md"),
        outputPath: path.join(dir, "out.docx"),
        workDir: dir,
      }),
    ).rejects.toMatchObject({ code: "BACKEND_TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(4_000);
  });

  test("treats success without an output file as a failure", async () => {
    const renderer = new PandocDocxRenderer(pandocOptions("no-output"));
    await expect(
      renderer.render({
        sourcePath: path.join(dir, "source.md"),
        outputPath: path.join(dir, "out.docx"),
        workDir: dir,
      }),
    ).rejects.toMatchObject({ code: "RENDER_FAILED" });
  });

  test("reports an unusable executable as BACKEND_UNAVAILABLE", async () => {
    const renderer = new PandocDocxRenderer({
      executable: path.join(dir, "definitely-missing-binary"),
      timeoutMs: 5_000,
    });
    await expect(
      renderer.render({
        sourcePath: path.join(dir, "source.md"),
        outputPath: path.join(dir, "out.docx"),
        workDir: dir,
      }),
    ).rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE" });
  });

  test("the Typst route passes the engine, template and page size", async () => {
    const renderer = new PandocTypstPdfRenderer(pandocOptions());
    const outputPath = path.join(dir, "out", "report.pdf");
    const templateDir = path.join(dir, "templates", "typst");
    await mkdir(templateDir, { recursive: true });
    const artifact = await renderer.render({
      sourcePath: path.join(dir, "source.md"),
      outputPath,
      workDir: dir,
      typstTemplateDir: templateDir,
      pageSize: "A4",
      title: "Отчёт",
    });
    expect(artifact.backend.provider).toBe("typst");
    const argv = (await argvLog())[0]?.argv ?? [];
    expect(argv).toContain("--pdf-engine=typst");
    expect(argv).toContain(`--template=${path.join(templateDir, "main.typ")}`);
    expect(argv).toContain("-V=papersize=A4");
    expect(argv.some((arg) => arg.startsWith("--metadata="))).toBe(false);
    const metadataYaml = await readFile(
      (argv.find((arg) => arg.startsWith("--metadata-file=")) ?? "").slice(
        "--metadata-file=".length,
      ),
      "utf8",
    );
    expect(metadataYaml).toContain('"title": "Отчёт"');
  });
});

describe("provider metadata", () => {
  test("writes one quoted YAML entry per key into the work directory", async () => {
    await expect(
      metadataArguments(dir, "none.yml", undefined, {}),
    ).resolves.toEqual([]);
    const args = await metadataArguments(dir, "meta.yml", "Отчёт", {
      "2024": "год",
      multiline: "a\nb",
    });
    expect(args).toEqual([`--metadata-file=${path.join(dir, "meta.yml")}`]);
    await expect(readFile(path.join(dir, "meta.yml"), "utf8")).resolves.toBe(
      '"2024": "год"\n"multiline": "a b"\n"title": "Отчёт"\n',
    );
  });
});

describe("libreoffice provider", () => {
  test("converts through a per-job profile that is removed afterwards", async () => {
    const converter = new LibreOfficePdfConverter(sofficeOptions());
    const outputPath = path.join(dir, "out", "report.pdf");
    const result = await converter.convert({
      inputPath: docxSrc,
      outputPath,
      workDir: dir,
    });
    expect(result.size).toBeGreaterThan(0);
    expect(result.backend).toEqual({
      provider: "libreoffice",
      version: "9.9.9",
    });
    // The converter names the file after its input; the provider reports the
    // file it actually found rather than the name it predicted.
    expect(path.basename(result.path)).toBe("fixture.pdf");

    const argv = (await argvLog())[0]?.argv ?? [];
    expect(argv).toContain("--headless");
    expect(argv).toContain("--convert-to");
    expect(argv).toContain("pdf");
    const profileArg = argv.find((arg) =>
      arg.startsWith("-env:UserInstallation="),
    );
    expect(profileArg).toBeDefined();
    // One profile per job, removed on every path (§46).
    const profilePath = profileArg
      ?.slice("-env:UserInstallation=".length)
      .replace(/^file:\/\/\//u, "")
      .replace(/\//gu, path.sep);
    await expect(stat(profilePath ?? "")).rejects.toThrow();
  });

  test("accepts exactly one PDF when the converter names it differently", async () => {
    const converter = new LibreOfficePdfConverter(sofficeOptions());
    const outDir = path.join(dir, "other");
    await mkdir(outDir, { recursive: true });
    const result = await converter.convert({
      inputPath: docxSrc,
      outputPath: path.join(outDir, "expected-name.pdf"),
      workDir: dir,
    });
    // The stub derives the name from the input, so the provider must find it.
    expect(path.basename(result.path)).toBe("fixture.pdf");
  });

  test("maps a crash and a timeout onto distinct codes", async () => {
    // One directory per case: a stray PDF from another run would otherwise
    // satisfy the "exactly one PDF" rule and hide the failure.
    const failDir = path.join(dir, "fail-case");
    const slowDir = path.join(dir, "slow-case");
    const emptyDir = path.join(dir, "empty-case");
    await Promise.all([mkdir(failDir), mkdir(slowDir), mkdir(emptyDir)]);
    await expect(
      new LibreOfficePdfConverter(sofficeOptions("fail")).convert({
        inputPath: docxSrc,
        outputPath: path.join(failDir, "report.pdf"),
        workDir: dir,
      }),
    ).rejects.toMatchObject({ code: "CONVERSION_FAILED" });
    await expect(
      new LibreOfficePdfConverter({
        ...sofficeOptions("sleep:5000"),
        timeoutMs: 300,
      }).convert({
        inputPath: docxSrc,
        outputPath: path.join(slowDir, "report.pdf"),
        workDir: dir,
      }),
    ).rejects.toMatchObject({ code: "BACKEND_TIMEOUT" });
    await expect(
      new LibreOfficePdfConverter(sofficeOptions("no-output")).convert({
        inputPath: docxSrc,
        outputPath: path.join(emptyDir, "report.pdf"),
        workDir: dir,
      }),
    ).rejects.toMatchObject({ code: "CONVERSION_FAILED" });
  });
});
