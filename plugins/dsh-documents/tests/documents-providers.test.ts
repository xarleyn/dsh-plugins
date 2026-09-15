/**
 * The real spawn path: argv construction, version probing, timeouts, output
 * verification and environment filtering (§26.1, §26.5, §28).
 *
 * The backends are replaced by stub programs — a test seam the providers
 * expose as `programPrefixArgs` — so the assertions cover the exact command
 * line that would reach pandoc or LibreOffice, including what must *not* be on
 * it.
 */

import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { DocumentError } from "../src/documents/errors.js";
import { LibreOfficePdfConverter } from "../src/documents/providers/libreoffice.js";
import {
  PandocDocxRenderer,
  PandocTypstPdfRenderer,
} from "../src/documents/providers/pandoc.js";
import {
  buildProcessEnv,
  runProcess,
} from "../src/documents/providers/process.js";
import { docxBytes, pdfBytes } from "./helpers/document-fixtures.js";

let dir: string;
let docxSrc: string;
let pdfSrc: string;
let logPath: string;
let stubPandoc: string;
let stubSoffice: string;

/** Stub backend: records its argv, then copies the fixture it was told to. */
const STUB_SOURCE = `
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import path from "node:path";

const [docxSrc, pdfSrc, logPath, mode = "ok", ...argv] = process.argv.slice(2);
const record = () => {
  if (!logPath) return;
  appendFileSync(logPath, JSON.stringify({ argv, env: Object.keys(process.env), cwd: process.cwd() }) + "\\n");
};
record();

if (argv.includes("--version")) {
  process.stdout.write(process.env.STUB_VERSION_TEXT || "stub-backend 9.9.9\\n");
  process.exit(0);
}
if (mode === "fail") {
  process.stderr.write("\\u001b[31mbackend failed\\u001b[0m while reading /tmp/qa-documents/job-1/secret.md\\n");
  process.exit(3);
}
if (mode.startsWith("sleep:")) {
  await new Promise((resolve) => setTimeout(resolve, Number(mode.slice(6))));
}
if (mode === "spam") {
  process.stdout.write("x".repeat(200000));
  process.exit(0);
}
const out = argv.find((arg) => arg.startsWith("--output="))?.slice("--output=".length)
  ?? argv.filter((arg) => !arg.startsWith("-")).at(-1);
const to = argv.find((arg) => arg.startsWith("--to="))?.slice("--to=".length);
const outdirIndex = argv.indexOf("--outdir");
const outdir = outdirIndex >= 0 ? argv[outdirIndex + 1] : undefined;
if (mode === "no-output") process.exit(0);
const source = to === "pdf" ? pdfSrc : docxSrc;
const target = outdir
  ? path.join(outdir, path.basename(argv.at(-1) ?? "out").replace(/\\.[^.]+$/, "") + ".pdf")
  : out;
mkdirSync(path.dirname(target), { recursive: true });
writeFileSync(target, readFileSync(source));
process.stdout.write("converted\\n");
`;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "qa-docs-providers-"));
  docxSrc = path.join(dir, "fixture.docx");
  pdfSrc = path.join(dir, "fixture.pdf");
  logPath = path.join(dir, "argv.log");
  stubPandoc = path.join(dir, "stub-pandoc.mjs");
  stubSoffice = path.join(dir, "stub-soffice.mjs");
  await writeFile(docxSrc, docxBytes({ headings: ["H"] }));
  await writeFile(pdfSrc, pdfBytes({ pages: 2 }));
  await writeFile(stubPandoc, STUB_SOURCE, "utf8");
  await writeFile(stubSoffice, STUB_SOURCE, "utf8");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function pandocOptions(mode = "ok") {
  return {
    executable: process.execPath,
    timeoutMs: 20_000,
    programPrefixArgs: [stubPandoc, docxSrc, pdfSrc, logPath, mode],
  };
}

function sofficeOptions(mode = "ok") {
  return {
    executable: process.execPath,
    timeoutMs: 20_000,
    programPrefixArgs: [stubSoffice, docxSrc, pdfSrc, logPath, mode],
  };
}

async function argvLog(): Promise<
  { argv: string[]; env: string[]; cwd: string }[]
> {
  const raw = await readFile(logPath, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(
      (line) =>
        JSON.parse(line) as { argv: string[]; env: string[]; cwd: string },
    );
}

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
    expect(argv).toContain("--metadata=title=Отчёт");
    expect(argv).toContain("--metadata=author=QA");
    // No caller-supplied flags of any kind reach the backend (§26.1).
    for (const forbidden of [
      "--lua-filter",
      "--pdf-engine-opt",
      "--template",
    ]) {
      expect(argv.some((arg) => arg.startsWith(forbidden))).toBe(false);
    }
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
    });
    expect(artifact.backend.provider).toBe("typst");
    const argv = (await argvLog())[0]?.argv ?? [];
    expect(argv).toContain("--pdf-engine=typst");
    expect(argv).toContain(`--template=${path.join(templateDir, "main.typ")}`);
    expect(argv).toContain("-V=papersize=A4");
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

describe("process runner", () => {
  test("withholds ambient environment variables from the backend", async () => {
    const planted = "DSH_DOCUMENTS_TEST_SECRET";
    const previous = process.env[planted];
    process.env[planted] = "should-not-leak";
    try {
      const result = await runProcess(
        process.execPath,
        [
          stubPandoc,
          docxSrc,
          pdfSrc,
          logPath,
          "ok",
          `--output=${path.join(dir, "env.docx")}`,
          "--to=docx",
        ],
        {
          timeoutMs: 20_000,
          maxStdoutBytes: 1024,
          backend: "stub",
          context: "testing",
          programPrefixArgs: [],
        },
      );
      expect(result.exitCode).toBe(0);
      const call = (await argvLog())[0];
      expect(call?.env).toContain("PATH");
      expect(call?.env).not.toContain(planted);
    } finally {
      if (previous === undefined) delete process.env[planted];
      else process.env[planted] = previous;
    }
  });

  test("buildProcessEnv keeps only the allow-listed variables", () => {
    const env = buildProcessEnv(undefined, {
      PATH: "/usr/bin",
      HOME: "/home/qa",
      SystemRoot: "C:\\Windows",
      AWS_SECRET_ACCESS_KEY: "nope",
      HTTP_PROXY: "http://proxy",
    });
    expect(Object.keys(env).sort()).toEqual(["HOME", "PATH", "SystemRoot"]);
  });

  test("kills a backend that floods stdout", async () => {
    const result = await runProcess(
      process.execPath,
      [stubPandoc, docxSrc, pdfSrc, logPath, "spam"],
      {
        timeoutMs: 20_000,
        maxStdoutBytes: 4_096,
        backend: "stub",
        context: "testing",
      },
    );
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(4_096);
  });

  test("reports a missing executable as BACKEND_UNAVAILABLE", async () => {
    await expect(
      runProcess(path.join(dir, "nope"), [], {
        timeoutMs: 1_000,
        maxStdoutBytes: 100,
        backend: "stub",
        context: "testing",
      }),
    ).rejects.toBeInstanceOf(DocumentError);
  });
});
