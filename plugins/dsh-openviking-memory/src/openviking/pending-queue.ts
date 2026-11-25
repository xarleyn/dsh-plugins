/**
 * Derived from OpenViking's @openviking/dsh-memory-plugin.
 * Original project: https://github.com/volcengine/OpenViking
 * Licensed under the Apache License, Version 2.0.
 *
 * Modified by the @yadsh/dsh-openviking-memory project.
 */

// GENERATED FROM examples/memory-plugin-shared/lib. DO NOT EDIT.
/**
 * Local pending queue for offline resilience.
 *
 * When the OpenViking server is temporarily unreachable, write operations
 * (addMessage, commitSession) serialize their payloads to
 * `~/.openviking/pending/` as JSON files. The queue is replayed in small
 * batches, either at session-start (consuming retry budgets, with
 * maxRetries/TTL) or by a long-running drainer that passes
 * `consumeRetries: false` so transient failures stay retryable.
 *
 * Each file contains: { type, sessionId, payload, createdAt, retries, dedupKey,
 * user }
 *
 * Config (env vars):
 *   OPENVIKING_PENDING_DIR         pending queue directory
 *                                  (default: ~/.openviking/pending)
 *   OPENVIKING_PENDING_MAX_RETRIES max retry attempts per item (default: 3)
 *   OPENVIKING_PENDING_TTL_DAYS    max age in days before stale cleanup
 *                                  (default: 7)
 *   OPENVIKING_PENDING_REPLAY_LIMIT max items replayed per session-start
 *                                  (default: 50)
 */

import {
  mkdir,
  readFile,
  rename,
  writeFile,
  unlink,
  stat,
  chmod,
  rmdir,
  utimes,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { isRetryableFailure } from "./retryable.js";
import type { RetryableResult } from "./retryable.js";
import {
  allQueueFiles,
  commitBucket,
  entryBucket,
  legacyIndex,
  names,
} from "./pending-layout.js";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TTL_DAYS = 7;
const DEFAULT_REPLAY_LIMIT = 50;
const PROCESSING_STALE_MS = 10 * 60 * 1000;
const DEFAULT_PENDING_DIR = (): string =>
  join(homedir(), ".openviking", "pending");

// Pending queue files may contain raw memory payload / transcript content.
// Use restrictive permissions explicitly so we don't depend on umask.
//   - dir: 0o700  (owner: rwx; group/other: none)
//   - file: 0o600 (owner: rw;  group/other: none)
const PENDING_DIR_MODE = 0o700;
const PENDING_FILE_MODE = 0o600;

/** The queue kinds this module serializes. */
export type PendingEntryType = "addMessage" | "commitSession";

/**
 * A single serialized queue entry, exactly as it is stored on disk. `type`
 * stays a plain string because entries are read back from untrusted files.
 */
export interface PendingEntry {
  type: string;
  sessionId: string;
  payload: unknown;
  createdAt: number;
  retries: number;
  dedupKey: string;
  /**
   * FORK LOCAL EDIT (see docs/upstream-sync.md): the OpenViking user this write
   * has to be replayed as. The queue outlives the process that filled it, and
   * an entry whose identity only lived in that process's memory could not be
   * replayed at all after a restart, so the routing identity travels with the
   * entry. Absent in entries written by an older version, and in a deployment
   * that has one identity for everybody there is nothing to record.
   */
  user?: string;
}

/** A pending queue file and its parsed entry. */
export interface PendingListItem {
  readonly filename: string;
  readonly entry: PendingEntry;
}

/** Outcome of `enqueue`. */
export interface EnqueueResult {
  readonly ok: boolean;
  readonly path?: string;
  readonly deduped?: boolean;
  readonly dedupKey: string;
  readonly error?: string;
}

/** Outcome of `replayPending`. */
export interface ReplaySummary {
  readonly replayed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly deferred: number;
}

/** Options for `replayPending`. */
export interface ReplayOptions {
  readonly consumeRetries?: boolean;
}

/** Injected logger. */
export interface ReplayLog {
  (stage: string, data: Record<string, unknown>): void;
}

/**
 * Which identity one replayed request has to be sent as. The queue module does
 * not route anything itself: it hands the entry's own identity to the transport
 * it was injected with, which is the only place that knows how to speak as it.
 */
export interface PendingRouting {
  readonly user?: string;
}

/**
 * Injected HTTP transport, i.e. the configured `fetchJSON`.
 *
 * FORK LOCAL EDIT (see docs/upstream-sync.md): `traceId` admits an explicit
 * `undefined`, because the transport reports "the server sent no trace id"
 * that way. Type-level only; the wire values are unchanged.
 *
 * FORK LOCAL EDIT (see docs/upstream-sync.md): the third parameter carries
 * {@link PendingRouting}, so a replay can be sent as the account that queued
 * the write. Upstream's transport takes the two first parameters and ignores
 * this one.
 */
export type PendingFetchJSON = (
  path: string,
  init?: { readonly method?: string; readonly body?: string },
  routing?: PendingRouting,
) => Promise<{
  readonly ok?: boolean;
  readonly status?: number;
  readonly result?: unknown;
  readonly error?: { readonly message?: string; readonly code?: string } | null;
  readonly traceId?: string | undefined;
}>;

/**
 * What `fetchJSON` resolves to. `result` stays opaque here and is narrowed at
 * each read site, mirroring the untyped upstream access pattern.
 */
type PendingFetchResult = Awaited<ReturnType<PendingFetchJSON>>;

/** The fields of `result` the replay logging actually reads. */
interface ReplayResultFields {
  readonly status?: number;
  readonly trace_id?: string;
}

/**
 * Ensure the pending directory exists with 0o700 permissions. If the
 * directory was created by a previous version of this code (or by hand)
 * with looser permissions, best-effort chmod it on first use.
 */
async function ensurePendingDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: PENDING_DIR_MODE });
  try {
    await chmod(dir, PENDING_DIR_MODE);
  } catch {
    // Best effort: chmod may fail on some platforms (e.g. Windows); not fatal.
  }
}

function getPendingDir(): string {
  return process.env.OPENVIKING_PENDING_DIR || DEFAULT_PENDING_DIR();
}

function getMaxRetries(): number {
  const v = parseInt(process.env.OPENVIKING_PENDING_MAX_RETRIES || "", 10);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_MAX_RETRIES;
}

function getTTLDays(): number {
  const v = parseInt(process.env.OPENVIKING_PENDING_TTL_DAYS || "", 10);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_TTL_DAYS;
}

function getReplayLimit(): number {
  const v = parseInt(process.env.OPENVIKING_PENDING_REPLAY_LIMIT || "", 10);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_REPLAY_LIMIT;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${(value as readonly unknown[]).map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
}

function makeDedupKey(
  type: string,
  sessionId: string,
  payload: unknown,
): string {
  return createHash("sha256")
    .update(type)
    .update("\n")
    .update(sessionId)
    .update("\n")
    .update(stableStringify(payload))
    .digest("hex");
}

function pendingFilename(dedupKey: string, retries: number = 0): string {
  return `${dedupKey}_${Math.max(0, Number(retries) || 0)}.json`;
}

function retryFilename(filename: string, retries: number): string {
  const bare = pendingFromProcessingFilename(filename).replace(/\.json$/, "");
  const nextBare = /_\d+$/.test(bare)
    ? bare.replace(/_\d+$/, `_${retries}`)
    : `${bare}_${retries}`;
  return `${nextBare}.json`;
}

function processingFilename(filename: string): string {
  // The lease is part of the atomic rename itself. Refreshing mtime after a
  // rename leaves a window in which an old backlog item looks stale again.
  return filename.replace(
    /\.json$/,
    `.${Date.now()}.${randomUUID()}.processing`,
  );
}

const LEASE_SUFFIX = /\.(\d+)\.[a-f0-9-]+\.processing$/;

function pendingFromProcessingFilename(filename: string): string {
  return filename
    .replace(LEASE_SUFFIX, ".json")
    .replace(/\.processing$/, ".json");
}

function isRetryableReplayFailure(
  res: PendingFetchResult | null | undefined,
): boolean {
  return isRetryableFailure(res as RetryableResult);
}

/**
 * The routing identity stored with one entry. Entries come off disk, so a
 * hand-edited or half-migrated file can hold anything in this field, and only a
 * real string is worth handing to the transport as an identity.
 */
function routingOf(entry: PendingEntry): PendingRouting {
  return typeof entry.user === "string" ? { user: entry.user } : {};
}

async function readEntry(dir: string, filename: string): Promise<PendingEntry> {
  const raw = await readFile(join(dir, filename), "utf-8");
  return JSON.parse(raw) as PendingEntry;
}

async function findExistingByDedupKey(
  dir: string,
  dedupKey: string,
): Promise<{ readonly filename: string; readonly entry: PendingEntry } | null> {
  let files: string[];
  try {
    files = await names(dir);
  } catch {
    return null;
  }

  // Modern messages have a bucket per digest. An indexed hit on an old flat
  // entry or a session's commits can also reach here: only open its own file.
  const prefix = `${dedupKey}_`;

  for (const f of files) {
    if (!f.startsWith(prefix)) continue;
    if (!f.endsWith(".json") && !f.endsWith(".processing")) continue;
    try {
      const entry = await readEntry(dir, f);
      if (entry?.dedupKey === dedupKey) return { filename: f, entry };
    } catch {
      // Corrupted file - ignore for dedup lookup.
    }
  }
  return null;
}

async function recoverStaleProcessing(
  dir: string,
  files: readonly string[],
): Promise<number> {
  const now = Date.now();
  let recovered = 0;
  for (const f of files) {
    if (!f.endsWith(".processing")) continue;
    const from = join(dir, f);
    try {
      const lease = LEASE_SUFFIX.exec(f);
      // Retain recovery support for pre-lease .processing files after upgrade.
      if (lease && now - Number(lease[1]) < PROCESSING_STALE_MS) continue;
      if (now - (await stat(from)).mtimeMs < PROCESSING_STALE_MS) continue;
      const to = join(dir, pendingFromProcessingFilename(f));
      await rename(from, to);
      recovered++;
    } catch {
      // Best effort. A concurrent process may have already handled it.
    }
  }
  return recovered;
}

/**
 * Enqueue a failed operation to local disk.
 *
 * @param type - "addMessage" or "commitSession"
 * @param sessionId - OV session ID
 * @param payload - the data that failed to send
 * @param options - `createdAt` is an optional queue timestamp override; `user`
 *   is the identity the replay has to be sent as
 */
export async function enqueue(
  type: PendingEntryType,
  sessionId: string,
  payload: unknown,
  options: {
    readonly createdAt?: number;
    readonly user?: string;
    readonly finalCommit?: boolean;
  } = {},
): Promise<EnqueueResult> {
  const dir = getPendingDir();
  const now = Number.isFinite(options.createdAt)
    ? (options.createdAt as number)
    : Date.now();
  // A final commit covers all messages preceding this request. An earlier
  // commit already in flight may have the same body but a different boundary.
  const dedupKey = makeDedupKey(
    type,
    sessionId,
    options.finalCommit ? [payload, randomUUID()] : payload,
  );
  const bucket = entryBucket(type, sessionId, dedupKey);
  const bucketDir = join(dir, bucket);
  const filename = join(bucket, pendingFilename(dedupKey, 0));
  const entry: PendingEntry = {
    type,
    sessionId,
    payload,
    createdAt: now,
    retries: 0,
    dedupKey,
    ...(options.user === undefined ? {} : { user: options.user }),
  };

  try {
    await ensurePendingDir(dir);
    if ((await legacyIndex(dir)).keys.has(dedupKey)) {
      const previous = await findExistingByDedupKey(dir, dedupKey);
      if (previous)
        return { ok: true, path: previous.filename, deduped: true, dedupKey };
    }
    await mkdir(bucketDir, { recursive: true, mode: PENDING_DIR_MODE });
  } catch (err) {
    return {
      ok: false,
      error: (err as { message?: string } | null)?.message || String(err),
      dedupKey,
    };
  }

  const existing = await findExistingByDedupKey(bucketDir, dedupKey);
  if (existing) {
    return {
      ok: true,
      path: join(bucket, existing.filename),
      deduped: true,
      dedupKey,
    };
  }

  try {
    const write = () =>
      writeFile(join(dir, filename), JSON.stringify(entry), {
        encoding: "utf-8",
        flag: "wx",
        mode: PENDING_FILE_MODE,
      });
    try {
      await write();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // The preceding entry in the same bucket was acknowledged concurrently.
      await mkdir(bucketDir, { recursive: true, mode: PENDING_DIR_MODE });
      await write();
    }
    return { ok: true, path: filename, dedupKey };
  } catch (err) {
    if ((err as { code?: string } | null)?.code !== "EEXIST") {
      return {
        ok: false,
        error: (err as { message?: string } | null)?.message || String(err),
        dedupKey,
      };
    }
  }

  const duplicate = await findExistingByDedupKey(bucketDir, dedupKey);
  if (duplicate) {
    return {
      ok: true,
      path: join(bucket, duplicate.filename),
      deduped: true,
      dedupKey,
    };
  }
  return {
    ok: false,
    error: `pending file exists but dedup entry was not readable: ${filename}`,
    dedupKey,
  };
}

/**
 * List all pending queue entries.
 * Returns array of { filename, entry } sorted by createdAt ascending.
 */
export async function readQueueSnapshot(
  includeProcessing = false,
): Promise<{ entries: PendingListItem[]; unsettled: number }> {
  const dir = getPendingDir();
  let unsettled = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    let files = await allQueueFiles(dir);
    if (await recoverStaleProcessing(dir, files))
      files = await allQueueFiles(dir);
    const entries: PendingListItem[] = [];
    let changed = false;
    for (const filename of files) {
      if (!includeProcessing && !filename.endsWith(".json")) continue;
      try {
        entries.push({ filename, entry: await readEntry(dir, filename) });
      } catch (error) {
        // A file which became a claim between listing and reading must not
        // disappear from an ordering snapshot and let its successor through.
        if (
          includeProcessing &&
          (error as NodeJS.ErrnoException).code === "ENOENT"
        ) {
          changed = true;
          break;
        }
        // Malformed old entries have always been ignored.
      }
    }
    if (changed) {
      unsettled = files.length;
      continue;
    }
    entries.sort(
      (a, b) =>
        (a.entry.createdAt || 0) - (b.entry.createdAt || 0) ||
        Number(a.entry.type === "commitSession") -
          Number(b.entry.type === "commitSession") ||
        a.filename.localeCompare(b.filename),
    );
    return { entries, unsettled: 0 };
  }
  // Other workers keep moving entries. The next tick can retry without
  // holding up session creation or assuming that there is no pending work.
  return { entries: [], unsettled };
}

export async function listPending(
  includeProcessing = false,
): Promise<PendingListItem[]> {
  return (await readQueueSnapshot(includeProcessing)).entries;
}

/** Queue files which were final commits at the time this writer observed them. */
async function pendingCommitFiles(sessionId: string): Promise<string[]> {
  const dir = getPendingDir();
  const bucket = commitBucket(sessionId);
  const local = (await names(join(dir, bucket))).map((name) =>
    join(bucket, name),
  );
  try {
    const old = (await legacyIndex(dir)).commits.get(sessionId) ?? [];
    return [...old, ...local].filter((filename) => filename.endsWith(".json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** A new message supersedes earlier queued commits; a final commit replaces
 * their boundary only once its own entry is durable. Never remove an active
 * claim or let two concurrent finalizers remove one another's successor. */
export async function queueSessionWrite(
  type: PendingEntryType,
  sessionId: string,
  payload: unknown,
  options: { readonly createdAt: number; readonly user?: string },
): Promise<EnqueueResult> {
  const result = await enqueue(type, sessionId, payload, {
    ...options,
    finalCommit: type === "commitSession",
  });
  if (!result.ok || !result.path) return result;
  for (const filename of await pendingCommitFiles(sessionId)) {
    if (filename === result.path) continue;
    const entry = await readEntry(getPendingDir(), filename).catch(
      () => undefined,
    );
    if (!entry) continue; // Claimed or acknowledged by another worker.
    if (entry.createdAt < options.createdAt) {
      await dequeue(filename);
    } else if (type === "commitSession") {
      // At the same millisecond messages precede the final commit. Between
      // simultaneous commits, all writers must retain the same one.
      const older =
        entry.createdAt === options.createdAt &&
        entry.dedupKey < result.dedupKey;
      await dequeue(older ? filename : result.path);
    }
  }
  return result;
}

/**
 * Atomically claim a pending file for replay. Only the process that successfully
 * renames the file may send the HTTP replay.
 */
export async function claimForReplay(filename: string): Promise<string | null> {
  if (!filename.endsWith(".json")) return null;
  const dir = getPendingDir();
  const claimed = processingFilename(filename);
  try {
    await rename(join(dir, filename), join(dir, claimed));
    return claimed;
  } catch {
    return null;
  }
}

/**
 * Release a claimed file back to the queue without consuming a retry. The
 * entry keeps its original filename, retry count, and createdAt position, so a
 * later run retries it as if this attempt never happened.
 */
export async function releaseClaim(
  claimedFilename: string,
): Promise<string | null> {
  if (!claimedFilename.endsWith(".processing")) return null;
  const dir = getPendingDir();
  const restored = pendingFromProcessingFilename(claimedFilename);
  try {
    await rename(join(dir, claimedFilename), join(dir, restored));
    return restored;
  } catch {
    return null;
  }
}

/**
 * Remove a pending entry after successful replay.
 */
export async function dequeue(filename: string): Promise<boolean> {
  const dir = getPendingDir();
  try {
    await unlink(join(dir, filename));
    if (dirname(filename) !== ".")
      await rmdir(join(dir, dirname(filename))).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/**
 * Increment retry count on a pending entry. Returns false if max retries exceeded.
 */
export async function incrementRetry(
  filename: string,
  entry: PendingEntry,
): Promise<boolean> {
  const dir = getPendingDir();
  const maxRetries = getMaxRetries();
  // Transfer ownership before changing content. A late failure from a lease
  // already recovered by another worker cannot create a second queued retry.
  const owned = processingFilename(pendingFromProcessingFilename(filename));
  try {
    await rename(join(dir, filename), join(dir, owned));
  } catch {
    return false;
  }
  entry.retries = (entry.retries || 0) + 1;

  if (entry.retries > maxRetries) {
    try {
      await dequeue(owned);
    } catch {
      // Best effort.
    }
    return false;
  }

  const newFilename = retryFilename(filename, entry.retries);
  // Replace content while it is still leased, then publish it with a single
  // rename. A crash at either boundary leaves one recoverable complete entry.
  const tmpFilename = `${owned}.${randomUUID()}.tmp`;
  try {
    await writeFile(join(dir, tmpFilename), JSON.stringify(entry), {
      encoding: "utf-8",
      flag: "wx",
      mode: PENDING_FILE_MODE,
    });
    await rename(join(dir, tmpFilename), join(dir, owned));
    await rename(join(dir, owned), join(dir, newFilename));
    return true;
  } catch {
    await unlink(join(dir, tmpFilename)).catch(() => {});
    return false;
  }
}

/**
 * Clean up stale entries older than TTL.
 */
export async function cleanStale(): Promise<number> {
  const ttlMs = getTTLDays() * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const pending = await listPending();
  let cleaned = 0;

  for (const { filename, entry } of pending) {
    const age = now - (entry.createdAt || 0);
    if (age > ttlMs && (await dequeue(filename))) cleaned++;
  }
  return cleaned;
}

/**
 * Replay pending entries. Call this during session-start when the server is
 * healthy. Each run processes at most OPENVIKING_PENDING_REPLAY_LIMIT items so
 * a just-recovered server is not hit with an unbounded replay burst.
 *
 * @param fetchJSON - the configured fetchJSON from makeFetchJSON
 * @param log - logger function
 * @param options - `consumeRetries` defaults to true; when false, retryable
 *   failures release their claim instead of incrementing the retry count, so
 *   a background drainer can keep retrying a transient failure without
 *   burning the session-start retry budget. Exhausted and non-retryable
 *   entries are deleted exactly as in the default mode.
 */
export async function replayPending(
  fetchJSON: PendingFetchJSON,
  log: ReplayLog,
  options: ReplayOptions = {},
): Promise<ReplaySummary> {
  const consumeRetries = options.consumeRetries !== false;
  const { entries: pending, unsettled } = await readQueueSnapshot(true);
  if (pending.length === 0) {
    return { replayed: 0, failed: 0, skipped: 0, deferred: unsettled };
  }

  const replayLimit = getReplayLimit();
  log("pending-queue", {
    count: pending.length,
    replayLimit,
    action: "replay-start",
  });

  let replayed = 0;
  let failed = 0;
  let skipped = 0;
  let deferred = 0;
  let processed = 0;
  const busySessions = new Set(
    pending
      .filter(({ filename }) => filename.endsWith(".processing"))
      .map(({ entry }) => entry.sessionId),
  );
  const discardClaim = async (filename: string, sessionId: string) => {
    const removed = await dequeue(filename);
    if (!removed) busySessions.add(sessionId);
    return removed;
  };

  for (const { filename, entry } of pending) {
    if (processed >= replayLimit || busySessions.has(entry.sessionId)) {
      deferred++;
      continue;
    }

    const claimedFilename = await claimForReplay(filename);
    if (!claimedFilename) {
      busySessions.add(entry.sessionId);
      skipped++;
      continue;
    }
    if ((entry.retries || 0) >= getMaxRetries()) {
      await discardClaim(claimedFilename, entry.sessionId);
      skipped++;
      continue;
    }
    processed++;

    let res: PendingFetchResult | undefined;
    const claimedPath = join(getPendingDir(), claimedFilename);
    const renewal = setInterval(() => {
      const now = new Date();
      void utimes(claimedPath, now, now).catch(() => {});
    }, PROCESSING_STALE_MS / 3);
    renewal.unref();
    try {
      const encodedSid = encodeURIComponent(entry.sessionId);
      const routing = routingOf(entry);
      if (entry.type === "addMessage") {
        res = await fetchJSON(
          `/api/v1/sessions/${encodedSid}/messages`,
          {
            method: "POST",
            body: JSON.stringify(entry.payload),
          },
          routing,
        );
      } else if (entry.type === "commitSession") {
        res = await fetchJSON(
          `/api/v1/sessions/${encodedSid}/commit`,
          {
            method: "POST",
            body: JSON.stringify(entry.payload || {}),
          },
          routing,
        );
      } else {
        await discardClaim(claimedFilename, entry.sessionId);
        skipped++;
        continue;
      }
    } catch {
      res = { ok: false };
    } finally {
      clearInterval(renewal);
    }

    if (entry.type === "commitSession") {
      const result = res?.result as ReplayResultFields | null | undefined;
      log("pending-queue", {
        action: "commit-replay",
        sessionId: entry.sessionId,
        ok: Boolean(res?.ok),
        status: result?.status || res?.status,
        trace_id: res?.traceId || result?.trace_id,
        error: res?.ok ? undefined : res?.error?.message || res?.error?.code,
      });
    }

    if (res?.ok) {
      if (await discardClaim(claimedFilename, entry.sessionId)) replayed++;
      else skipped++;
    } else if (!isRetryableReplayFailure(res)) {
      await discardClaim(claimedFilename, entry.sessionId);
      skipped++;
    } else {
      if (consumeRetries) {
        if (!(await incrementRetry(claimedFilename, entry)))
          busySessions.add(entry.sessionId);
      } else {
        const released = await releaseClaim(claimedFilename);
        if (!released) busySessions.add(entry.sessionId);
        log("pending-queue", {
          action: released ? "replay-deferred" : "release-failed",
          sessionId: entry.sessionId,
          type: entry.type,
          status:
            (res?.result as ReplayResultFields | null | undefined)?.status ||
            res?.status,
          retries: entry.retries || 0,
        });
      }
      failed++;
      if (entry.type === "addMessage") busySessions.add(entry.sessionId);
    }
  }

  const cleaned = await cleanStale();

  log("pending-queue", {
    action: "replay-done",
    replayed,
    failed,
    skipped,
    deferred,
    cleaned,
  });

  return { replayed, failed, skipped, deferred };
}
