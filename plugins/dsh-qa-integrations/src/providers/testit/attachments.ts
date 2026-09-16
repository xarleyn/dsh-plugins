import { optionalInteger } from "../../coerce.js";
import { IntegrationError } from "../../errors.js";
import type { TestitFlags } from "./config.js";

/**
 * A Test IT attachment is the one place in this provider where the model asks
 * for raw bytes rather than for JSON, so it is bounded twice: by the kind
 * policy below (what may be inlined at all) and by a byte budget (how much
 * comes back). Both are applied to what Test IT says about the file — its name
 * and its size — never to a name the caller supplied, so a caller cannot talk
 * the provider into downloading something by describing it differently.
 */

/**
 * Kinds this provider never inlines. An archive is where the interesting file
 * hides and also where an unbounded download starts, a screenshot or a video is
 * a fine attachment but not readable text, a document is an archive with a
 * wrapper, and key material is not made safe by redaction.
 */
const BINARY_EXTENSIONS: readonly string[] = Object.freeze([
  "7z",
  "aab",
  "apk",
  "avi",
  "bin",
  "bmp",
  "bz2",
  "class",
  "csv.gz",
  "db",
  "deb",
  "dll",
  "dmg",
  "doc",
  "docm",
  "docx",
  "dylib",
  "ear",
  "exe",
  "flac",
  "gif",
  "gz",
  "heic",
  "ico",
  "iso",
  "jar",
  "jks",
  "jpeg",
  "jpg",
  "key",
  "keystore",
  "lz4",
  "m4a",
  "mdb",
  "mkv",
  "mov",
  "mp3",
  "mp4",
  "msi",
  "msix",
  "odp",
  "ods",
  "odt",
  "ogg",
  "p12",
  "pdf",
  "pem",
  "pfx",
  "png",
  "ppt",
  "pptm",
  "pptx",
  "rar",
  "rpm",
  "so",
  "sqlite",
  "tar",
  "tgz",
  "tif",
  "tiff",
  "war",
  "wav",
  "webm",
  "webp",
  "xls",
  "xlsm",
  "xlsx",
  "xz",
  "zip",
  "zst",
]);

/** A file name as Test IT reported it, trimmed and safe to echo back. */
export function attachmentName(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw.length > 255 ? raw.slice(0, 255) : raw;
}

/** Extension of a file name, lowercased and without the dot. */
export function attachmentExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Why this attachment may not be read as text at all. */
export function attachmentBinaryProblem(name: string): string | undefined {
  const extension = attachmentExtension(name);
  if (extension === "") return undefined;
  if (!BINARY_EXTENSIONS.includes(extension)) return undefined;
  return `attachment type .${extension} is never inlined`;
}

/**
 * Byte budget of one attachment read: the caller may ask for less than the
 * deployment allows, never for more, and an unasked budget is the configured
 * default rather than the hard ceiling.
 */
export function attachmentByteLimit(
  requested: unknown,
  flags: TestitFlags,
): number {
  const asked = optionalInteger(requested, "maxBytes", 1_024, 67_108_864);
  return Math.min(
    asked ?? flags.defaultAttachmentBytes,
    flags.maxAttachmentBytes,
  );
}

/**
 * Refuse a file Test IT already described as bigger than the budget, before a
 * byte of it is requested. The declared size is the upstream's own answer, so
 * this is a real bound and not a suggestion.
 */
export function assertReadableSize(
  declaredBytes: number | undefined,
  limit: number,
): void {
  if (declaredBytes === undefined) return;
  if (declaredBytes > limit) {
    // The file's own name is not repeated here: it is text Test IT stores, and
    // an error message is read as the provider's own words, not as data.
    throw new IntegrationError(
      "ResultTooLarge",
      "attachment is larger than the attachment byte budget",
    );
  }
}
