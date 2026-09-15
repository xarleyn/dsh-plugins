/**
 * `document_create` orchestration (§8, §13, §14, §45).
 *
 * Markdown in, DOCX and/or PDF out, with the source, the assets and a manifest
 * kept beside the results. The orchestration is where the pipeline's promises
 * are actually kept:
 *
 * - the caller picks intent (formats, template name, pdf mode), never a
 *   command line;
 * - a failure of the second format does not discard the first — partial
 *   success is returned with a warning (§45);
 * - every produced file is fingerprinted and recorded in the manifest.
 */

import path from "node:path";

import { sha256Hex, sha256OfFile } from "../artifacts/store.js";
import {
  buildManifest,
  outputRecord,
  writeManifest,
} from "../artifacts/manifest.js";
import { DocumentError, asDocumentError } from "../errors.js";
import { applyDirectives } from "../markdown/directives.js";
import { parseFrontMatter } from "../markdown/frontmatter.js";
import { selectPdfMode } from "../providers/registry.js";
import { assertCharsWithinBudget } from "../security/limits.js";
import { sanitizeFilename } from "../security/paths.js";
import { resolveTemplate } from "../templates/resolver.js";
import type {
  CreateFormat,
  DocumentCreateInput,
  DocumentCreateResult,
  DocumentFileResult,
  DocumentWarning,
} from "../types.js";
import {
  auditAssetReferences,
  prepareAssets,
  rewriteAssetReferences,
} from "./assets.js";
import {
  allowedInputRoots,
  ensureArtifactRoot,
  resolveDocumentScope,
  type DocumentScope,
} from "./scope.js";
import { withRenderSlot, type DocumentRuntimeDeps } from "./runtime-deps.js";

const ARTIFACT_ID_SHORT_CHARS = 10;

function validateFormats(
  formats: readonly CreateFormat[] | undefined,
  allowed: readonly CreateFormat[],
): CreateFormat[] {
  if (!Array.isArray(formats) || formats.length === 0) {
    throw new DocumentError(
      "INVALID_INPUT",
      "formats must list at least one of: docx, pdf",
    );
  }
  const unique: CreateFormat[] = [];
  for (const format of formats) {
    if (format !== "docx" && format !== "pdf") {
      throw new DocumentError(
        "UNSUPPORTED_FORMAT",
        `"${String(format)}" is not a creatable format`,
      );
    }
    if (!allowed.includes(format)) {
      throw new DocumentError(
        "UNSUPPORTED_FORMAT",
        `this deployment does not create ${format.toUpperCase()} documents`,
        { details: { format, allowed } },
      );
    }
    if (!unique.includes(format)) unique.push(format);
  }
  return unique;
}

export async function createDocument(
  deps: DocumentRuntimeDeps,
  input: DocumentCreateInput,
  scopeInput: DocumentScope,
): Promise<DocumentCreateResult> {
  const config = deps.config;
  const started = Date.now();
  const formats = validateFormats(input.formats, config.create.allowFormats);
  if (typeof input.content !== "string" || input.content.trim() === "") {
    throw new DocumentError(
      "INVALID_INPUT",
      "content must be non-empty Markdown",
    );
  }
  assertCharsWithinBudget(
    input.content.length,
    config.limits.maxMarkdownChars,
    "content",
  );

  const scope = await resolveDocumentScope(config, scopeInput);
  const signals = scope.signal === undefined ? {} : { signal: scope.signal };
  await ensureArtifactRoot(scope);
  const { artifactId, dir: artifactDir } = await scope.store.create(
    deps.now().getTime(),
  );
  const workDir = await scope.store.createWorkDir(artifactId);
  const warnings: DocumentWarning[] = [];

  try {
    const resolution = resolveTemplate(
      scope.templates,
      input.template,
      config.templates.default,
    );
    warnings.push(...scope.templates.warnings, ...resolution.warnings);

    const frontMatter = parseFrontMatter(input.content);
    const metadata: Record<string, string> = {
      ...frontMatter.attributes,
      ...(input.metadata ?? {}),
    };
    const title = input.title ?? metadata["title"];
    const toc = input.options?.toc ?? config.create.toc;
    const retainSource =
      input.options?.preserveSource ?? config.storage.retainSource;
    const pdfModeRequested =
      input.options?.pdfMode ?? config.create.defaultPdfMode;
    const templateHasTypst = resolution.resolved.template?.typst !== undefined;
    const wantsPdf = formats.includes("pdf");
    const pdfMode = wantsPdf
      ? selectPdfMode({
          requested: pdfModeRequested,
          formats,
          templateHasTypst,
          typstEnabled: config.typst.enabled,
        })
      : "office";
    if (
      pdfMode === "office" &&
      resolution.resolved.template?.docx === undefined &&
      input.template !== undefined
    ) {
      warnings.push({
        code: "TEMPLATE_DEFAULTED",
        message: `template "${resolution.resolved.name}" declares no DOCX layout; the backend's own defaults are in use`,
        details: { template: resolution.resolved.name },
      });
    }

    const directed = applyDirectives(frontMatter.body, {
      backend:
        pdfMode === "typst" && !formats.includes("docx") ? "typst" : "docx",
      allowRawMarkup: config.create.allowRawMarkup,
    });
    warnings.push(...directed.warnings);

    const assetsDir = await scope.store.ensureDir(
      path.join(artifactId, "assets"),
    );
    const prepared = await prepareAssets(input.assets, {
      config,
      scope,
      assetsDir,
    });
    warnings.push(...prepared.warnings);
    const markdown = rewriteAssetReferences(
      directed.markdown,
      prepared.assets,
      {
        roots: allowedInputRoots(config, scope),
      },
    );
    await auditAssetReferences(markdown, {
      assetsDir,
      assets: prepared.assets,
    });

    const sourcePath = path.join(
      retainSource ? artifactDir : workDir,
      "source.md",
    );
    const sourceBytes = Buffer.from(markdown, "utf8");
    await scope.store.write(
      path.relative(scope.artifactRoot, sourcePath),
      sourceBytes,
    );

    const stem = sanitizeFilename(
      input.filename,
      `document-${artifactId.slice(-ARTIFACT_ID_SHORT_CHARS).toLowerCase()}`,
      "",
    );
    const outputs: DocumentFileResult[] = [];
    const backends: Record<string, { provider: string; version?: string }> = {};

    const docxTarget = formats.includes("docx")
      ? path.join(artifactDir, `${stem}.docx`)
      : path.join(workDir, "intermediate.docx");

    let docxRendered:
      | {
          readonly path: string;
          readonly size: number;
          readonly sha256: string;
        }
      | undefined;
    // The office route needs the DOCX as its intermediate; the Typst route
    // renders the Markdown directly, so it must not pay for a DOCX nobody sees.
    if (formats.includes("docx") || pdfMode === "office") {
      const rendered = await withRenderSlot(
        deps,
        scope.signal,
        async () =>
          await deps.providers.docx.render({
            sourcePath,
            outputPath: docxTarget,
            workDir,
            assetsDir,
            ...(resolution.resolved.template?.docx === undefined
              ? {}
              : { referenceDocPath: resolution.resolved.template.docx }),
            templateName: resolution.resolved.name,
            ...(title === undefined ? {} : { title }),
            ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
            toc,
            ...signals,
          }),
      );
      docxRendered = rendered;
      backends["docx"] = rendered.backend;
      warnings.push(...rendered.warnings);
      if (formats.includes("docx")) {
        outputs.push(createdFile("docx", rendered));
      }
    }

    if (wantsPdf) {
      try {
        const pdfPath = path.join(artifactDir, `${stem}.pdf`);
        const rendered = await withRenderSlot(deps, scope.signal, async () => {
          if (pdfMode === "typst") {
            const typst = deps.providers.typstPdf;
            if (typst === undefined) {
              throw new DocumentError(
                "BACKEND_UNAVAILABLE",
                "the Typst PDF route is not enabled in this deployment",
                { backend: "typst" },
              );
            }
            return await typst.render({
              sourcePath,
              outputPath: pdfPath,
              workDir,
              assetsDir,
              templateName: resolution.resolved.name,
              ...(resolution.resolved.template?.typst === undefined
                ? {}
                : { typstTemplateDir: resolution.resolved.template.typst }),
              ...(input.options?.pageSize === undefined
                ? {}
                : { pageSize: input.options.pageSize }),
              ...(title === undefined ? {} : { title }),
              ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
              toc,
              ...signals,
            });
          }
          const converter = deps.providers.converter;
          const docxPath = docxRendered?.path ?? docxTarget;
          const converted = await converter.convert({
            inputPath: docxPath,
            outputPath: pdfPath,
            workDir,
            ...signals,
          });
          return {
            path: converted.path,
            size: converted.size,
            sha256: converted.sha256,
            backend: converted.backend,
            warnings: converted.warnings,
          };
        });
        outputs.push(createdFile("pdf", rendered));
        backends["pdf"] = rendered.backend;
        warnings.push(...rendered.warnings);
        if (input.options?.pageSize !== undefined && formats.includes("docx")) {
          warnings.push({
            code: "PAGE_SIZE_NOT_APPLIED",
            message:
              "page size applies to the PDF layout only; DOCX page size comes from the template",
            details: { pageSize: input.options.pageSize },
          });
        }
      } catch (error) {
        const failure = asDocumentError(
          error,
          "CONVERSION_FAILED",
          "libreoffice",
        );
        if (outputs.length === 0) throw failure;
        warnings.push({
          code: "FORMAT_FAILED",
          message: `the PDF copy could not be produced: ${failure.message}`,
          details: { code: failure.code, retryable: failure.retryable },
        });
        outputs.push({
          format: "pdf",
          path: path.join(artifactDir, `${stem}.pdf`),
          mediaType: "application/pdf",
          size: 0,
          sha256: "",
          status: "failed",
          error: failure.code,
        });
      }
    }

    const created = outputs.filter((file) => file.status === "created");
    if (created.length === 0) {
      throw new DocumentError(
        "RENDER_FAILED",
        "no requested format could be produced",
        { details: { formats } },
      );
    }

    const templateSha256 =
      resolution.resolved.template?.docx === undefined
        ? undefined
        : await sha256OfFile(resolution.resolved.template.docx);

    const manifest = buildManifest({
      artifactId,
      operation: "document_create",
      createdAt: deps.now().toISOString(),
      input: {
        format: "md",
        sha256: sha256Hex(sourceBytes),
        bytes: sourceBytes.length,
      },
      outputs: outputs.map(outputRecord),
      ...(resolution.resolved.template === undefined &&
      input.template === undefined
        ? {}
        : { template: resolution.resolved.name }),
      ...(templateSha256 === undefined ? {} : { templateSha256 }),
      backends,
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

    deps.logger.info("documents.create", {
      artifactId,
      formats: formats.join(","),
      pdfMode: wantsPdf ? pdfMode : undefined,
      template: resolution.resolved.name,
      durationMs: Date.now() - started,
      bytes: created.reduce((total, file) => total + file.size, 0),
      status: warnings.some((warning) => warning.code === "FORMAT_FAILED")
        ? "partial"
        : "ok",
    });

    return {
      artifactId,
      ...(retainSource
        ? { source: { path: sourcePath, mediaType: "text/markdown" as const } }
        : {}),
      files: outputs,
      ...(resolution.resolved.template === undefined &&
      input.template === undefined
        ? {}
        : { template: resolution.resolved.name }),
      warnings,
      manifestPath,
    };
  } catch (error) {
    await scope.store.removeWorkDir(workDir);
    throw asDocumentError(error, "RENDER_FAILED");
  }
}

function createdFile(
  format: "docx" | "pdf",
  rendered: {
    readonly path: string;
    readonly size: number;
    readonly sha256: string;
  },
): DocumentFileResult {
  return {
    format,
    path: rendered.path,
    mediaType:
      format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: rendered.size,
    sha256: rendered.sha256,
    status: "created",
  };
}
