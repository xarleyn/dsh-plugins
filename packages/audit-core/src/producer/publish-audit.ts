/**
 * The producer protocol: how an auditor hands a finished audit to the root
 * that the registry watches.
 *
 * The rule the SPEC §27 and §53 spell out is that a half-written directory is
 * never observable. A reader scanning the root sees either nothing or a
 * complete audit, because the two artifact files are written into a staging
 * directory inside the root and the directory as a whole is moved into place
 * by a single rename.
 *
 * A producer that writes its own files is still supported — that is how the
 * audit artefacts in the wild are made today — and the watcher's settle logic
 * exists for exactly that case. This module is the cheap path that makes the
 * racy one unnecessary.
 */
import { open, lstat, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  AUDIT_ANALYSIS_FILENAME,
  AUDIT_INCOMING_DIRECTORY,
  AUDIT_REPORT_FILENAME,
  auditDirectoryName,
  auditDirectoryPath,
} from "../paths.js";
import { parseAuditAnalysis } from "../parser/parse-analysis.js";
import type { AuditError } from "../types.js";

/** What to publish and where. */
export interface PublishAuditRequest {
  /** The audit root the registry watches. Created when absent. */
  readonly auditRoot: string;
  /**
   * The decoded `analysis.json` value.
   *
   * Taken as a value rather than as text so that validation runs against the
   * exact bytes that get written: a producer cannot validate one document and
   * publish another.
   */
  readonly analysis: unknown;
  /** The `REPORT.md` contents. */
  readonly report: string;
  /**
   * Directory name to publish under. Defaults to
   * `session-<first segment of the session id>`.
   */
  readonly directoryName?: string;
  /**
   * What to do when the target directory already exists.
   *
   * - `"unique"` (default) — publish beside it under a `-2`, `-3`, … suffix.
   *   Audits are never destroyed by a producer; the registry treats the newest
   *   valid one as active and the rest become history (SPEC §28).
   * - `"replace"` — move the existing directory aside and remove it after the
   *   new one lands. Only for a producer that owns the directory outright.
   */
  readonly onConflict?: "unique" | "replace";
  /** Pretty-print width for `analysis.json`. */
  readonly indent?: number;
}

/** Where an audit landed. */
export interface PublishAuditResult {
  /** Absolute path of the published audit directory. */
  readonly directory: string;
  /** The directory's name, which is also its `auditId`. */
  readonly auditId: string;
}

/** A publish that could not be completed. */
export class AuditPublishError extends Error {
  /** Why the publish failed, in the registry's own vocabulary. */
  readonly errors: readonly AuditError[];

  constructor(message: string, errors: readonly AuditError[]) {
    super(message);
    this.name = "AuditPublishError";
    this.errors = errors;
  }
}

/** Write a file and flush it to the device before returning. */
async function writeAndSync(path: string, contents: string): Promise<void> {
  const handle = await open(path, "w");
  try {
    await handle.writeFile(contents, "utf8");
    // Without the fsync a crash can leave a directory entry whose contents
    // never reached the device — precisely the torn artifact rename is meant
    // to prevent.
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** The first free `<name>`, `<name>-2`, `<name>-3`, … */
async function uniqueDirectoryName(
  root: string,
  name: string,
): Promise<string> {
  for (let suffix = 1; suffix < 1_000; suffix += 1) {
    const candidate = suffix === 1 ? name : `${name}-${suffix}`;
    const path = auditDirectoryPath(root, candidate);
    if (!(await pathExists(path))) return candidate;
  }
  throw new AuditPublishError(
    `cannot find a free audit directory name for ${JSON.stringify(name)}`,
    [
      {
        code: "READ_FAILED",
        message: `all ${name}-<n> directory names up to 1000 are taken`,
        severity: "error",
      },
    ],
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    // lstat, not stat: a dangling symlink still occupies the name.
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

/** The session a decoded analysis declares, without validating the whole document. */
function declaredSessionId(analysis: unknown): string | null {
  if (typeof analysis !== "object" || analysis === null) return null;
  const trajectory = (analysis as { trajectory?: unknown }).trajectory;
  if (typeof trajectory !== "object" || trajectory === null) return null;
  const sessionId = (trajectory as { sessionId?: unknown }).sessionId;
  return typeof sessionId === "string" && sessionId.trim().length > 0
    ? sessionId.trim()
    : null;
}

/**
 * Validate, stage and atomically publish one audit.
 *
 * @throws {AuditPublishError} when the analysis fails validation, the
 * directory name is unusable, or the root cannot be written. The staging
 * directory is removed on every failure path.
 */
export async function publishAudit(
  request: PublishAuditRequest,
): Promise<PublishAuditResult> {
  const analysisText = `${JSON.stringify(request.analysis, null, request.indent ?? 2)}\n`;

  // Validate what will actually be written, not the caller's in-memory object.
  const parsed = parseAuditAnalysis(analysisText);
  if (!parsed.ok) {
    throw new AuditPublishError(
      "refusing to publish an invalid analysis",
      parsed.errors,
    );
  }

  const sessionId = declaredSessionId(request.analysis);
  const name =
    request.directoryName ??
    (sessionId === null ? undefined : auditDirectoryName(sessionId));
  if (name === undefined) {
    throw new AuditPublishError(
      "refusing to publish an analysis without a trajectory.sessionId",
      [
        {
          code: "INVALID_SCHEMA",
          message:
            "analysis.trajectory.sessionId is required to name the audit directory",
          severity: "error",
        },
      ],
    );
  }
  // Throws on a name that would escape the root.
  auditDirectoryPath(request.auditRoot, name);

  const incomingRoot = join(request.auditRoot, AUDIT_INCOMING_DIRECTORY);
  const conflict = request.onConflict ?? "unique";
  let staging: string | undefined;

  try {
    await mkdir(incomingRoot, { recursive: true });
    staging = await stagingDirectory(incomingRoot);

    await writeAndSync(join(staging, AUDIT_ANALYSIS_FILENAME), analysisText);
    await writeAndSync(join(staging, AUDIT_REPORT_FILENAME), request.report);

    const targetName =
      conflict === "replace"
        ? name
        : await uniqueDirectoryName(request.auditRoot, name);
    const target = auditDirectoryPath(request.auditRoot, targetName);

    let displaced: string | undefined;
    if (conflict === "replace" && (await pathExists(target))) {
      // Move the incumbent out of the way first. The name must not exist:
      // `rename` onto an existing directory fails outright on Windows and
      // merges into it on POSIX, and a merge would leave a directory holding
      // half of each audit.
      displaced = await freeStagingPath(incomingRoot);
      await rename(target, displaced);
    }

    try {
      await rename(staging, target);
    } catch (error) {
      if (displaced !== undefined) {
        await rename(displaced, target);
        displaced = undefined;
      }
      throw error;
    }
    staging = undefined;
    if (displaced !== undefined) {
      await rm(displaced, { recursive: true, force: true });
    }

    return { directory: target, auditId: targetName };
  } catch (error) {
    if (staging !== undefined) {
      await rm(staging, { recursive: true, force: true });
    }
    if (error instanceof AuditPublishError) throw error;
    throw new AuditPublishError(
      `failed to publish the audit: ${
        error instanceof Error ? error.message : String(error)
      }`,
      [
        {
          code: "READ_FAILED",
          message: error instanceof Error ? error.message : String(error),
          severity: "error",
        },
      ],
    );
  }
}

/** A fresh empty directory inside the incoming area. */
async function stagingDirectory(incomingRoot: string): Promise<string> {
  return mkdtemp(join(incomingRoot, "staging-"));
}

/** A name inside the incoming area that is guaranteed not to exist yet. */
async function freeStagingPath(incomingRoot: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = join(incomingRoot, `displaced-${randomUUID()}`);
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new AuditPublishError(
    "cannot find a free staging name for the displaced audit",
    [
      {
        code: "READ_FAILED",
        message: "100 random staging names in the audit root were all taken",
        severity: "error",
      },
    ],
  );
}
