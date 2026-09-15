import { optionalInteger, requiredText } from "../../coerce.js";
import { IntegrationError } from "../../errors.js";
import type { TeamCityFlags } from "./config.js";

/**
 * Artifact access is the one place where the model can ask for an arbitrary
 * byte range of a build's output, so it is bounded twice: by the path policy
 * below (what may be named at all) and by a byte budget (how much comes back).
 */

const MAX_PATH_LENGTH = 512;
const MAX_SEGMENTS = 24;

/**
 * Types this provider never inlines. A build artifact that is an archive is
 * where the interesting file hides and also where an unbounded download starts,
 * a machine image or a key is what a build must not leak into a model context,
 * and a private key is not made safe by the provider's text redaction.
 */
const BINARY_EXTENSIONS: readonly string[] = Object.freeze([
  "7z",
  "aab",
  "apk",
  "avi",
  "bin",
  "bz2",
  "class",
  "db",
  "deb",
  "dll",
  "dmg",
  "doc",
  "docx",
  "dylib",
  "ear",
  "exe",
  "flac",
  "gif",
  "gz",
  "ico",
  "iso",
  "jar",
  "jks",
  "jpeg",
  "jpg",
  "key",
  "keystore",
  "lz4",
  "mdb",
  "mkv",
  "mov",
  "mp3",
  "mp4",
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
  "pptx",
  "ps",
  "rar",
  "rpm",
  "so",
  "sqlite",
  "tar",
  "tgz",
  "tiff",
  "war",
  "wav",
  "webm",
  "webp",
  "xls",
  "xlsx",
  "xz",
  "zip",
  "zst",
]);

export interface ArtifactPath {
  /** Path as the model wrote it, canonicalized and safe to echo back. */
  readonly decoded: string;
  /** Same path, each segment encoded, for use inside the REST path. */
  readonly encoded: string;
}

/**
 * Canonicalize one artifact path. It never leaves the REST path it was built
 * for: no absolute path, no `..` segment, no control character, no backslash and
 * no archive component, because `archive.zip!/inner` would ask TeamCity to
 * extract an archive the model did not have to name.
 */
export function artifactPath(
  value: unknown,
  field = "path",
  allowEmpty = false,
): ArtifactPath {
  const raw = typeof value === "string" ? value.trim() : "";
  if (raw === "" && allowEmpty) return { decoded: "", encoded: "" };
  const normalized = requiredText(value, field, 1, MAX_PATH_LENGTH);
  const segments = normalized.split("/").filter((segment) => segment !== "");
  if (
    normalized.startsWith("/") ||
    segments.length === 0 ||
    segments.length > MAX_SEGMENTS ||
    segments.some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        // eslint-disable-next-line no-control-regex
        /[\u0000-\u001f\u007f\\!]/u.test(segment),
    )
  ) {
    throw new IntegrationError("InvalidRequest", `${field} is invalid`);
  }
  return {
    decoded: segments.join("/"),
    encoded: segments.map((segment) => encodeURIComponent(segment)).join("/"),
  };
}

/** Extension of the last segment, lowercased, without the dot. */
export function artifactExtension(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * Byte budget of one text artifact: the caller may ask for less than the
 * deployment allows, never for more, and an unasked budget is the configured
 * default rather than the hard ceiling.
 */
export function artifactByteLimit(
  requested: unknown,
  flags: TeamCityFlags,
): number {
  const asked = optionalInteger(requested, "maxBytes", 1_024, 4_194_304);
  return Math.min(asked ?? flags.defaultArtifactBytes, flags.maxArtifactBytes);
}

/** Why this artifact may not be read as text at all. */
export function artifactBinaryProblem(path: string): string | undefined {
  const extension = artifactExtension(path);
  if (extension === "") return undefined;
  if (!BINARY_EXTENSIONS.includes(extension)) return undefined;
  return `artifact type .${extension} is never inlined`;
}

/** A NUL byte in the head of a body is the classic text/binary split. */
export function looksBinary(bytes: Uint8Array): boolean {
  for (const byte of bytes.subarray(0, 8_192)) {
    if (byte === 0) return true;
  }
  return false;
}

export interface TextArtifactAnswer {
  readonly path: string;
  /** Bytes of the body that was downloaded, not the artifact's full size. */
  readonly bytes: number;
  readonly binary: boolean;
  readonly truncated: boolean;
  readonly content?: string;
}

/**
 * Answer for one text artifact. A binary body answers with its size and the
 * `binary` marker instead of bytes, and a body over the budget keeps the prefix
 * that fits, because a bounded preview is useful where an empty answer is not.
 */
export function textArtifact(
  path: string,
  bytes: number,
  limit: number,
  body: {
    readonly text: string;
    readonly binary: boolean;
    readonly truncated: boolean;
  },
): TextArtifactAnswer {
  if (body.binary) {
    return { path, bytes, binary: true, truncated: false };
  }
  return {
    path,
    bytes,
    binary: false,
    truncated: body.truncated || bytes > limit,
    content: body.text,
  };
}
