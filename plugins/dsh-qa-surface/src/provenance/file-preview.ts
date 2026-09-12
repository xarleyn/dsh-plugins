import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { QaSourceFilePreview } from "../types.js";

export interface QaSourceFilePreviewOptions {
  readonly root: string;
  readonly sourcePath: string;
  readonly maxBytes: number;
  readonly maxMarkdownRenderBytes: number;
}

/** Read one canonical in-root file without following a symlink outside root. */
export async function readSourceFilePreview({
  root,
  sourcePath,
  maxBytes,
  maxMarkdownRenderBytes,
}: QaSourceFilePreviewOptions): Promise<QaSourceFilePreview> {
  const rootPath = await realpath(root);
  const candidate = isAbsolute(sourcePath)
    ? sourcePath
    : resolve(rootPath, sourcePath);
  const canonical = await realpath(candidate);
  const fromRoot = relative(rootPath, canonical);
  if (
    fromRoot === "" ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new Error("source path escapes the configured root");
  }
  const info = await stat(canonical);
  if (!info.isFile()) throw new Error("source path is not a file");
  const handle = await open(canonical, "r");
  try {
    const limit = Math.min(maxBytes, info.size);
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    const markdown = /\.(?:md|markdown)$/iu.test(canonical);
    return {
      path: sourcePath,
      content: buffer.subarray(0, bytesRead).toString("utf8"),
      size: info.size,
      truncated: info.size > bytesRead,
      markdown,
      renderableMarkdown: markdown && info.size <= maxMarkdownRenderBytes,
    };
  } finally {
    await handle.close();
  }
}
