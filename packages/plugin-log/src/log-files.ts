/**
 * The daily log files themselves: the stamp that names them and the retention
 * sweep that prunes the ones outside the window. Both read the file system
 * defensively — an unreadable directory is not a logging failure.
 */

import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

/** Daily log files kept per plugin by default (0 = keep forever). */
export const DEFAULT_LOG_RETENTION_DAYS = 14;

const DAY_MS = 86_400_000;

const LOG_FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.log$/;

/** Local-calendar date stamp used in file names (sorts lexically). */
export function dayStamp(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export async function sweepOldLogFiles(
  dir: string,
  retentionDays: number,
  nowMs: number,
): Promise<void> {
  if (retentionDays <= 0) return;
  const cutoff = nowMs - retentionDays * DAY_MS;
  const entries = await readdir(dir).catch(() => [] as string[]);
  for (const entry of entries) {
    const match = LOG_FILE_PATTERN.exec(entry);
    if (match === null || match[1] === undefined) continue;
    const stampMs = Date.parse(`${match[1]}T00:00:00`);
    if (!Number.isFinite(stampMs) || stampMs >= cutoff) continue;
    await unlink(join(dir, entry)).catch(() => undefined);
  }
}
