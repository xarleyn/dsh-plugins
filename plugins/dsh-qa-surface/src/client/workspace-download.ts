import type { QaWorkspaceFile, QaWorkspaceFileChunk } from "../types.js";
import { base64ToBytes } from "./base64.js";

/**
 * Handing one file of the chat's workspace to the person the turn produced it
 * for.
 *
 * A produced document has no attachment-store handle, so the download is the
 * same read the files panel does: the Host returns the bytes under the chat's
 * own fence and the browser's download machinery takes it from there. Shared by
 * the panel's own viewer and the card under an answer, so the two can never
 * disagree on what "download this file" means.
 */

/** Last segment of a workspace path, spelled with either separator. */
export function fileNameOf(path: string): string {
  const segments = path.split(/[/\\]/u).filter((segment) => segment !== "");
  return segments[segments.length - 1] ?? path;
}

/** Save one workspace file under its own name. */
export function downloadWorkspaceFile(file: QaWorkspaceFile): void {
  if (file.truncated) {
    throw new Error(
      "Файл прочитан частично. Скачивание требует полного файла.",
    );
  }
  const bytes =
    file.base64 === undefined
      ? new TextEncoder().encode(file.text ?? "")
      : base64ToBytes(file.base64);
  saveBlob(new Blob([bytes as BlobPart], { type: file.mime }), file.path);
}

function saveBlob(blob: Blob, path: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileNameOf(path);
  anchor.rel = "noreferrer";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Read one immutable file version in full; a refusal never saves partial bytes. */
export async function downloadWorkspacePath(
  path: string,
  read: (
    offset: number,
    version: string | null,
  ) => Promise<
    | { readonly ok: true; readonly value: QaWorkspaceFileChunk }
    | { readonly ok: false; readonly error: unknown }
  >,
): Promise<void> {
  const chunks: BlobPart[] = [];
  let offset = 0;
  let version: string | null = null;
  let size: number | undefined;
  while (true) {
    const result = await read(offset, version);
    if (!result.ok) throw new Error("Не удалось скачать файл целиком.");
    const chunk = result.value;
    if (
      chunk.offset !== offset ||
      !Number.isSafeInteger(chunk.size) ||
      chunk.size < 0 ||
      chunk.size > 256 * 1024 * 1024 ||
      (size !== undefined && chunk.size !== size) ||
      (version !== null && chunk.version !== version)
    )
      throw new Error("Файл изменился во время скачивания.");
    size = chunk.size;
    version = chunk.version;
    const bytes = base64ToBytes(chunk.base64);
    if (offset + bytes.length > size || (!chunk.done && bytes.length === 0)) {
      throw new Error("Файл прочитан не полностью.");
    }
    chunks.push(bytes as BlobPart);
    offset += bytes.length;
    if (chunk.done) {
      if (offset !== size) throw new Error("Файл прочитан не полностью.");
      saveBlob(new Blob(chunks, { type: "application/octet-stream" }), path);
      return;
    }
  }
}
