import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { QaWorkspaceFileChunk } from "../types.js";
import {
  resolveAllowedFile,
  QaSourcePreviewError,
  type QaAllowedFileRequest,
} from "./file-preview.js";

/** Each RPC stays small; downloads never use the preview's byte limit. */
export const QA_DOWNLOAD_CHUNK_BYTES = 256 * 1024;
export const QA_DOWNLOAD_MAX_BYTES = 256 * 1024 * 1024;

/** A stable file version, checked before and after every read. */
function versionOf(info: {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  ino: number;
}): string {
  return createHash("sha256")
    .update(JSON.stringify([info.size, info.mtimeMs, info.ctimeMs, info.ino]))
    .digest("hex");
}

export async function readWorkspaceFileChunk(
  request: QaAllowedFileRequest & {
    readonly offset: number;
    readonly version: string | null;
  },
): Promise<QaWorkspaceFileChunk> {
  if (!Number.isSafeInteger(request.offset) || request.offset < 0) {
    throw new QaSourcePreviewError("unavailable");
  }
  const file = await resolveAllowedFile(request);
  const handle = await open(
    file.canonical,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  ).catch(() => undefined);
  if (handle === undefined) throw new QaSourcePreviewError("unavailable");
  try {
    const before = await handle.stat();
    const version = versionOf(before);
    if (
      !before.isFile() ||
      before.size > QA_DOWNLOAD_MAX_BYTES ||
      request.offset > before.size ||
      (request.offset > 0 && request.version === null) ||
      (request.version !== null && request.version !== version)
    ) {
      throw new QaSourcePreviewError("unavailable");
    }
    const buffer = Buffer.alloc(
      Math.min(QA_DOWNLOAD_CHUNK_BYTES, before.size - request.offset),
    );
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const read = await handle.read(
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        request.offset + bytesRead,
      );
      if (read.bytesRead === 0) throw new QaSourcePreviewError("unavailable");
      bytesRead += read.bytesRead;
    }
    if (versionOf(await handle.stat()) !== version) {
      throw new QaSourcePreviewError("unavailable");
    }
    return {
      path: file.canonicalPath,
      size: before.size,
      offset: request.offset,
      version,
      base64: buffer.toString("base64"),
      done: request.offset + bytesRead === before.size,
    };
  } finally {
    await handle.close();
  }
}
