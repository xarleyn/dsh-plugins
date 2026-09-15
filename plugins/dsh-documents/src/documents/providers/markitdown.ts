/**
 * MarkItDown provider — the optional fast extractor (§6.2, §9).
 *
 * Kept behind `documents.markitdown.enabled` (off by default): it is a
 * convenient fallback when Docling is unreachable and high-fidelity parsing is
 * not needed, but it is not the extractor a QA report should be built on.
 */

import { DocumentError } from "../errors.js";
import type {
  BackendStatus,
  DocumentExtractor,
  DocumentFormat,
  ExtractInput,
  ExtractedDocument,
} from "../types.js";
import { expectProcessOk, runProcess } from "./process.js";
import { backendInfo, parseVersionOutput } from "./shared.js";

export interface MarkItDownProviderOptions {
  readonly executable: string;
  readonly timeoutMs: number;
  readonly maxStdoutBytes: number;
  /** Test seam: arguments placed before the provider's own argv. */
  readonly programPrefixArgs?: readonly string[];
  readonly versionProbe?: () => Promise<string | undefined>;
}

const VERSION_TIMEOUT_MS = 10_000;

export class MarkItDownExtractor implements DocumentExtractor {
  readonly name = "markitdown";
  private cachedVersion: Promise<string | undefined> | undefined;

  constructor(private readonly options: MarkItDownProviderOptions) {}

  supports(format: DocumentFormat): boolean {
    return format === "docx" || format === "pdf";
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
      });
      if (result.exitCode !== 0) return undefined;
      return parseVersionOutput(result.stdout, this.name);
    } catch {
      return undefined;
    }
  }

  async health(): Promise<BackendStatus> {
    try {
      return (await this.version()) === undefined ? "unavailable" : "ok";
    } catch {
      return "unavailable";
    }
  }

  async extract(input: ExtractInput): Promise<ExtractedDocument> {
    const result = await runProcess(
      this.options.executable,
      [input.inputPath],
      {
        cwd: input.workDir,
        timeoutMs: this.options.timeoutMs,
        maxStdoutBytes: this.options.maxStdoutBytes,
        backend: this.name,
        context: "extracting Markdown",
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        ...(this.options.programPrefixArgs === undefined
          ? {}
          : { programPrefixArgs: this.options.programPrefixArgs }),
      },
    );
    expectProcessOk(result, {
      backend: this.name,
      context: "extracting Markdown",
      fallbackCode: "EXTRACTION_FAILED",
    });
    const text = result.stdout.trimStart();
    if (text.trim() === "") {
      throw new DocumentError(
        "EXTRACTION_FAILED",
        "the extractor produced no text for this document",
        { backend: this.name },
      );
    }
    return {
      markdown: text,
      assets: [],
      backend: backendInfo(this.name, await this.version()),
      warnings: input.extractImages
        ? [
            {
              code: "IMAGE_SKIPPED",
              message:
                "this extractor does not report images; the response carries text only",
              backend: this.name,
            },
          ]
        : [],
    };
  }
}
