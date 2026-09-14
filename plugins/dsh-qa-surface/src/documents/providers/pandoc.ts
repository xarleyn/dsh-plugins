/**
 * Pandoc provider (§6.1, §13, §14.2).
 *
 * The command line is assembled here and nowhere else: the agent supplies
 * content, a template *name* and a handful of enumerated options, and this
 * module turns them into argv. There is no path through the pipeline by which
 * a caller can add `--lua-filter`, an arbitrary `--resource-path`, or a
 * `--pdf-engine-opt` (§26.1).
 */

import path from "node:path";

import { sha256OfFile } from "../artifacts/store.js";
import { DocumentError } from "../errors.js";
import type {
  DocxRenderer,
  PdfRenderer,
  RenderDocxInput,
  RenderPdfInput,
  RenderedArtifact,
} from "../types.js";
import { expectProcessOk, runProcess, type ProcessResult } from "./process.js";
import {
  backendInfo,
  metadataArguments,
  parseVersionOutput,
  verifyOutput,
} from "./shared.js";

export interface PandocProviderOptions {
  /** Executable name or absolute path (`pandoc`, `pandoc.exe`). */
  readonly executable: string;
  readonly timeoutMs: number;
  /** Test seam: arguments placed before the provider's own argv. */
  readonly programPrefixArgs?: readonly string[];
  /** Test seam: replacement for `--version` probing. */
  readonly versionProbe?: () => Promise<string | undefined>;
}

const VERSION_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

function spawnPandoc(
  options: PandocProviderOptions,
  argv: readonly string[],
  context: {
    readonly cwd: string;
    readonly backend: string;
    readonly action: string;
    readonly signal?: AbortSignal;
  },
): Promise<ProcessResult> {
  return runProcess(options.executable, argv, {
    cwd: context.cwd,
    timeoutMs: options.timeoutMs,
    maxStdoutBytes: MAX_OUTPUT_BYTES,
    backend: context.backend,
    context: context.action,
    ...(context.signal === undefined ? {} : { signal: context.signal }),
    ...(options.programPrefixArgs === undefined
      ? {}
      : { programPrefixArgs: options.programPrefixArgs }),
  });
}

async function probeVersion(
  options: PandocProviderOptions,
  backend: string,
): Promise<string | undefined> {
  if (options.versionProbe !== undefined) return await options.versionProbe();
  try {
    const result = await runProcess(options.executable, ["--version"], {
      timeoutMs: VERSION_TIMEOUT_MS,
      maxStdoutBytes: 8 * 1024,
      backend,
      context: "reporting its version",
      ...(options.programPrefixArgs === undefined
        ? {}
        : { programPrefixArgs: options.programPrefixArgs }),
    });
    if (result.exitCode !== 0) return undefined;
    return parseVersionOutput(result.stdout, backend);
  } catch {
    return undefined;
  }
}

/** Pandoc renders Markdown into DOCX, optionally through a reference document. */
export class PandocDocxRenderer implements DocxRenderer {
  readonly name = "pandoc";
  private cachedVersion: Promise<string | undefined> | undefined;

  constructor(private readonly options: PandocProviderOptions) {}

  async version(): Promise<string | undefined> {
    this.cachedVersion ??= probeVersion(this.options, this.name);
    return await this.cachedVersion;
  }

  async render(input: RenderDocxInput): Promise<RenderedArtifact> {
    const argv = [
      input.sourcePath,
      "--from=gfm",
      "--to=docx",
      `--output=${input.outputPath}`,
      ...(input.referenceDocPath === undefined
        ? []
        : [`--reference-doc=${input.referenceDocPath}`]),
      ...(input.assetsDir === undefined
        ? []
        : [`--resource-path=${input.assetsDir}`]),
      ...(input.toc === true ? ["--toc", "--toc-depth=3"] : []),
      ...(input.title === undefined ? [] : [`--metadata=title=${input.title}`]),
      ...metadataArguments(input.metadata),
    ];
    const result = await spawnPandoc(this.options, argv, {
      cwd: input.workDir,
      backend: this.name,
      action: "rendering DOCX",
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (result.truncated) {
      throw new DocumentError(
        "RENDER_FAILED",
        "the DOCX renderer produced more output than the pipeline accepts",
        { backend: this.name },
      );
    }
    expectProcessOk(result, {
      backend: this.name,
      context: "rendering DOCX",
      fallbackCode: "RENDER_FAILED",
    });
    const verified = await verifyOutput(
      input.outputPath,
      this.name,
      "RENDER_FAILED",
    );
    return {
      path: verified.path,
      size: verified.size,
      sha256: await sha256OfFile(verified.path),
      backend: backendInfo(this.name, await this.version()),
      warnings: [],
    };
  }
}

/**
 * Pandoc-driven PDF renderer. The only engine this pipeline enables is Typst,
 * so the provider exists for `pdfMode: "typst"` alone (§14.2); the office route
 * renders DOCX first and converts it with LibreOffice.
 */
export class PandocTypstPdfRenderer implements PdfRenderer {
  readonly name = "typst";
  private cachedVersion: Promise<string | undefined> | undefined;

  constructor(private readonly options: PandocProviderOptions) {}

  async version(): Promise<string | undefined> {
    this.cachedVersion ??= probeVersion(this.options, this.name);
    return await this.cachedVersion;
  }

  async render(input: RenderPdfInput): Promise<RenderedArtifact> {
    const argv = [
      input.sourcePath,
      "--from=gfm",
      "--to=pdf",
      "--standalone",
      "--pdf-engine=typst",
      `--output=${input.outputPath}`,
      ...(input.typstTemplateDir === undefined
        ? []
        : [`--template=${path.join(input.typstTemplateDir, "main.typ")}`]),
      ...(input.assetsDir === undefined
        ? []
        : [`--resource-path=${input.assetsDir}`]),
      ...(input.pageSize === undefined
        ? []
        : [`-V=papersize=${input.pageSize}`]),
      ...(input.toc === true ? ["--toc", "--toc-depth=3"] : []),
      ...(input.title === undefined ? [] : [`--metadata=title=${input.title}`]),
      ...metadataArguments(input.metadata),
    ];
    const result = await spawnPandoc(this.options, argv, {
      cwd: input.workDir,
      backend: this.name,
      action: "rendering PDF with Typst",
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    expectProcessOk(result, {
      backend: this.name,
      context: "rendering PDF with Typst",
      fallbackCode: "RENDER_FAILED",
    });
    const verified = await verifyOutput(
      input.outputPath,
      this.name,
      "RENDER_FAILED",
    );
    return {
      path: verified.path,
      size: verified.size,
      sha256: await sha256OfFile(verified.path),
      backend: backendInfo(this.name, await this.version()),
      warnings: [],
    };
  }
}
