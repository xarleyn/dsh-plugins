/**
 * Reading one artifact's bytes, within the limits the config declares.
 *
 * Everything here defends against the audit being untrusted input (SPEC §62):
 * the size is checked before the read, the path is proved to sit under the
 * configured root, a symlink is refused, and the bytes must decode as UTF-8
 * rather than being silently replaced.
 */
import { readFile, lstat } from "node:fs/promises";
import { isPathContained } from "@yadsh/dsh-audit-core/paths";
import type { AuditError } from "@yadsh/dsh-audit-core";
import type { AuditArtifactStat } from "./audit-scanner.js";

/** A read that either produced text or explained why it could not. */
export type ArtifactReadResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: AuditError };

/** Decode with `fatal`, so a malformed byte becomes an error, not a `\uFFFD`. */
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

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
  if (!isPathContained(auditRoot, stat.path)) {
    return {
      ok: false,
      error: {
        code: "READ_FAILED",
        message: `${JSON.stringify(stat.path)} is outside the audit root`,
        severity: "error",
      },
    };
  }

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

  let bytes: Buffer;
  try {
    // Re-check the file type at read time: the scan's verdict is a snapshot,
    // and a symlink swapped in between the two would otherwise be followed.
    const current = await lstat(stat.path);
    if (current.isSymbolicLink() || !current.isFile()) {
      return {
        ok: false,
        error: {
          code: "READ_FAILED",
          message: `${JSON.stringify(stat.path)} is no longer a regular file`,
          severity: "error",
        },
      };
    }
    if (current.size > maxBytes) {
      return {
        ok: false,
        error: {
          code: "FILE_TOO_LARGE",
          message: `${JSON.stringify(stat.path)} grew to ${current.size} bytes, over the ${maxBytes}-byte limit`,
          severity: "error",
        },
      };
    }
    bytes = await readFile(stat.path);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "READ_FAILED",
        message: `cannot read ${JSON.stringify(stat.path)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        severity: "error",
      },
    };
  }

  try {
    return { ok: true, text: UTF8.decode(bytes) };
  } catch {
    return {
      ok: false,
      error: {
        code: "READ_FAILED",
        message: `${JSON.stringify(stat.path)} is not valid UTF-8`,
        severity: "error",
      },
    };
  }
}
