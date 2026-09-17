/**
 * Enumeration of the audit root.
 *
 * The scan is metadata-only by design (SPEC §23): it lists the immediate
 * directories and stats the two artifact files, and reads no file contents.
 * That keeps a 30-second reconciliation cheap enough to be unconditional, and
 * it is what lets the registry decide whether anything actually changed before
 * paying for a read.
 *
 * The layout is fixed and never walked recursively (SPEC §21) — an audit is a
 * directory holding `analysis.json` and `REPORT.md`, and anything else under
 * the root is not this plugin's business.
 */
import { readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import {
  AUDIT_ANALYSIS_FILENAME,
  AUDIT_REPORT_FILENAME,
} from "@yadsh/dsh-audit-core/paths";
import type { AuditError } from "@yadsh/dsh-audit-core";

/** Metadata for one artifact file, as the scanner saw it. */
export interface AuditArtifactStat {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
}

/** One candidate audit directory under the root. */
export interface DiscoveredAudit {
  /** Directory basename, which is the audit's id until a producer names one. */
  readonly name: string;
  readonly directory: string;
  readonly analysis: AuditArtifactStat | null;
  readonly report: AuditArtifactStat | null;
}

/** What one pass over the root found. */
export interface AuditScanResult {
  readonly audits: readonly DiscoveredAudit[];
  /** Non-fatal notes: an unreadable root, a skipped symlink. */
  readonly warnings: readonly AuditError[];
}

/**
 * Stat one expected artifact.
 *
 * A symlink is reported as absent rather than followed (SPEC §64): an audit is
 * a directory someone copied in, and a link is the one shape that can point
 * outside the root. Refusing them outright removes the containment question
 * instead of answering it.
 */
async function statArtifact(
  directory: string,
  filename: string,
): Promise<AuditArtifactStat | null> {
  const path = join(directory, filename);
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isFile()) return null;
    return { path, size: stats.size, mtimeMs: stats.mtimeMs };
  } catch {
    return null;
  }
}

/** Enumerate the audit root's immediate directories and their artifacts. */
export async function scanAuditRoot(root: string): Promise<AuditScanResult> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      // An absent root is the normal state of a machine that has not audited
      // anything yet, not a fault worth reporting.
      return { audits: [], warnings: [] };
    }
    return {
      audits: [],
      warnings: [
        {
          code: "READ_FAILED",
          message: `cannot read the audit root ${JSON.stringify(root)}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          severity: "warning",
        },
      ],
    };
  }

  const audits: DiscoveredAudit[] = [];
  const warnings: AuditError[] = [];

  for (const entry of entries) {
    // Dot-entries cover `.incoming`, the producer's staging area, and any
    // editor or sync-tool droppings. Neither is an audit.
    if (entry.name.startsWith(".")) continue;
    if (entry.isSymbolicLink()) {
      warnings.push({
        code: "READ_FAILED",
        message: `skipping symlink ${JSON.stringify(entry.name)} in the audit root`,
        severity: "warning",
      });
      continue;
    }
    if (!entry.isDirectory()) continue;

    const directory = join(root, entry.name);
    const analysis = await statArtifact(directory, AUDIT_ANALYSIS_FILENAME);
    const report = await statArtifact(directory, AUDIT_REPORT_FILENAME);
    // A directory holding neither artifact is not a pending audit; it is not
    // an audit at all. Only a half-arrived audit is worth reporting upstream.
    if (analysis === null && report === null) continue;

    audits.push({ name: entry.name, directory, analysis, report });
  }

  audits.sort((left, right) => left.name.localeCompare(right.name));
  return { audits, warnings };
}
