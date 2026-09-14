/**
 * MIME policy for document assets (§17.1).
 *
 * Kept free of Node builtins on purpose: the QA settings schema reaches this
 * module from the browser bundle, so anything imported here also has to run in
 * a page. The byte sniffing stays with the pipeline's file-type module, which
 * may import whatever it needs.
 */

/** Asset MIME types accepted by default. */
export const DEFAULT_ASSET_MIME_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
];

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".svg": "image/svg+xml",
};

/** Lowercased extension of a file name, including the dot. */
function extensionOf(filename: string): string {
  const separator = Math.max(
    filename.lastIndexOf("/"),
    filename.lastIndexOf("\\"),
  );
  const base = separator < 0 ? filename : filename.slice(separator + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

export function mimeTypeForFilename(filename: string): string | undefined {
  return MIME_BY_EXTENSION[extensionOf(filename)];
}

export function isAllowedAssetMimeType(
  mimeType: string,
  allowed: readonly string[],
): boolean {
  const normalized = mimeType.trim().toLowerCase();
  return allowed.some((entry) => entry.trim().toLowerCase() === normalized);
}
