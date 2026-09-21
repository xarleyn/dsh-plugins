/**
 * Public types of the QA Surface document pipeline.
 *
 * The shapes here are the contract the agent sees (tool inputs and results),
 * the contract the artifact store persists (manifest), and the contract the
 * providers implement. They are deliberately free of any backend vocabulary:
 * a tool result never names pandoc, LibreOffice or Docling, so a provider can
 * be replaced without touching a prompt, a skill or a workflow
 * (docs/specs/document-pipeline.md §4.1, §22).
 */

/** Formats the pipeline can read and write. */
export type DocumentFormat = "md" | "docx" | "pdf";

/** Formats a document can be created in. */
export type CreateFormat = "docx" | "pdf";

/** PDF production route (§14). */
export type PdfMode = "office" | "typst" | "auto";

/** Extraction quality/route selector (§9). */
export type ExtractionMode = "auto" | "fast" | "accurate";

/** OCR policy (§15.2). */
export type OcrMode = "auto" | "off" | "force";

/** Structural classification of an inspected input (§11). */
export type DetectedFormat = "pdf" | "docx" | "docm" | "markdown" | "unknown";

/** Stable warning codes; a warning never turns a success into a failure (§25). */
export type DocumentWarningCode =
  | "OCR_USED"
  | "TABLE_EXTRACTION_DEGRADED"
  | "UNSUPPORTED_EMBEDDED_OBJECT"
  | "FONT_SUBSTITUTED"
  | "IMAGE_SKIPPED"
  | "PAGE_LIMIT_REACHED"
  | "METADATA_PARTIALLY_EXTRACTED"
  | "BACKEND_FALLBACK_USED"
  | "FORMAT_FAILED"
  | "MARKDOWN_TRUNCATED"
  | "PAGE_SIZE_NOT_APPLIED"
  | "ASSET_MISSING"
  | "SOURCE_NOT_RETAINED"
  | "TEMPLATE_DEFAULTED"
  /** Comparison: one side carries tracked revisions (§12). */
  | "TRACK_CHANGES_PRESENT"
  /** Comparison: the texts were matched but the extraction is lossy (§25). */
  | "COMPARISON_QUALITY_REDUCED";

export interface DocumentWarning {
  readonly code: DocumentWarningCode;
  readonly message: string;
  readonly backend?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/** One artifact file as reported to the agent. */
export interface DocumentFileResult {
  readonly format: CreateFormat | "md";
  /** Absolute path, inside the session workspace. */
  readonly path: string;
  readonly mediaType: string;
  readonly size: number;
  readonly sha256: string;
  readonly status: "created" | "failed";
  /** Present when `status` is `failed`; the format's own error code. */
  readonly error?: string;
}

export interface DocumentAssetInput {
  readonly id: string;
  /** Workspace-relative or absolute path inside the session scope. */
  readonly path?: string;
  /** Inline asset content: base64 data URI or raw base64. */
  readonly dataRef?: string;
  readonly filename?: string;
  readonly mimeType?: string;
}

export interface DocumentCreateOptions {
  readonly pdfMode?: PdfMode;
  readonly pageSize?: string;
  readonly locale?: string;
  readonly toc?: boolean;
  readonly preserveSource?: boolean;
}

export interface DocumentCreateInput {
  readonly content: string;
  readonly filename?: string;
  readonly formats: readonly CreateFormat[];
  readonly template?: string;
  readonly title?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly assets?: readonly DocumentAssetInput[];
  readonly options?: DocumentCreateOptions;
}

export interface DocumentCreateResult {
  readonly artifactId: string;
  readonly source?: {
    readonly path: string;
    readonly mediaType: "text/markdown";
  };
  readonly files: readonly DocumentFileResult[];
  readonly template?: string;
  readonly warnings: readonly DocumentWarning[];
  readonly manifestPath: string;
}

export interface DocumentToMarkdownInput {
  readonly file: string;
  readonly mode?: ExtractionMode;
  readonly ocr?: OcrMode;
  readonly ocrLanguages?: readonly string[];
  readonly extractImages?: boolean;
  readonly extractTables?: boolean;
  readonly preservePageMarkers?: boolean;
  readonly outputFilename?: string;
}

export interface DocumentToMarkdownResult {
  readonly artifactId: string;
  /** Extracted Markdown; truncated to the configured inline budget. */
  readonly markdown: string;
  readonly markdownPath: string;
  readonly assets?: readonly {
    readonly path: string;
    readonly mediaType: string;
  }[];
  readonly pages?: number;
  readonly backend: string;
  readonly warnings: readonly DocumentWarning[];
  readonly manifestPath: string;
}

/**
 * Fetch an online source (a wiki attachment, a text document behind an
 * authenticated provider) and keep what comes back as a document artifact.
 * Retrieval goes through the deployment's web provider, so the rules,
 * credentials, address policy and size caps of the fetch layer apply unchanged
 * — this tool never opens a socket of its own (§9, §34).
 */
export interface DocumentFromUrlInput {
  readonly url: string;
  /** Name of the stored Markdown inside the bundle. Default `source.md`. */
  readonly outputFilename?: string;
}

export interface DocumentFromUrlResult {
  readonly artifactId: string;
  /** Fetched text; truncated to the configured inline budget when longer. */
  readonly markdown: string;
  /** Path of the stored Markdown: the full text the fetch layer returned. */
  readonly markdownPath: string;
  readonly sourceUrl: string;
  readonly truncated: boolean;
  readonly backend: string;
  readonly warnings: readonly DocumentWarning[];
  readonly manifestPath: string;
}

export interface DocumentConvertInput {
  readonly file: string;
  readonly targetFormat: CreateFormat | "md";
  readonly template?: string;
  readonly filename?: string;
  /** Artifact name of the extracted Markdown when the target is `md`. */
  readonly outputFilename?: string;
  readonly options?: {
    readonly pdfMode?: PdfMode;
    readonly ocr?: OcrMode;
  };
}
export interface DocumentConvertResult {
  readonly artifactId: string;
  readonly files: readonly DocumentFileResult[];
  readonly source: { readonly path: string; readonly format: DocumentFormat };
  readonly warnings: readonly DocumentWarning[];
  readonly manifestPath: string;
}

export interface DocumentInspectInput {
  readonly file: string;
}

export interface DocumentInspectResult {
  readonly filename: string;
  readonly format: DetectedFormat;
  readonly mediaType: string;
  readonly size: number;
  readonly sha256: string;
  readonly metadata?: {
    readonly title?: string;
    readonly author?: string;
    readonly createdAt?: string;
    readonly modifiedAt?: string;
  };
  readonly structure?: {
    readonly pages?: number;
    readonly headings?: number;
    readonly tables?: number;
    readonly images?: number;
  };
  readonly encrypted?: boolean;
  readonly macroEnabled?: boolean;
  readonly warnings: readonly DocumentWarning[];
}

/** Identifies the backend that produced one output, for the manifest (§19). */
export interface BackendInfo {
  readonly provider: string;
  readonly version?: string;
}

/** Returned by providers that write a file. */
export interface RenderedArtifact {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
  readonly backend: BackendInfo;
  readonly warnings: readonly DocumentWarning[];
}

export interface RenderDocxInput {
  readonly sourcePath: string;
  readonly outputPath: string;
  readonly workDir: string;
  readonly assetsDir?: string;
  /** Reference DOCX resolved from a template, when the template has one. */
  readonly referenceDocPath?: string;
  readonly templateName?: string;
  readonly title?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly toc?: boolean;
  readonly locale?: string;
  readonly signal?: AbortSignal;
}

export interface RenderPdfInput {
  readonly sourcePath: string;
  readonly outputPath: string;
  readonly workDir: string;
  readonly assetsDir?: string;
  readonly templateName?: string;
  readonly typstTemplateDir?: string;
  readonly pageSize?: string;
  readonly title?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly toc?: boolean;
  readonly signal?: AbortSignal;
}

export interface ExtractInput {
  readonly inputPath: string;
  readonly workDir: string;
  /** Directory extracted images are written into, when extraction asks for them. */
  readonly assetsDir: string;
  readonly ocr: OcrMode;
  readonly ocrLanguages?: readonly string[];
  readonly extractImages: boolean;
  readonly extractTables: boolean;
  readonly preservePageMarkers: boolean;
  readonly maxPages?: number;
  readonly maxImages?: number;
  readonly signal?: AbortSignal;
}

export interface ExtractedDocument {
  readonly markdown: string;
  readonly assets: readonly {
    readonly path: string;
    readonly mediaType: string;
  }[];
  readonly pages?: number;
  readonly backend: BackendInfo;
  readonly warnings: readonly DocumentWarning[];
}

export interface ConvertPdfInput {
  readonly inputPath: string;
  readonly outputPath: string;
  readonly workDir: string;
  readonly signal?: AbortSignal;
}

export interface ConvertedDocument {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
  readonly backend: BackendInfo;
  readonly warnings: readonly DocumentWarning[];
}

/** §22 provider interfaces. A tool never imports a concrete implementation. */
export interface DocxRenderer {
  readonly name: string;
  render(input: RenderDocxInput): Promise<RenderedArtifact>;
}

export interface PdfRenderer {
  readonly name: string;
  render(input: RenderPdfInput): Promise<RenderedArtifact>;
}

export interface DocumentExtractor {
  readonly name: string;
  supports(format: DocumentFormat): boolean;
  extract(input: ExtractInput): Promise<ExtractedDocument>;
}

export interface DocumentConverter {
  readonly name: string;
  supports(source: DocumentFormat, target: DocumentFormat): boolean;
  convert(input: ConvertPdfInput): Promise<ConvertedDocument>;
}

/**
 * Where a cached result came from, when one was reused instead of converted.
 * Absent on every freshly produced artifact; a reader that ignores this field
 * still sees a complete, self-contained manifest.
 */
export interface DocumentCacheRecord {
  readonly hit: true;
  /** Bundle whose file was copied and re-hashed to produce this artifact. */
  readonly sourceArtifactId?: string;
}

/** Manifest document, written beside every artifact (§19). */
export interface DocumentManifest {
  readonly schemaVersion: 1;
  readonly artifactId: string;
  readonly operation:
    | "document_create"
    | "document_to_markdown"
    | "document_convert"
    | "document_from_url"
    | "document_compare";
  readonly createdAt: string;
  readonly input: {
    readonly format: DocumentFormat | "unknown";
    readonly sha256: string;
    readonly filename?: string;
    readonly bytes?: number;
  };
  readonly outputs: readonly {
    readonly format: CreateFormat | "md";
    readonly path: string;
    readonly sha256: string;
    readonly size: number;
    readonly status: "created" | "failed";
    readonly error?: string;
  }[];
  readonly template?: string;
  readonly templateSha256?: string;
  readonly backends: Readonly<Record<string, BackendInfo>>;
  readonly warnings: readonly DocumentWarning[];
  /** Authorization context (§40): what this artifact belongs to. */
  readonly scope: {
    readonly sessionId?: string;
    readonly workspace?: string;
  };
  /**
   * Artifact flavour. Absent means an ordinary single-document artifact; a
   * comparison sets it to `document-comparison` and fills {@link comparison},
   * which is what makes a comparison reproducible rather than merely stored
   * (comparison §23).
   */
  readonly kind?: "document-comparison";
  readonly comparison?: DocumentComparisonRecord;
  /** Provenance of a reused conversion; absent when the backend really ran. */
  readonly cache?: DocumentCacheRecord;
}

/**
 * What a comparison artifact records about itself: the two inputs, the engine
 * that produced the diff, the options it ran under, and where the change set
 * lives. Re-running with the same manifest must produce the same change set.
 */
export interface DocumentComparisonRecord {
  readonly left: DocumentComparisonSide;
  readonly right: DocumentComparisonSide;
  readonly engine: {
    readonly extractorLeft: string;
    readonly extractorRight: string;
    readonly diff: string;
  };
  readonly options: Readonly<Record<string, unknown>>;
  readonly quality: {
    readonly level: string;
    readonly reasons: readonly string[];
    readonly ocrUsed: boolean;
  };
  readonly summary: Readonly<Record<string, number>>;
  readonly changes: number;
  readonly changesPath: string;
  readonly reportPath: string;
  readonly normalized?: {
    readonly left: string;
    readonly right: string;
  };
}

export interface DocumentComparisonSide {
  readonly sha256: string;
  readonly filename: string;
  readonly format: string;
  readonly nodes: number;
  readonly retainedPath?: string;
}

/** Backend availability, reported by capacity discovery and health (§42). */
export type BackendStatus = "ok" | "unavailable" | "disabled";

export interface DocumentHealth {
  readonly status: "ok" | "degraded" | "unavailable";
  readonly required: Readonly<Record<string, BackendStatus>>;
  readonly optional: Readonly<Record<string, BackendStatus>>;
}

/** Capability discovery (§43). */
export interface DocumentCapabilities {
  readonly enabled: boolean;
  readonly create: readonly CreateFormat[];
  readonly extract: readonly DocumentFormat[];
  readonly convert: readonly (readonly [DocumentFormat, DocumentFormat])[];
  readonly ocr: boolean;
  readonly templates: readonly string[];
  readonly pdfModes: readonly PdfMode[];
}
