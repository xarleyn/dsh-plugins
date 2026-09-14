/**
 * LibreOffice provider — DOCX → PDF (§6.1, §14.1, §46).
 *
 * Two details matter beyond "call the converter":
 *
 * - every invocation gets its own `-env:UserInstallation` profile, because
 *   concurrent headless LibreOffice processes sharing one profile corrupt each
 *   other's state; the temp profile is removed afterwards on success and on
 *   failure alike;
 * - a conversion that produced no file, timed out, or died is reported as a
 *   failure of this step only. The orchestrator keeps whatever earlier steps
 *   already produced (§45).
 */

import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { sha256OfFile } from "../artifacts/store.js";
import { DocumentError } from "../errors.js";
import type {
  ConvertPdfInput,
  ConvertedDocument,
  DocumentConverter,
} from "../types.js";
import { expectProcessOk, runProcess } from "./process.js";
import { backendInfo, parseVersionOutput, verifyOutput } from "./shared.js";
import { toFileUri } from "../security/paths.js";

export interface LibreOfficeProviderOptions {
  readonly executable: string;
  readonly timeoutMs: number;
  /** Directory the per-job profiles are created under (default: os temp). */
  readonly profileRoot?: string;
  /** Test seam: arguments placed before the provider's own argv. */
  readonly programPrefixArgs?: readonly string[];
  readonly versionProbe?: () => Promise<string | undefined>;
}

const VERSION_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/** Flags that keep a headless conversion from touching shared user state. */
const HEADLESS_FLAGS: readonly string[] = [
  "--headless",
  "--invisible",
  "--norestore",
  "--nolockcheck",
  "--nodefault",
  "--nofirststartwizard",
  "--nologo",
];

export class LibreOfficePdfConverter implements DocumentConverter {
  readonly name = "libreoffice";
  private cachedVersion: Promise<string | undefined> | undefined;

  constructor(private readonly options: LibreOfficeProviderOptions) {}

  supports(source: string, target: string): boolean {
    return source === "docx" && target === "pdf";
  }

  async version(): Promise<string | undefined> {
    this.cachedVersion ??= this.probeVersion();
    return await this.cachedVersion;
  }

  private async probeVersion(): Promise<string | undefined> {
    if (this.options.versionProbe !== undefined)
      return await this.options.versionProbe();
    try {
      const result = await runProcess(this.options.executable, ["--version"], {
        timeoutMs: VERSION_TIMEOUT_MS,
        maxStdoutBytes: 8 * 1024,
        backend: this.name,
        context: "reporting its version",
        ...(this.options.programPrefixArgs === undefined
          ? {}
          : { programPrefixArgs: this.options.programPrefixArgs }),
      });
      if (result.exitCode !== 0) return undefined;
      return parseVersionOutput(result.stdout, this.name);
    } catch {
      return undefined;
    }
  }

  async convert(input: ConvertPdfInput): Promise<ConvertedDocument> {
    const outputDir = path.dirname(input.outputPath);
    const profile = await mkdtemp(
      path.join(this.options.profileRoot ?? tmpdir(), "qa-libreoffice-"),
    );
    try {
      const argv = [
        ...HEADLESS_FLAGS,
        `-env:UserInstallation=${toFileUri(profile)}`,
        "--convert-to",
        "pdf",
        "--outdir",
        outputDir,
        input.inputPath,
      ];
      const result = await runProcess(this.options.executable, argv, {
        cwd: input.workDir,
        timeoutMs: this.options.timeoutMs,
        maxStdoutBytes: MAX_OUTPUT_BYTES,
        backend: this.name,
        context: "converting DOCX to PDF",
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        ...(this.options.programPrefixArgs === undefined
          ? {}
          : { programPrefixArgs: this.options.programPrefixArgs }),
      });
      expectProcessOk(result, {
        backend: this.name,
        context: "converting DOCX to PDF",
        fallbackCode: "CONVERSION_FAILED",
      });
      const produced = await this.locateOutput(outputDir, input.outputPath);
      const verified = await verifyOutput(
        produced,
        this.name,
        "CONVERSION_FAILED",
      );
      return {
        path: verified.path,
        size: verified.size,
        sha256: await sha256OfFile(verified.path),
        backend: backendInfo(this.name, await this.version()),
        warnings: [],
      };
    } finally {
      await rm(profile, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }

  /**
   * LibreOffice derives the output name from the input, so the expected path
   * is a prediction. When it is absent exactly one PDF in the output directory
   * is accepted; anything else is a failure rather than a guess.
   */
  private async locateOutput(
    outputDir: string,
    expected: string,
  ): Promise<string> {
    const details = await stat(expected).catch(() => undefined);
    if (details?.isFile() === true) return expected;
    const entries = await readdir(outputDir).catch(() => [] as string[]);
    const pdfs = entries.filter((entry) =>
      entry.toLowerCase().endsWith(".pdf"),
    );
    if (pdfs.length === 1) return path.join(outputDir, pdfs[0] ?? "");
    throw new DocumentError(
      "CONVERSION_FAILED",
      pdfs.length === 0
        ? "the PDF converter reported success but produced no PDF"
        : "the PDF converter produced an unexpected number of PDF files",
      { backend: this.name, details: { candidates: pdfs.length } },
    );
  }
}
