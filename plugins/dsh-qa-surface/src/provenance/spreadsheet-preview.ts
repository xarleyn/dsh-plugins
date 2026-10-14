import { basename } from "node:path";
import type { QaDocumentPreviewRequest } from "./document-preview.js";
import { QaSourcePreviewError, resolveAllowedFile } from "./file-preview.js";
import type { QaSpreadsheetPreview } from "../types.js";

/** Reuse the agent's bounded parser and the panel's canonical root fence. */
export async function previewSpreadsheetDocument(
  request: QaDocumentPreviewRequest,
): Promise<QaSpreadsheetPreview> {
  const file = await resolveAllowedFile(request);
  const face = request.documents();
  if (
    face?.inspectSpreadsheet === undefined ||
    face.readSpreadsheet === undefined
  ) {
    throw new QaSourcePreviewError("unsupported");
  }
  const scope = {
    workspaceRoot: request.cwd,
    sessionId: request.sessionId,
    extraInputRoots: [
      ...(request.sharedReadOnlyRoots ?? []),
      ...(request.attachmentRoot === undefined ? [] : [request.attachmentRoot]),
    ],
  };
  try {
    const inventory = await face.inspectSpreadsheet(
      { file: file.canonical },
      scope,
    );
    const sheet =
      request.selection?.sheet ??
      inventory.sheets.find((item) => item.state === "visible")?.name ??
      inventory.sheets[0]?.name;
    if (sheet === undefined) throw new QaSourcePreviewError("unsupported");
    const page = await face.readSpreadsheet(
      {
        file: file.canonical,
        sheet,
        startRow: request.selection?.startRow ?? 1,
        startColumn: request.selection?.startColumn ?? 1,
        rowCount: 40,
        columnCount: 12,
        ...(inventory.text === undefined ? {} : { text: inventory.text }),
      },
      scope,
    );
    if (inventory.sha256 !== page.sha256)
      throw new QaSourcePreviewError("unavailable");
    const preview: QaSpreadsheetPreview = {
      kind: "spreadsheet",
      name: basename(file.canonical),
      bytes: file.size,
      inventory,
      page,
    };
    if (Buffer.byteLength(JSON.stringify(preview), "utf8") > request.maxBytes)
      throw new QaSourcePreviewError("unsupported");
    return preview;
  } catch (error) {
    throw new QaSourcePreviewError(
      error instanceof QaSourcePreviewError ? error.reason : "unsupported",
    );
  }
}
