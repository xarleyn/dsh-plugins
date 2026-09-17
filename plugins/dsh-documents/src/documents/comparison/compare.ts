/**
 * `document_compare` orchestration (§5, §6, §25, §29).
 *
 * The pipeline in one function: resolve both sides, refuse what cannot be
 * compared, extract each side into the canonical IR, diff the two IRs, write
 * the artifact and answer with a bounded preview. Everything expensive has a
 * cap, everything refused has a code, and there is no branch anywhere in here
 * that shells out or asks a model.
 */

import path from "node:path";

import { readManifest } from "../artifacts/manifest.js";
import { isDocumentArtifactId } from "../artifacts/ids.js";
import { sha256Hex } from "../artifacts/store.js";
import type { ArtifactStore } from "../artifacts/store.js";
import { DocumentError, asDocumentError } from "../errors.js";
import type { DocumentWarning } from "../types.js";
import {
  describeUnsupported,
  sniffDocument,
  supportedFormatOf,
  type SniffedDocument,
} from "../security/file-types.js";
import { readPdfFacts } from "../inspect/facts.js";
import { extractWithFallback, selectExtractor } from "../providers/registry.js";
import {
  ensureArtifactRoot,
  readInputBytes,
  resolveDocumentScope,
  resolveInputPath,
  type DocumentScope,
  type ResolvedDocumentScope,
} from "../orchestrator/scope.js";
import {
  withExtractionSlot,
  type DocumentRuntimeDeps,
} from "../orchestrator/runtime-deps.js";
import {
  buildCanonicalDocument,
  DOCUMENT_PART_ORDER,
  EXTRACTION_LEVEL_OF,
  type CanonicalDocument,
  type DocumentPart,
  type ExtractionLevel,
} from "./canonical/document-ir.js";
import { diffDocuments } from "./diff/block-diff.js";
import { writeComparisonArtifact } from "./artifact/writer.js";
import { PdfStructuredExtractor } from "./extractors/pdf.js";
import { DocxStructuredExtractor } from "./extractors/docx.js";
import {
  MarkdownStructuredExtractor,
  PlainTextStructuredExtractor,
} from "./extractors/markdown.js";
import type { StructuredDocumentExtractor } from "./extractors/extractor.js";
import { buildComparisonPreview } from "./report.js";
import type { ResolvedComparisonConfig } from "./config.js";
import type {
  ComparisonMode,
  ComparisonOptions,
  ComparisonQuality,
  ComparisonScope,
  ComparisonSummary,
  DocumentCompareInput,
  DocumentCompareResult,
  DocumentReference,
  DocumentWarningLike,
} from "./types.js";

const CROSS_FORMAT_REASON = "cross-format comparison";
const OCR_REASON = "text was extracted with OCR";

interface EffectiveOptions {
  readonly scope: ComparisonScope;
  readonly options: Required<ComparisonOptions>;
}

/**
 * The conservative defaults of `mode: contract` (§5.1): everything that can be
 * read is read, whitespace and formatting noise is folded away, and nothing
 * that could hide a meaning — case, punctuation, numbers — is normalized.
 */
export function resolveComparisonOptions(
  config: ResolvedComparisonConfig,
  input: {
    readonly mode?: ComparisonMode;
    readonly scope?: ComparisonScope;
    readonly options?: ComparisonOptions;
  },
): EffectiveOptions {
  const mode = input.mode ?? config.defaultMode;
  const contract = mode === "contract";
  const defaults: Required<ComparisonOptions> = {
    detectMoves: config.detectMoves,
    includeHeaders: contract ? true : config.includeHeaders,
    includeFooters: contract ? true : config.includeFooters,
    includeFootnotes: contract ? true : config.includeFootnotes,
    includeComments: config.includeComments,
    ignoreWhitespace: contract ? true : config.ignoreWhitespace,
    ignoreFormatting: contract ? true : config.ignoreFormatting,
  };
  const options: Required<ComparisonOptions> = {
    detectMoves: input.options?.detectMoves ?? defaults.detectMoves,
    includeHeaders: input.options?.includeHeaders ?? defaults.includeHeaders,
    includeFooters: input.options?.includeFooters ?? defaults.includeFooters,
    includeFootnotes:
      input.options?.includeFootnotes ?? defaults.includeFootnotes,
    includeComments: input.options?.includeComments ?? defaults.includeComments,
    ignoreWhitespace:
      input.options?.ignoreWhitespace ?? defaults.ignoreWhitespace,
    ignoreFormatting:
      input.options?.ignoreFormatting ?? defaults.ignoreFormatting,
  };
  return {
    scope: input.scope ?? (contract ? "all" : "body"),
    options,
  };
}

/** Which document parts take part, from the scope and the options (§5.1). */
export function selectedParts(effective: EffectiveOptions): DocumentPart[] {
  const parts: DocumentPart[] = ["body"];
  if (effective.scope === "all") {
    if (effective.options.includeHeaders) parts.push("header");
    if (effective.options.includeFooters) parts.push("footer");
    if (effective.options.includeFootnotes) parts.push("footnote");
    if (effective.options.includeComments) parts.push("comment");
  }
  return DOCUMENT_PART_ORDER.filter((part) => parts.includes(part));
}

/** Keep only the selected parts; node ids and per-part indices are unchanged. */
export function filterDocument(
  document: CanonicalDocument,
  parts: readonly DocumentPart[],
): CanonicalDocument {
  if (parts.length === DOCUMENT_PART_ORDER.length) return document;
  const selected = new Set(parts);
  return buildCanonicalDocument({
    kind: document.kind,
    extractor: document.extractor,
    ocrUsed: document.ocrUsed,
    nodes: document.nodes.filter((node) => selected.has(node.part)),
    warnings: document.warnings,
  });
}

class ComparisonBudget {
  private readonly deadline: number;

  constructor(
    timeoutMs: number,
    private readonly now: () => number,
  ) {
    this.deadline = now() + timeoutMs;
  }

  check(): void {
    if (this.now() > this.deadline) {
      throw new DocumentError(
        "COMPARE_TIMEOUT",
        "the comparison exceeded its configured time budget",
      );
    }
  }
}

interface LoadedSide {
  readonly filename: string;
  readonly path: string;
  readonly bytes: Buffer;
  readonly sha256: string;
  readonly sniffed: SniffedDocument;
  readonly format: "md" | "docx" | "pdf";
  readonly extension: string;
}

export async function compareDocuments(
  deps: DocumentRuntimeDeps,
  input: DocumentCompareInput,
  scopeInput: DocumentScope,
): Promise<DocumentCompareResult> {
  const config = deps.config;
  const comparison = config.comparison;
  const started = Date.now();
  const budget = new ComparisonBudget(comparison.timeoutMs, () =>
    deps.now().getTime(),
  );
  const scope = await resolveDocumentScope(config, scopeInput);
  await ensureArtifactRoot(scope);
  const effective = resolveComparisonOptions(comparison, input);
  const parts = selectedParts(effective);

  try {
    const left = await loadSide(deps, scope, input.left, comparison, "left");
    const right = await loadSide(deps, scope, input.right, comparison, "right");
    budget.check();

    const { artifactId } = await scope.store.create(
      deps.now().getTime(),
      "comparison",
    );
    const workDir = await scope.store.createWorkDir(artifactId);
    try {
      const leftDocument = await extractSide(
        deps,
        scope,
        workDir,
        comparison,
        left,
        effective,
        budget,
      );
      const rightDocument = await extractSide(
        deps,
        scope,
        workDir,
        comparison,
        right,
        effective,
        budget,
      );
      assertUnextractable(leftDocument, left.filename);
      assertUnextractable(rightDocument, right.filename);

      const filteredLeft = filterDocument(leftDocument, parts);
      const filteredRight = filterDocument(rightDocument, parts);
      const quality = assessQuality(leftDocument, rightDocument);
      budget.check();

      const changes = diffDocuments(filteredLeft, filteredRight, {
        leftSha: left.sha256,
        rightSha: right.sha256,
        detectMoves: effective.options.detectMoves,
        ignoreWhitespace: effective.options.ignoreWhitespace,
        ignoreFormatting: effective.options.ignoreFormatting,
        confidence: confidenceOf(quality.level),
        checkBudget: () => budget.check(),
      });
      if (changes.length > comparison.maxChanges) {
        throw new DocumentError(
          "COMPARE_DIFF_LIMIT_EXCEEDED",
          `the comparison produced ${changes.length} changes; the configured limit is ${comparison.maxChanges}`,
          {
            details: {
              changes: changes.length,
              maxChanges: comparison.maxChanges,
            },
          },
        );
      }

      const summary = summarize(changes);
      const warnings = collectWarnings(leftDocument, rightDocument);
      const written = await writeComparisonArtifact({
        store: scope.store,
        comparisonId: artifactId,
        createdAt: deps.now().toISOString(),
        left: {
          filename: left.filename,
          sha256: left.sha256,
          format: left.format,
          extension: left.extension,
          rawBytes: left.bytes,
          document: leftDocument,
        },
        right: {
          filename: right.filename,
          sha256: right.sha256,
          format: right.format,
          extension: right.extension,
          rawBytes: right.bytes,
          document: rightDocument,
        },
        options: effective.options,
        quality,
        summary,
        changes,
        retainInputs: config.storage.retainInputs,
        retainNormalized: comparison.retainNormalizedDocuments,
        scope: {
          ...(scope.sessionId === undefined
            ? {}
            : { sessionId: scope.sessionId }),
          workspace: scope.workspaceRoot,
        },
        warnings,
      });
      await scope.store.removeWorkDir(workDir);

      deps.logger.info("documents.compare", {
        comparisonId: artifactId,
        leftChars: left.bytes.length,
        rightChars: right.bytes.length,
        leftNodes: filteredLeft.counts.nodes,
        rightNodes: filteredRight.counts.nodes,
        changes: changes.length,
        quality: quality.level,
        durationMs: Date.now() - started,
        status: "ok",
      });

      const preview = buildComparisonPreview(
        changes,
        comparison.inlineChanges,
        comparison.inlineTextCharsPerChange,
      );
      return {
        comparisonId: artifactId,
        status: "completed",
        left: {
          name: left.filename,
          sha256: left.sha256,
          format: left.format,
          nodes: leftDocument.counts.nodes,
        },
        right: {
          name: right.filename,
          sha256: right.sha256,
          format: right.format,
          nodes: rightDocument.counts.nodes,
        },
        quality,
        summary,
        preview,
        previewTruncated: changes.length > preview.length,
        changesPath: written.changesPath,
        reportPath: written.reportPath,
        manifestPath: written.manifestPath,
        warnings: toWarningShapes(warnings),
      };
    } catch (error) {
      await scope.store.removeWorkDir(workDir);
      throw error;
    }
  } catch (error) {
    const failure = asDocumentError(error, "COMPARE_PARSE_FAILED");
    deps.logger.error("documents.compare.failed", {
      code: failure.code,
      durationMs: Date.now() - started,
    });
    throw failure;
  }
}

/* ------------------------------------------------------------------ sides */

async function loadSide(
  deps: DocumentRuntimeDeps,
  scope: ResolvedDocumentScope,
  reference: DocumentReference,
  comparison: ResolvedComparisonConfig,
  label: "left" | "right",
): Promise<LoadedSide> {
  const resolved = await resolveSideSource(deps, scope, reference, label);
  const bytes = await readInputBytes(resolved.path, deps.config, label);
  if (bytes.length > comparison.maxInputBytes) {
    throw new DocumentError(
      "COMPARE_INPUT_TOO_LARGE",
      `the ${label} document is ${bytes.length} bytes; the configured comparison limit is ${comparison.maxInputBytes}`,
      {
        details: {
          bytes: bytes.length,
          maxInputBytes: comparison.maxInputBytes,
        },
      },
    );
  }
  const sniffed = sniffDocument(bytes, resolved.path);
  assertComparable(sniffed, resolved.path, bytes);
  const format = supportedFormatOf(sniffed);
  if (format === undefined) {
    throw new DocumentError(
      "COMPARE_UNSUPPORTED_FORMAT",
      describeUnsupported(sniffed, resolved.path),
    );
  }
  return {
    filename: path.basename(resolved.path),
    path: resolved.path,
    bytes,
    sha256: sha256Hex(bytes),
    sniffed,
    format,
    extension: resolved.extension,
  };
}

function assertComparable(
  sniffed: SniffedDocument,
  filePath: string,
  bytes: Buffer,
): void {
  if (sniffed.format === "docm") {
    throw new DocumentError(
      "MACRO_ENABLED_DOCUMENT",
      `"${path.basename(filePath)}" is a macro-enabled document; macro-enabled documents are not compared`,
    );
  }
  if (sniffed.mediaType === "application/x-ole-storage") {
    // An encrypted OOXML package is a CFB container, not a ZIP one.
    throw new DocumentError(
      "COMPARE_ENCRYPTED_DOCUMENT",
      `"${path.basename(filePath)}" is a password-protected document; encrypted documents are not compared`,
    );
  }
  if (sniffed.format === "pdf" && readPdfFacts(bytes).encrypted) {
    throw new DocumentError(
      "COMPARE_ENCRYPTED_DOCUMENT",
      `"${path.basename(filePath)}" is an encrypted PDF; password-protected documents are not compared`,
    );
  }
  if (sniffed.format === "unknown") {
    throw new DocumentError(
      "COMPARE_UNSUPPORTED_FORMAT",
      describeUnsupported(sniffed, filePath),
    );
  }
}

/**
 * A side may be a path in the session scope or a document artifact. An
 * artifact reference resolves to what the artifact is *about*: the input it
 * retained if there is one, otherwise the file it produced.
 */
async function resolveSideSource(
  deps: DocumentRuntimeDeps,
  scope: ResolvedDocumentScope,
  reference: DocumentReference,
  label: string,
): Promise<{ readonly path: string; readonly extension: string }> {
  const hasPath = typeof reference.path === "string" && reference.path !== "";
  const hasArtifact =
    typeof reference.artifactId === "string" && reference.artifactId !== "";
  if (hasPath === hasArtifact) {
    throw new DocumentError(
      "INVALID_INPUT",
      `the ${label} document must be named by exactly one of path or artifactId`,
    );
  }
  if (hasPath) {
    const resolved = await resolveInputPath(
      deps.config,
      scope,
      reference.path as string,
      `${label} document`,
    );
    return { path: resolved, extension: extensionOf(resolved) };
  }
  const artifactId = reference.artifactId as string;
  if (!isDocumentArtifactId(artifactId)) {
    throw new DocumentError(
      "COMPARE_ARTIFACT_NOT_FOUND",
      `"${artifactId}" is not a document artifact id`,
    );
  }
  const found = await primaryFileOf(scope.store, artifactId);
  return { path: found.path, extension: extensionOf(found.path) };
}

async function primaryFileOf(
  store: ArtifactStore,
  artifactId: string,
): Promise<{ readonly path: string }> {
  const manifest = await readManifest(store, artifactId).catch(
    (error: unknown) => {
      throw new DocumentError(
        "COMPARE_ARTIFACT_NOT_FOUND",
        `the artifact ${artifactId} was not found in this session's artifact root`,
        { cause: error },
      );
    },
  );
  const retained =
    manifest.input.filename === undefined
      ? undefined
      : path.join(artifactId, "input", manifest.input.filename);
  if (retained !== undefined && (await store.exists(retained))) {
    return { path: store.path(retained) };
  }
  const produced = manifest.outputs.find(
    (output) => output.status === "created",
  );
  if (produced !== undefined) {
    const candidate = path.join(artifactId, produced.path);
    if (await store.exists(candidate)) return { path: store.path(candidate) };
  }
  throw new DocumentError(
    "COMPARE_ARTIFACT_NOT_FOUND",
    `the artifact ${artifactId} kept neither its input nor its output, so there is nothing to compare`,
  );
}

function extensionOf(filePath: string): string {
  const extension = path.extname(filePath).replace(/^\./u, "").toLowerCase();
  return extension === "" ? "bin" : extension.slice(0, 8);
}

/* -------------------------------------------------------------- extraction */

async function extractSide(
  deps: DocumentRuntimeDeps,
  scope: ResolvedDocumentScope,
  workDir: string,
  comparison: ResolvedComparisonConfig,
  side: LoadedSide,
  effective: EffectiveOptions,
  budget: ComparisonBudget,
): Promise<CanonicalDocument> {
  budget.check();
  const extractor = selectStructuredExtractor(deps, scope, workDir, side);
  const document = await extractor.extract({
    filename: side.filename,
    inputPath: side.path,
    bytes: side.bytes,
    ignoreFormatting: effective.options.ignoreFormatting,
    maxNodes: comparison.maxNodes,
    maxUncompressedBytes: comparison.maxUncompressedBytes,
    ...(scope.signal === undefined ? {} : { signal: scope.signal }),
  });
  budget.check();
  return document;
}

function selectStructuredExtractor(
  deps: DocumentRuntimeDeps,
  scope: ResolvedDocumentScope,
  workDir: string,
  side: LoadedSide,
): StructuredDocumentExtractor {
  const extension = side.extension;
  switch (side.format) {
    case "docx":
      return new DocxStructuredExtractor();
    case "pdf":
      return new PdfStructuredExtractor(async ({ inputPath, signal }) => {
        const selection = selectExtractor(
          deps.providers,
          deps.config,
          deps.config.extraction.defaultMode,
          "pdf",
        );
        const assetsDir = await scope.store.ensureDir(
          path.join(path.relative(scope.store.root, workDir), "assets"),
        );
        const extracted = await withExtractionSlot(
          deps,
          signal,
          async () =>
            await extractWithFallback(selection, {
              inputPath,
              workDir,
              assetsDir,
              ocr: deps.config.extraction.ocr,
              ocrLanguages: deps.config.extraction.ocrLanguages,
              extractImages: false,
              extractTables: deps.config.extraction.extractTables,
              preservePageMarkers: false,
              maxPages: deps.config.limits.maxPages,
              maxImages: 0,
              ...(signal === undefined ? {} : { signal }),
            }),
        );
        return {
          markdown: extracted.document.markdown,
          backend: extracted.document.backend.provider,
          ocrUsed: extracted.document.warnings.some(
            (warning) => warning.code === "OCR_USED",
          ),
          ...(extracted.document.pages === undefined
            ? {}
            : { pages: extracted.document.pages }),
          warnings: extracted.document.warnings,
        };
      });
    case "md":
      return extension === "txt"
        ? new PlainTextStructuredExtractor()
        : new MarkdownStructuredExtractor();
    default:
      throw new DocumentError(
        "COMPARE_UNSUPPORTED_FORMAT",
        `the ${side.filename} format is not supported by the comparison`,
      );
  }
}

function assertUnextractable(
  document: CanonicalDocument,
  filename: string,
): void {
  if (document.counts.nodes > 0) return;
  throw new DocumentError(
    "COMPARE_LOW_EXTRACTION_QUALITY",
    `no text could be extracted from "${filename}"; a comparison of empty texts would say nothing`,
    { details: { filename, extractor: document.extractor } },
  );
}

/* ----------------------------------------------------------------- quality */

export function assessQuality(
  left: CanonicalDocument,
  right: CanonicalDocument,
): ComparisonQuality {
  const reasons: string[] = [];
  const leftLevel = EXTRACTION_LEVEL_OF[left.kind];
  const rightLevel = EXTRACTION_LEVEL_OF[right.kind];
  let level: ExtractionLevel =
    leftLevel === "low" || rightLevel === "low"
      ? "low"
      : leftLevel === "medium" || rightLevel === "medium"
        ? "medium"
        : "high";
  const ocrUsed = left.ocrUsed || right.ocrUsed;
  if (left.kind !== right.kind) {
    // Two formats reached the IR by different routes; the texts are comparable
    // but no longer the same artifact of the same parser.
    reasons.push(CROSS_FORMAT_REASON);
    level = "low";
  }
  if (ocrUsed) {
    reasons.push(OCR_REASON);
    level = "low";
  }
  return {
    level,
    leftExtraction: left.extractor,
    rightExtraction: right.extractor,
    ocrUsed,
    reasons,
  };
}

function confidenceOf(level: ComparisonQuality["level"]): number {
  if (level === "high") return 1;
  if (level === "medium") return 0.85;
  return 0.6;
}

/* --------------------------------------------------------------- summaries */

export function summarize(
  changes: readonly {
    readonly kind: string;
    readonly left?: { readonly headingPath: readonly string[] };
    readonly right?: { readonly headingPath: readonly string[] };
  }[],
): ComparisonSummary {
  let insertions = 0;
  let deletions = 0;
  let replacements = 0;
  let moves = 0;
  const sections = new Set<string>();
  for (const change of changes) {
    if (change.kind === "insert") insertions += 1;
    else if (change.kind === "delete") deletions += 1;
    else if (change.kind === "replace") replacements += 1;
    else if (change.kind === "move") moves += 1;
    const path = change.right?.headingPath ?? change.left?.headingPath ?? [];
    sections.add(path.length === 0 ? "(body)" : path.join(" › "));
  }
  return {
    insertions,
    deletions,
    replacements,
    moves,
    affectedSections: sections.size,
    total: changes.length,
  };
}

function collectWarnings(
  left: CanonicalDocument,
  right: CanonicalDocument,
): DocumentWarning[] {
  const seen = new Set<string>();
  const warnings: DocumentWarning[] = [];
  for (const warning of [...left.warnings, ...right.warnings]) {
    const key = `${warning.code}\u0000${warning.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    warnings.push(warning);
  }
  return warnings;
}

function toWarningShapes(
  warnings: readonly DocumentWarning[],
): DocumentWarningLike[] {
  return warnings.map((warning) => ({
    code: warning.code,
    message: warning.message,
    ...(warning.backend === undefined ? {} : { backend: warning.backend }),
  }));
}
