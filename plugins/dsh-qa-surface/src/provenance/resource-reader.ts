import type { QaSpreadsheetPreviewSelection } from "../types.js";
import {
  previewConvertibleDocument,
  readSourcePreview,
  type DocumentsLookup,
} from "./document-preview.js";
import { readWorkspaceFileChunk } from "./file-download.js";
import {
  readWorkspaceFile,
  type QaSourceFilePreviewRequest,
} from "./file-preview.js";
import { readSourceImage } from "./source-image.js";

interface ResourceReadContext {
  readonly sessionId: string;
  readonly file: Omit<QaSourceFilePreviewRequest, "sourcePath" | "isEvidence">;
  readonly isEvidence: QaSourceFilePreviewRequest["isEvidence"];
  readonly documents: DocumentsLookup;
  readonly finish: () => void;
  readonly refusal: (event: string | undefined, error: unknown) => Error;
}

/** File access for one admitted request, with the original grant checked again at completion. */
export class QaResourceReader {
  constructor(private readonly context: ResourceReadContext) {}

  readSourceFile(
    sourcePath: string,
    selection?: QaSpreadsheetPreviewSelection,
  ) {
    const { file, sessionId, isEvidence, documents } = this.context;
    return this.read(
      () =>
        readSourcePreview({
          ...file,
          sourcePath,
          sessionId,
          isEvidence,
          documents,
          ...(selection === undefined ? {} : { selection }),
        }),
      "source.preview-refused",
    );
  }

  readSourceImage(sourcePath: string, imagePath: string) {
    const { file, isEvidence } = this.context;
    return this.read(() =>
      readSourceImage(
        { ...file, sourcePath, renderFrontmatter: false, isEvidence },
        imagePath,
      ),
    );
  }

  readWorkspaceFile(path: string) {
    return this.read(
      () =>
        readWorkspaceFile({
          ...this.context.file,
          filePath: path ?? "",
        }),
      "workspace.read-refused",
    );
  }

  readWorkspaceFileChunk(
    path: string,
    offset: number,
    version: string | null,
    sha256Prefix?: string,
  ) {
    return this.read(
      () =>
        readWorkspaceFileChunk({
          ...this.context.file,
          filePath: path ?? "",
          offset,
          version,
          ...(sha256Prefix === undefined ? {} : { sha256Prefix }),
        }),
      "workspace.download-refused",
    );
  }

  previewWorkspaceDocument(
    path: string,
    selection?: QaSpreadsheetPreviewSelection,
  ) {
    const { file, sessionId, documents } = this.context;
    return this.read(
      () =>
        previewConvertibleDocument({
          ...file,
          filePath: path ?? "",
          sessionId,
          documents,
          ...(selection === undefined ? {} : { selection }),
        }),
      "workspace.preview-refused",
    );
  }

  private async read<T>(load: () => Promise<T>, event?: string): Promise<T> {
    try {
      const value = await load();
      this.context.finish();
      return value;
    } catch (error) {
      throw this.context.refusal(event, error);
    }
  }
}
