import { readFile } from "node:fs/promises";
import type { DocumentsFace } from "@yadsh/dsh-documents";
import { basename } from "node:path";
import type { QaDocumentPreview } from "../types.js";
import {
  mediaTypeOf,
  QaSourcePreviewError,
  resolveAllowedFile,
  type QaAllowedFileRequest,
} from "./file-preview.js";
import { isConvertibleDocument } from "../shared/documents.js";

/** Look up the document subsystem a sibling Host plugin published. */
export type DocumentsLookup = () => DocumentsFace | undefined;

export interface QaDocumentPreviewRequest extends QaAllowedFileRequest {
  /** The document pipeline, resolved per call so a late provider still counts. */
  readonly documents: DocumentsLookup;
  readonly sessionId: string;
  /** Bytes of the rendered PDF the panel accepts before it gives up. */
  readonly maxBytes: number;
}

/** The produced PDF, base64-encoded for the wire. */
function toPreview(bytes: Buffer, name: string): QaDocumentPreview {
  return {
    kind: "pdf",
    base64: bytes.toString("base64"),
    mime: "application/pdf",
    name,
    bytes: bytes.byteLength,
  };
}

/**
 * Render one Word document as a PDF for the files panel.
 *
 * The conversion is the document pipeline's own — the same runtime, providers
 * and limits the `document_*` tools use — reached through the face that plugin
 * publishes for its Host siblings; a deployment without the pipeline installed
 * refuses with `unsupported` rather than growing a second converter here. The
 * input path passes the same containment check the panel's other reads use, so
 * a preview cannot read what a listing could not reach.
 */
export async function previewConvertibleDocument({
  documents,
  sessionId,
  maxBytes,
  ...file
}: QaDocumentPreviewRequest): Promise<QaDocumentPreview> {
  const face = documents();
  if (face === undefined) throw new QaSourcePreviewError("unsupported");
  const resolved = await resolveAllowedFile(file);
  if (!isConvertibleDocument(mediaTypeOf(resolved.canonical))) {
    throw new QaSourcePreviewError("unsupported");
  }
  let rendered: string;
  try {
    const converted = await face.convert(
      { file: resolved.canonical, targetFormat: "pdf" },
      { workspaceRoot: file.cwd, sessionId },
    );
    const pdf = converted.files.find(
      (output) => output.format === "pdf" && output.status === "created",
    );
    if (pdf === undefined) throw new QaSourcePreviewError("unsupported");
    rendered = pdf.path;
  } catch (error) {
    throw new QaSourcePreviewError(
      error instanceof QaSourcePreviewError ? error.reason : "unsupported",
    );
  }
  const bytes = await readFile(rendered).catch(() => undefined);
  if (bytes === undefined) throw new QaSourcePreviewError("unavailable");
  if (bytes.byteLength > maxBytes)
    throw new QaSourcePreviewError("unsupported");
  return toPreview(bytes, basename(resolved.canonical));
}
