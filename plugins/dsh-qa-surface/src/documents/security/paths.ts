/**
 * Path containment and filename hygiene (§26.2, §32).
 *
 * Two rules hold everywhere in the pipeline:
 *
 * - every path the pipeline touches is resolved against an allowed root and
 *   the resolution must stay inside it — traversal, absolute escapes and
 *   `file://` references are refused before anything is opened;
 * - a caller-supplied filename is a label, never a path: directories are
 *   dropped, separators and reserved characters collapse to `-`, and the
 *   extension is the one the operation itself chose.
 */

import { realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { DocumentError } from "../errors.js";

/** Whether `target` is `root` or a descendant of it (no symlink resolution). */
export function isInsideRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

export function assertInsideRoot(
  root: string,
  target: string,
  label: string,
): string {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (!isInsideRoot(resolvedRoot, resolvedTarget)) {
    throw new DocumentError(
      "PATH_NOT_ALLOWED",
      `${label} is outside the allowed document scope`,
      { details: { label } },
    );
  }
  return resolvedTarget;
}

/**
 * Canonicalize a path for containment checks: the existing prefix is resolved
 * through symlinks, the non-existent remainder is appended unresolved. A
 * symlink pointing outside the root therefore canonicalizes outside it.
 */
export async function canonicalizeForContainment(
  input: string,
): Promise<string> {
  const resolved = path.resolve(input);
  let current = resolved;
  const remainder: string[] = [];
  for (;;) {
    try {
      const canonical = await realpath(current);
      return remainder.length === 0
        ? canonical
        : path.join(canonical, ...remainder.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return resolved;
      remainder.push(path.basename(current));
      current = parent;
    }
  }
}

/** Resolve a caller-supplied path against `root`, refusing any escape. */
export async function resolveInsideRoot(
  root: string,
  requested: string,
  label: string,
): Promise<string> {
  if (requested.trim() === "") {
    throw new DocumentError(
      "INVALID_INPUT",
      `${label} must be a non-empty path`,
    );
  }
  if (requested.toLowerCase().startsWith("file:")) {
    throw new DocumentError(
      "PATH_NOT_ALLOWED",
      `${label} must be a filesystem path, not a file URL`,
    );
  }
  const canonicalRoot = await canonicalizeForContainment(root);
  const target = path.resolve(canonicalRoot, requested);
  const canonicalTarget = await canonicalizeForContainment(target);
  assertInsideRoot(canonicalRoot, canonicalTarget, label);
  return canonicalTarget;
}

/**
 * Turn a caller-supplied filename into a safe file name (§32).
 * `../../foo report?.docx` becomes `foo-report.docx`.
 */
export function sanitizeFilename(
  requested: string | undefined,
  fallbackStem: string,
  extension: string,
): string {
  const suffix =
    extension === ""
      ? ""
      : extension.startsWith(".")
        ? extension
        : `.${extension}`;
  const source = (requested ?? "").trim();
  let stem = "";
  if (source !== "") {
    // A Windows-style separator survives `path.basename` on POSIX, so both are
    // cut explicitly before any further normalization.
    const basename = source.split(/[\\/]+/u).pop() ?? "";
    const withoutExtension = basename.replace(/\.[A-Za-z0-9]{1,8}$/u, "");
    stem = withoutExtension
      .normalize("NFC")
      /* eslint-disable-next-line no-control-regex -- control characters are the point */
      .replace(/[\u0000-\u001F\u007F]/gu, "")
      .replace(/[<>:"|?*]+/gu, "")
      .replace(/[\s._]+/gu, "-")
      .replace(/-{2,}/gu, "-")
      .replace(/^[-.]+|[-.]+$/gu, "");
  }
  const safeStem = stem === "" ? fallbackStem : stem.slice(0, 80);
  return `${safeStem}${suffix}`;
}

/** `file:///...` form required by `-env:UserInstallation` and friends. */
export function toFileUri(target: string): string {
  return pathToFileURL(path.resolve(target)).href;
}

/**
 * Assert an asset reference inside Markdown targets the assets directory and
 * nothing else: no absolute paths, no URLs, no traversal (§17.1).
 */
export function assertRelativeAssetReference(reference: string): string {
  const trimmed = reference.trim();
  if (trimmed === "") {
    throw new DocumentError("INVALID_ASSET", "asset reference is empty");
  }
  if (
    /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(trimmed) ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("\\\\") ||
    /^(?:data|file|javascript):/iu.test(trimmed)
  ) {
    throw new DocumentError(
      "INVALID_ASSET",
      `asset reference must be relative to the artifact assets directory (${trimmed})`,
    );
  }
  const normalized = trimmed.replace(/\\/gu, "/");
  if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new DocumentError(
      "INVALID_ASSET",
      `asset reference must not leave the assets directory (${trimmed})`,
    );
  }
  return normalized;
}

/** Recursively-size snapshot helper used by the limits guard. */
export function assertNotBlank(value: string, label: string): string {
  if (value.trim() === "") {
    throw new DocumentError("INVALID_INPUT", `${label} must not be blank`);
  }
  return value;
}
