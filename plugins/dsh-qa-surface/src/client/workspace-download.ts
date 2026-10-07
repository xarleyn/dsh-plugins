import type { QaWorkspaceFile } from "../types.js";
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
  const bytes =
    file.base64 === undefined
      ? new TextEncoder().encode(file.text ?? "")
      : base64ToBytes(file.base64);
  const url = URL.createObjectURL(
    new Blob([bytes as BlobPart], { type: file.mime }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileNameOf(file.path);
  anchor.rel = "noreferrer";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
