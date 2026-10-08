/**
 * Reading one artifact's bytes, within the limits the config declares.
 *
 * Everything here defends against the audit being untrusted input (SPEC §62):
 * the size is checked before the read, the path is proved to sit under the
 * configured root, a link is refused, and the bytes must decode as UTF-8
 * rather than being silently replaced.
 */
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import type { Stats } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { isPathContained } from "@yadsh/dsh-audit-core/paths";
import type { AuditError } from "@yadsh/dsh-audit-core";
import type { AuditArtifactStat } from "./audit-scanner.js";

/** A read that either produced text or explained why it could not. */
export type ArtifactReadResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: AuditError };

/** Decode with `fatal`, so a malformed byte becomes an error, not a `\uFFFD`. */
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

/** What the containment walk reached: the file itself, or why it did not. */
type ContainedFile =
  | { readonly ok: true; readonly stats: Stats }
  | { readonly ok: false; readonly reason: string };

/**
 * Prove the artifact is physically reachable from the root, link by link.
 *
 * A lexical comparison only proves the *string* is under the root. Any
 * component of the chain can be swapped for a symlink or a Windows junction
 * pointing elsewhere — the audit directory itself, not only the artifact file —
 * and `lstat` of the last component cannot see that. So the walk starts at the
 * root's real path, refuses a link at every step, and ends on a regular file
 * (SPEC §64).
 *
 * The configured root may itself be a link an operator chose, hence the real
 * path anchor: that one is honoured, and nothing below it is.
 */
async function containedFile(
  auditRoot: string,
  path: string,
): Promise<ContainedFile> {
  const outside = `${JSON.stringify(path)} is outside the audit root`;
  if (!isPathContained(auditRoot, path)) {
    return { ok: false, reason: outside };
  }
  const chain = relative(resolve(auditRoot), resolve(path));
  if (chain === "" || chain.startsWith("..") || isAbsolute(chain)) {
    return { ok: false, reason: outside };
  }

  let current: string;
  try {
    current = await realpath(auditRoot);
  } catch (error) {
    return {
      ok: false,
      reason: `cannot reach the audit root of ${JSON.stringify(path)}: ${reasonOf(error)}`,
    };
  }

  let stats: Stats | undefined;
  for (const part of chain.split(sep)) {
    current = join(current, part);
    try {
      stats = await lstat(current);
    } catch (error) {
      return {
        ok: false,
        reason: `cannot inspect ${JSON.stringify(current)} on the way to ${JSON.stringify(path)}: ${reasonOf(error)}`,
      };
    }
    if (stats.isSymbolicLink()) {
      return {
        ok: false,
        reason: `${JSON.stringify(current)} is a link on the way to ${JSON.stringify(path)}`,
      };
    }
  }

  if (stats === undefined || !stats.isFile()) {
    return {
      ok: false,
      reason: `${JSON.stringify(path)} is not a regular file`,
    };
  }
  return { ok: true, stats };
}

/**
 * Read one artifact as text.
 *
 * @param stat - what the scan recorded for this file.
 * @param maxBytes - the configured cap for this artifact.
 * @param auditRoot - the root the file must sit under.
 */
export async function readArtifactText(
  stat: AuditArtifactStat,
  maxBytes: number,
  auditRoot: string,
): Promise<ArtifactReadResult> {
  if (stat.size > maxBytes) {
    return {
      ok: false,
      error: {
        code: "FILE_TOO_LARGE",
        message: `${JSON.stringify(stat.path)} is ${stat.size} bytes, over the ${maxBytes}-byte limit`,
        severity: "error",
      },
    };
  }

  const contained = await containedFile(auditRoot, stat.path);
  if (!contained.ok) {
    return fail(contained.reason);
  }

  let handle: FileHandle;
  try {
    handle = await open(stat.path, "r");
  } catch (error) {
    return fail(`cannot read ${JSON.stringify(stat.path)}: ${reasonOf(error)}`);
  }

  let bytes: Buffer;
  try {
    // The scan's verdict and the containment walk are both snapshots. What is
    // read must be the file that was just proved contained, so the opened
    // handle is checked against the walk by identity, not by name.
    const opened = await handle.stat();
    if (!opened.isFile()) {
      return fail(`${JSON.stringify(stat.path)} is no longer a regular file`);
    }
    if (opened.size > maxBytes) {
      return fail(
        `${JSON.stringify(stat.path)} grew to ${opened.size} bytes, over the ${maxBytes}-byte limit`,
      );
    }
    if (!isSameFile(contained.stats, opened)) {
      return fail(`${JSON.stringify(stat.path)} was replaced as it was opened`);
    }
    bytes = await handle.readFile();
  } finally {
    await handle.close().catch(() => undefined);
  }

  if (bytes.byteLength > maxBytes) {
    return fail(
      `${JSON.stringify(stat.path)} is ${bytes.byteLength} bytes, over the ${maxBytes}-byte limit`,
    );
  }

  try {
    return { ok: true, text: UTF8.decode(bytes) };
  } catch {
    return fail(`${JSON.stringify(stat.path)} is not valid UTF-8`);
  }
}

/** One reason this artifact produced no text. */
function fail(message: string): ArtifactReadResult {
  return {
    ok: false,
    error: { code: "READ_FAILED", message, severity: "error" },
  };
}

/** `true` when both stats describe the same file object, not the same name. */
function isSameFile(walked: Stats, opened: Stats): boolean {
  return walked.ino === opened.ino && walked.dev === opened.dev;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
