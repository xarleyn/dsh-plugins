/**
 * `document_convert` orchestration (§10).
 *
 * The route table is explicit and closed:
 *
 * ```text
 * MD   → DOCX, PDF
 * DOCX → PDF, MD
 * PDF  → MD
 * ```
 *
 * Anything else answers `UNSUPPORTED_CONVERSION` — the pipeline never falls
 * back to "run some shell pipeline and hope", because a conversion the service
 * does not model is a conversion it cannot bound, observe or secure.
 *
 * Provider-backed routes consult the conversion cache (§44 of the plan in
 * `cache/`): the same input with the same options is converted once, and every
 * later request materializes a fresh artifact from the recorded result. A cache
 * hit never invents a bundle — the bytes are copied and re-hashed, so callers
 * see the same manifest shape either way.
 */

import { stat } from "node:fs/promises";
import path from "node:path";

import { sha256Hex, sha256OfFile } from "../artifacts/store.js";
import {
  buildManifest,
  outputRecord,
  writeManifest,
} from "../artifacts/manifest.js";
import { ConversionCache, type ConversionRequest } from "../cache/index.js";
import { DocumentError, asDocumentError } from "../errors.js";
import {
  describeUnsupported,
  mediaTypeFor,
  sniffDocument,
  supportedFormatOf,
} from "../security/file-types.js";
import type {
  CreateFormat,
  DocumentConvertInput,
  DocumentConvertResult,
  DocumentFileResult,
  DocumentFormat,
  DocumentWarning,
} from "../types.js";
import { createDocument } from "./create-document.js";
import { extractToMarkdown } from "./extract-document.js";
import type { CacheSpec } from "./cache-spec.js";
import {
  ensureArtifactRoot,
  readInputBytes,
  resolveDocumentScope,
  resolveInputPath,
  type DocumentScope,
} from "./scope.js";
import { withRenderSlot, type DocumentRuntimeDeps } from "./runtime-deps.js";

/** Routes this pipeline implements (source → target). */
export const CONVERSION_ROUTES: readonly (readonly [
  DocumentFormat,
  DocumentFormat,
])[] = [
  ["md", "docx"],
  ["md", "pdf"],
  ["docx", "pdf"],
  ["docx", "md"],
  ["pdf", "md"],
];

function routeIsSupported(
  source: DocumentFormat,
  target: DocumentFormat,
): boolean {
  return CONVERSION_ROUTES.some(
    ([from, to]) => from === source && to === target,
  );
}

export async function convertDocument(
  deps: DocumentRuntimeDeps,
  input: DocumentConvertInput,
  scopeInput: DocumentScope,
): Promise<DocumentConvertResult> {
  const config = deps.config;
  if (
    input.targetFormat !== "docx" &&
    input.targetFormat !== "pdf" &&
    input.targetFormat !== "md"
  ) {
    throw new DocumentError(
      "UNSUPPORTED_FORMAT",
      `"${String(input.targetFormat)}" is not a convertible target format`,
    );
  }
  const scope = await resolveDocumentScope(config, scopeInput);
  const inputPath = await resolveInputPath(config, scope, input.file, "file");
  const bytes = await readInputBytes(inputPath, config, "file");
  const sniffed = sniffDocument(bytes, inputPath);
  const sourceFormat = supportedFormatOf(sniffed);
  if (sourceFormat === undefined) {
    throw new DocumentError(
      sniffed.format === "docm"
        ? "MACRO_ENABLED_DOCUMENT"
        : "UNSUPPORTED_FORMAT",
      describeUnsupported(sniffed, inputPath),
    );
  }
  if (!routeIsSupported(sourceFormat, input.targetFormat)) {
    throw new DocumentError(
      "UNSUPPORTED_CONVERSION",
      `${sourceFormat} → ${input.targetFormat} is not a supported conversion (supported: ${CONVERSION_ROUTES.map(([from, to]) => `${from} → ${to}`).join(", ")})`,
      { details: { source: sourceFormat, target: input.targetFormat } },
    );
  }

  // Extraction first: it also covers `md` sources, and it narrows
  // `targetFormat` to a creatable format for the branch below.
  if (input.targetFormat === "md") {
    const extracted = await extractToMarkdown(
      deps,
      {
        file: inputPath,
        ...(input.options?.ocr === undefined ? {} : { ocr: input.options.ocr }),
        ...(input.outputFilename === undefined
          ? {}
          : { outputFilename: input.outputFilename }),
      },
      {
        ...scope,
        ...(scope.signal === undefined ? {} : { signal: scope.signal }),
      },
      "document_convert",
      {
        inputSha256: sha256Hex(bytes),
        inputFilename: path.basename(inputPath),
      },
    );
    return {
      artifactId: extracted.artifactId,
      files: [
        {
          format: "md",
          path: extracted.markdownPath,
          mediaType: mediaTypeFor("md"),
          size: (await stat(extracted.markdownPath)).size,
          sha256: await sha256OfFile(extracted.markdownPath),
          status: "created",
        },
      ],
      source: { path: inputPath, format: sourceFormat },
      warnings: extracted.warnings,
      manifestPath: extracted.manifestPath,
    };
  }

  if (sourceFormat === "md") {
    return await convertMarkdown(
      deps,
      input,
      scope,
      inputPath,
      bytes,
      input.targetFormat,
    );
  }

  return await convertDocxToPdf(deps, input, scope, inputPath, bytes);
}

/** Markdown input: the create pipeline is the route, so nothing is duplicated. */
async function convertMarkdown(
  deps: DocumentRuntimeDeps,
  input: DocumentConvertInput,
  scope: Awaited<ReturnType<typeof resolveDocumentScope>>,
  inputPath: string,
  bytes: Buffer,
  target: CreateFormat,
): Promise<DocumentConvertResult> {
  const content = bytes.toString("utf8");
  const created = await createDocument(
    deps,
    {
      content,
      formats: [target],
      ...(input.template === undefined ? {} : { template: input.template }),
      filename:
        input.filename ?? path.basename(inputPath).replace(/\.[^.]+$/u, ""),
      ...(input.options?.pdfMode === undefined
        ? {}
        : { options: { pdfMode: input.options.pdfMode } }),
    },
    { ...scope },
  );
  return {
    artifactId: created.artifactId,
    files: created.files,
    source: { path: inputPath, format: "md" },
    warnings: created.warnings,
    manifestPath: created.manifestPath,
  };
}

/** DOCX input, PDF output: render nothing, convert the document as it is. */
async function convertDocxToPdf(
  deps: DocumentRuntimeDeps,
  input: DocumentConvertInput,
  scope: Awaited<ReturnType<typeof resolveDocumentScope>>,
  inputPath: string,
  bytes: Buffer,
): Promise<DocumentConvertResult> {
  const config = deps.config;
  await ensureArtifactRoot(scope);
  const { artifactId, dir: artifactDir } = await scope.store.create(
    deps.now().getTime(),
  );
  const stem = (
    input.filename ?? path.basename(inputPath).replace(/\.[^.]+$/u, "")
  )
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  const outputFile = `${stem === "" ? "document" : stem}.pdf`;
  const spec: CacheSpec = {
    inputSha256: sha256Hex(bytes),
    inputFilename: path.basename(inputPath),
  };
  const cache = await createCache(deps, scope.store, {
    sourceFormat: "docx",
    targetFormat: "pdf",
    inputSha256: spec.inputSha256,
    inputFilename: spec.inputFilename,
    providers: [
      {
        role: "convert",
        name: deps.providers.converter.name,
        instance: deps.providers.converter,
      },
    ],
  });
  const cached = await cache?.lookup(artifactId, () => outputFile);
  if (cached !== undefined) {
    const files = cached.outputs.map((output) => ({
      format: "pdf" as const,
      path: output.path,
      mediaType: output.mediaType,
      size: output.size,
      sha256: output.sha256,
      status: "created" as const,
    }));
    const manifestPath = await writeCacheManifest({
      deps,
      scope,
      artifactId,
      operation: "document_convert",
      inputPath,
      bytes,
      files,
      warnings: cached.warnings,
      backends: Object.fromEntries(
        cached.backends.map((backend) => [backend.role, backend]),
      ),
      sourceArtifactId: cached.sourceArtifactId,
    });
    return {
      artifactId,
      files,
      source: { path: inputPath, format: "docx" },
      warnings: cached.warnings,
      manifestPath,
    };
  }

  const workDir = await scope.store.createWorkDir(artifactId);
  const warnings: DocumentWarning[] = [];
  try {
    if (config.storage.retainInputs) {
      await scope.store.write(
        path.join(artifactId, "input", path.basename(inputPath)),
        bytes,
      );
    }
    const outputPath = path.join(artifactDir, outputFile);
    const converted = await withRenderSlot(
      deps,
      scope.signal,
      async () =>
        await deps.providers.converter.convert({
          inputPath,
          outputPath,
          workDir,
          ...(scope.signal === undefined ? {} : { signal: scope.signal }),
        }),
    );
    warnings.push(...converted.warnings);

    const file: DocumentFileResult = {
      format: "pdf",
      path: converted.path,
      mediaType: mediaTypeFor("pdf"),
      size: converted.size,
      sha256: converted.sha256,
      status: "created",
    };
    const manifest = buildManifest({
      artifactId,
      operation: "document_convert",
      createdAt: deps.now().toISOString(),
      input: {
        format: "docx",
        sha256: spec.inputSha256,
        filename: path.basename(inputPath),
        bytes: bytes.length,
      },
      outputs: [outputRecord(file)],
      backends: { convert: converted.backend },
      warnings,
      scope: {
        ...(scope.sessionId === undefined
          ? {}
          : { sessionId: scope.sessionId }),
        workspace: scope.workspaceRoot,
      },
    });
    const manifestPath = await writeManifest(scope.store, artifactId, manifest);
    await scope.store.removeWorkDir(workDir);

    deps.logger.info("documents.convert", {
      artifactId,
      from: "docx",
      to: "pdf",
      backend: converted.backend.provider,
      bytes: bytes.length,
      outBytes: converted.size,
      status: "ok",
    });

    await cache?.remember({
      outputs: [
        {
          role: "convert",
          artifactId,
          outputName: path.basename(converted.path),
          format: "pdf",
          path: converted.path,
          mediaType: mediaTypeFor("pdf"),
          sha256: converted.sha256,
        },
      ],
      warnings,
      backends: { convert: converted.backend },
    });
    return {
      artifactId,
      files: [file],
      source: { path: inputPath, format: "docx" },
      warnings,
      manifestPath,
    };
  } catch (error) {
    await scope.store.removeWorkDir(workDir);
    throw asDocumentError(error, "CONVERSION_FAILED");
  }
}

/** A cache handle for one request, or `undefined` when caching is off. */
async function createCache(
  deps: DocumentRuntimeDeps,
  store: Awaited<ReturnType<typeof resolveDocumentScope>>["store"],
  request: ConversionRequest,
): Promise<
  Awaited<ReturnType<ConversionCache["beginConversion"]>> | undefined
> {
  if (!deps.config.cache.enabled) return undefined;
  const cache = new ConversionCache({
    config: deps.config,
    store,
    logger: deps.logger,
    now: deps.now,
  });
  return await cache.beginConversion(request);
}

async function writeCacheManifest(options: {
  readonly deps: DocumentRuntimeDeps;
  readonly scope: Awaited<ReturnType<typeof resolveDocumentScope>>;
  readonly artifactId: string;
  readonly operation: "document_convert";
  readonly inputPath: string;
  readonly bytes: Buffer;
  readonly files: readonly DocumentFileResult[];
  readonly warnings: readonly DocumentWarning[];
  readonly backends: Readonly<
    Record<string, { readonly provider: string; readonly version?: string }>
  >;
  readonly sourceArtifactId: string | undefined;
}): Promise<string> {
  const manifest = buildManifest({
    artifactId: options.artifactId,
    operation: options.operation,
    createdAt: options.deps.now().toISOString(),
    input: {
      format: "docx",
      sha256: sha256Hex(options.bytes),
      filename: path.basename(options.inputPath),
      bytes: options.bytes.length,
    },
    outputs: options.files.map(outputRecord),
    backends: options.backends,
    warnings: options.warnings,
    scope: {
      ...(options.scope.sessionId === undefined
        ? {}
        : { sessionId: options.scope.sessionId }),
      workspace: options.scope.workspaceRoot,
    },
    cache: {
      hit: true,
      ...(options.sourceArtifactId === undefined
        ? {}
        : { sourceArtifactId: options.sourceArtifactId }),
    },
  });
  return await writeManifest(options.scope.store, options.artifactId, manifest);
}
