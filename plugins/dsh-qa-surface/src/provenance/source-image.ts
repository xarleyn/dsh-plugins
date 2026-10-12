import { open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { markdownImageTargets } from "../markdown-images.js";
import {
  QaSourcePreviewError,
  readSourceFilePreview,
  resolveAllowedFile,
  type QaSourceFilePreviewRequest,
} from "./file-preview.js";

function rasterMime(bytes: Buffer): string | undefined {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii")))
    return "image/gif";
  if (
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  return undefined;
}

/** The image must be named by an attested Markdown file and stay inside allowed roots. */
export async function readSourceImage(
  request: QaSourceFilePreviewRequest,
  imagePath: string,
): Promise<string> {
  const parent = await readSourceFilePreview(request);
  if (
    !parent.renderableMarkdown ||
    parent.truncated ||
    !markdownImageTargets(parent.content).has(imagePath)
  )
    throw new QaSourcePreviewError("not-evidence");
  if (/^(?:[a-z][a-z\d+.-]*:|[/\\])/iu.test(imagePath))
    throw new QaSourcePreviewError("unsupported");
  let decoded: string;
  try {
    decoded = decodeURIComponent(imagePath);
  } catch {
    throw new QaSourcePreviewError("unsupported");
  }
  if (/^(?:[a-z][a-z\d+.-]*:|[/\\])/iu.test(decoded) || decoded.includes("\0"))
    throw new QaSourcePreviewError("unsupported");
  const file = await resolveAllowedFile({
    ...request,
    filePath: resolve(
      dirname(resolve(request.cwd, parent.path)),
      decoded.replace(/\\/gu, "/"),
    ),
  });
  if (file.size > request.maxBytes)
    throw new QaSourcePreviewError("unsupported");
  const handle = await open(file.canonical, "r");
  try {
    const bytes = Buffer.alloc(Math.min(request.maxBytes + 1, file.size + 1));
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > request.maxBytes || bytesRead !== file.size)
      throw new QaSourcePreviewError("unsupported");
    const window = bytes.subarray(0, bytesRead);
    const mime = rasterMime(window);
    if (mime === undefined) throw new QaSourcePreviewError("unsupported");
    return `data:${mime};base64,${window.toString("base64")}`;
  } finally {
    await handle.close();
  }
}
