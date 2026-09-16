import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  DEFAULT_QA_PROVENANCE_RETENTION,
  type QaProvenanceRetention,
} from "./retention.js";
import type { QaTurnSources } from "./types.js";

const locationSchema = z
  .object({
    path: z.string().optional(),
    lineStart: z.number().int().optional(),
    lineEnd: z.number().int().optional(),
    anchor: z.string().optional(),
    jiraKey: z.string().optional(),
    confluencePageId: z.string().optional(),
  })
  .strict();

const originSchema = z
  .object({
    sessionId: z.string(),
    turn: z.number().int(),
    step: z.number().int().optional(),
    toolCallId: z.string().optional(),
    toolName: z.string().optional(),
    agentId: z.string().optional(),
    role: z.enum(["parent", "subagent"]),
    subagentRunId: z.string().optional(),
    subagentSessionId: z.string().optional(),
  })
  .strict();

const sourceSchema = z
  .object({
    id: z.string(),
    kind: z.enum([
      "file",
      "code",
      "web",
      "jira",
      "confluence",
      "knowledge",
      "other",
    ]),
    title: z.string(),
    uri: z.string().optional(),
    path: z.string().optional(),
    snippet: z.string().optional(),
    locations: z.array(locationSchema),
    evidence: z.enum([
      "read",
      "fetched",
      "queried",
      "reported",
      "inherited",
      "discovered",
    ]),
    origins: z.array(originSchema),
    score: z.number(),
    metadata: z.record(z.string(), z.json()).optional(),
  })
  .strict();

const bundleSchema = z
  .object({
    version: z.literal(1),
    sessionId: z.string(),
    turn: z.number().int().nonnegative(),
    sources: z.array(sourceSchema),
    discovered: z.array(sourceSchema).optional(),
    complete: z.boolean(),
    incompleteOrigins: z
      .array(
        z
          .object({
            subagentRunId: z.string().optional(),
            provider: z.string().optional(),
            reason: z.string(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

/** One chat's turns as they rest in a shard file. */
const shardSchema = z
  .object({
    version: z.literal(1),
    sessionId: z.string(),
    updatedAt: z.string(),
    turns: z.record(z.string(), bundleSchema),
    emptyTurns: z.array(z.number().int().nonnegative()).default([]),
  })
  .strict();

/** The pre-sharding single-file layout, read once during migration. */
const legacyFileSchema = z
  .object({
    version: z.literal(1),
    sessions: z.record(z.string(), z.record(z.string(), bundleSchema)),
  })
  .strict();

interface ShardFile {
  readonly version: 1;
  readonly sessionId: string;
  readonly updatedAt: string;
  readonly turns: Record<string, QaTurnSources>;
  readonly emptyTurns: readonly number[];
}

export interface QaProvenanceSnapshotStore {
  list(sessionId: string): readonly QaTurnSources[];
  put(bundle: QaTurnSources): void;
  /**
   * Drop one session's snapshots. The host store wires this to the session's
   * disposal, which is what keeps the durable file from growing with every
   * chat a long-lived server ever served.
   */
  drop(sessionId: string): void;
}

/**
 * Retention bounds and their defaults live in a Node-free module: the resolved
 * default config reaches the browser bundle, and this file does not.
 */
export {
  DEFAULT_QA_PROVENANCE_RETENTION,
  QA_PROVENANCE_RETENTION_LIMITS,
} from "./retention.js";
export type { QaProvenanceRetention } from "./retention.js";

/** What one directory sweep did, for the maintenance command and the tests. */
export interface QaProvenanceSweepResult {
  readonly scanned: number;
  readonly droppedByAge: number;
  readonly droppedByCount: number;
}

/** Process-local store used by tests and explicit ephemeral deployments. */
export class MemoryQaProvenanceSnapshotStore implements QaProvenanceSnapshotStore {
  private readonly sessions = new Map<string, Map<number, QaTurnSources>>();

  list(sessionId: string): readonly QaTurnSources[] {
    return [...(this.sessions.get(sessionId)?.values() ?? [])].sort(
      (left, right) => left.turn - right.turn,
    );
  }

  put(bundle: QaTurnSources): void {
    const turns = this.sessions.get(bundle.sessionId) ?? new Map();
    turns.set(bundle.turn, structuredClone(bundle));
    this.sessions.set(bundle.sessionId, turns);
  }

  drop(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}

/** Default durable provenance directory, deliberately outside Harness journals. */
export function defaultQaProvenanceDirectoryPath(): string {
  const home = process.env.DSH_HOME?.trim();
  return path.join(
    home !== undefined && home !== "" ? home : process.cwd(),
    "qa-sources",
  );
}

/** The pre-sharding monolith, migrated on first use and then left alone. */
export function defaultLegacyProvenanceFilePath(): string {
  return `${defaultQaProvenanceDirectoryPath()}.json`;
}

function emptyBundle(sessionId: string, turn: number): QaTurnSources {
  return { version: 1, sessionId, turn, complete: true, sources: [] };
}

/**
 * A bundle that carries no finding at all: the collection finished, nothing
 * was collected, nothing was discovered and no origin stayed opaque. These
 * were 94% of the frames on the live stand, so they are recorded as bare turn
 * numbers instead of a 111-byte frame and rebuilt on read with
 * `complete: true` — the distinction the UI relies on between "collected,
 * nothing found" and "never collected".
 *
 * An incomplete collection is never collapsed: `complete: false` is a claim
 * about the turn that a bare turn number must not overwrite.
 */
function isEmptyBundle(bundle: QaTurnSources): boolean {
  return (
    bundle.complete &&
    bundle.sources.length === 0 &&
    (bundle.discovered?.length ?? 0) === 0 &&
    (bundle.incompleteOrigins?.length ?? 0) === 0
  );
}

/** Stable file name for a chat id: ids are host-generated and may be long. */
function shardName(sessionId: string): string {
  return `${createHash("sha256").update(sessionId).digest("hex").slice(0, 16)}.json`;
}

/** Newest-first turn retention across both halves of a shard. */
function applyTurnRetention(
  turns: Record<string, QaTurnSources>,
  emptyTurns: readonly number[],
  maxTurns: number,
): { turns: Record<string, QaTurnSources>; emptyTurns: readonly number[] } {
  if (maxTurns <= 0) return { turns, emptyTurns };
  const numbers = [
    ...Object.values(turns).map((bundle) => bundle.turn),
    ...emptyTurns,
  ];
  if (numbers.length <= maxTurns) return { turns, emptyTurns };
  const keep = new Set(
    numbers.sort((left, right) => right - left).slice(0, maxTurns),
  );
  const keptTurns: Record<string, QaTurnSources> = {};
  for (const [key, bundle] of Object.entries(turns)) {
    if (keep.has(bundle.turn)) keptTurns[key] = bundle;
  }
  return {
    turns: keptTurns,
    emptyTurns: emptyTurns
      .filter((turn) => keep.has(turn))
      .sort((left, right) => left - right),
  };
}

/**
 * Durable provenance, one file per chat.
 *
 * The read API is per-session and nothing enumerates every chat, so a shard is
 * exactly the unit a writer touches: a turn rewrites one chat's history rather
 * than every chat's. Empty turns collapse to their numbers and each shard is
 * bounded by `QaProvenanceRetention`, so neither a long chat nor a long-lived
 * deployment can make a single write grow without limit.
 *
 * The store is the only writer of its directory, and no cache sits in front of
 * it: every read goes to disk.
 */
export class FileQaProvenanceSnapshotStore implements QaProvenanceSnapshotStore {
  private migrated = false;
  private lastSweepAt = 0;

  constructor(
    private readonly directoryPath: string = defaultQaProvenanceDirectoryPath(),
    private readonly retention: () => QaProvenanceRetention = () =>
      DEFAULT_QA_PROVENANCE_RETENTION,
    private readonly legacyFilePath: string = `${directoryPath}.json`,
  ) {}

  list(sessionId: string): readonly QaTurnSources[] {
    this.migrateLegacyOnce();
    const shard = this.readShard(sessionId);
    if (shard === undefined) return [];
    return [
      ...Object.values(shard.turns),
      ...shard.emptyTurns.map((turn) => emptyBundle(shard.sessionId, turn)),
    ].sort((left, right) => left.turn - right.turn);
  }

  put(bundle: QaTurnSources): void {
    this.migrateLegacyOnce();
    const limits = this.retention();
    const current = this.readShard(bundle.sessionId);
    const turns: Record<string, QaTurnSources> = { ...(current?.turns ?? {}) };
    const emptyTurns = new Set(current?.emptyTurns ?? []);
    const clone = structuredClone(bundle);
    delete turns[String(clone.turn)];
    emptyTurns.delete(clone.turn);
    if (isEmptyBundle(clone)) emptyTurns.add(clone.turn);
    else turns[String(clone.turn)] = clone;
    const bounded = applyTurnRetention(
      turns,
      [...emptyTurns],
      limits.maxTurnsPerSession,
    );
    this.writeShard(bundle.sessionId, bounded.turns, bounded.emptyTurns);
    this.maybeSweep(bundle.sessionId);
  }

  drop(sessionId: string): void {
    this.migrateLegacyOnce();
    this.removeShard(shardName(sessionId));
  }

  /**
   * Drop shards the retention policy no longer covers: untouched for
   * `maxAgeDays`, then everything past the `maxSessions` most recent ones.
   *
   * `keep` names the chat whose shard must survive the sweep — a caller that
   * swept right after writing it would otherwise be able to delete the very
   * bundle it just stored.
   */
  sweep(keep?: string): QaProvenanceSweepResult {
    const limits = this.retention();
    const keepName = keep === undefined ? undefined : shardName(keep);
    let names: string[];
    try {
      names = readdirSync(this.directoryPath).filter((name) =>
        name.endsWith(".json"),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.lastSweepAt = Date.now();
        return { scanned: 0, droppedByAge: 0, droppedByCount: 0 };
      }
      throw error;
    }
    const entries: { name: string; mtimeMs: number }[] = [];
    for (const name of names) {
      const filePath = path.join(this.directoryPath, name);
      try {
        entries.push({ name, mtimeMs: statSync(filePath).mtimeMs });
      } catch {
        // A shard that vanished between the listing and the stat is already
        // gone; nothing to sweep.
      }
    }
    const cutoff =
      limits.maxAgeDays > 0 ? Date.now() - limits.maxAgeDays * 86_400_000 : 0;
    const survivors: { name: string; mtimeMs: number }[] = [];
    let droppedByAge = 0;
    for (const entry of entries) {
      if (cutoff > 0 && entry.mtimeMs < cutoff && entry.name !== keepName) {
        this.removeShard(entry.name);
        droppedByAge += 1;
        continue;
      }
      survivors.push(entry);
    }
    let droppedByCount = 0;
    if (limits.maxSessions > 0 && survivors.length > limits.maxSessions) {
      survivors.sort((left, right) => right.mtimeMs - left.mtimeMs);
      const protectedIndex = survivors.findIndex(
        (entry) => entry.name === keepName,
      );
      const kept =
        protectedIndex === -1 || protectedIndex < limits.maxSessions
          ? survivors.slice(0, limits.maxSessions)
          : [
              ...survivors.slice(0, limits.maxSessions - 1),
              survivors[protectedIndex] as { name: string; mtimeMs: number },
            ];
      const keptNames = new Set(kept.map((entry) => entry.name));
      for (const entry of survivors) {
        if (keptNames.has(entry.name)) continue;
        this.removeShard(entry.name);
        droppedByCount += 1;
      }
    }
    this.lastSweepAt = Date.now();
    return { scanned: entries.length, droppedByAge, droppedByCount };
  }

  /**
   * Split the pre-sharding monolith into shards exactly once, then rename it
   * out of the way. A shard that already exists wins the merge, so a retried
   * migration cannot lose turns that arrived after the first attempt.
   */
  private migrateLegacyOnce(): void {
    if (this.migrated) return;
    this.migrated = true;
    let raw: string;
    try {
      raw = readFileSync(this.legacyFilePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const parsed = legacyFileSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(
        `qa-sources: ${this.legacyFilePath} is not a recognizable provenance file; refusing to overwrite it`,
        { cause: parsed.error },
      );
    }
    for (const [sessionId, turns] of Object.entries(parsed.data.sessions)) {
      const existing = this.readShard(sessionId);
      const merged: Record<string, QaTurnSources> = {
        ...(existing?.turns ?? {}),
      };
      const emptyTurns = new Set(existing?.emptyTurns ?? []);
      for (const [turn, bundle] of Object.entries(turns)) {
        if (bundle.sessionId !== sessionId || String(bundle.turn) !== turn) {
          throw new Error(
            `qa-sources: ${this.legacyFilePath} contains a snapshot under the wrong session or turn; refusing to overwrite it`,
          );
        }
        const stored = bundle as unknown as QaTurnSources;
        if (isEmptyBundle(stored)) emptyTurns.add(stored.turn);
        else merged[turn] = stored;
      }
      const limits = this.retention();
      const bounded = applyTurnRetention(
        merged,
        [...emptyTurns],
        limits.maxTurnsPerSession,
      );
      this.writeShard(sessionId, bounded.turns, bounded.emptyTurns);
    }
    renameSync(
      this.legacyFilePath,
      `${this.legacyFilePath}.migrated-${new Date().toISOString().replace(/[:.]/gu, "-")}`,
    );
  }

  private shardPath(sessionId: string): string {
    return path.join(this.directoryPath, shardName(sessionId));
  }

  private readShard(sessionId: string): ShardFile | undefined {
    const filePath = this.shardPath(sessionId);
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    const parsed = shardSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(
        `qa-sources: ${filePath} is not a recognizable provenance shard; refusing to overwrite it`,
        { cause: parsed.error },
      );
    }
    if (parsed.data.sessionId !== sessionId) {
      throw new Error(
        `qa-sources: ${filePath} belongs to another chat; refusing to overwrite it`,
      );
    }
    for (const [turn, bundle] of Object.entries(parsed.data.turns)) {
      if (bundle.sessionId !== sessionId || String(bundle.turn) !== turn) {
        throw new Error(
          `qa-sources: ${filePath} contains a snapshot under the wrong session or turn; refusing to overwrite it`,
        );
      }
    }
    // JSON cannot express an absent-versus-undefined distinction, so a bundle
    // that satisfies the strict schema is the domain type: the schemas differ
    // only in the optional markers `exactOptionalPropertyTypes` polices.
    return parsed.data as unknown as ShardFile;
  }

  private writeShard(
    sessionId: string,
    turns: Record<string, QaTurnSources>,
    emptyTurns: readonly number[],
  ): void {
    mkdirSync(this.directoryPath, { recursive: true });
    const shard: ShardFile = {
      version: 1,
      sessionId,
      updatedAt: new Date().toISOString(),
      turns,
      emptyTurns,
    };
    const filePath = this.shardPath(sessionId);
    const temp = `${filePath}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(shard, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temp, filePath);
  }

  private removeShard(name: string): void {
    // Through a rename first: a reader that caught a half-deleted shard would
    // surface a parse failure, where a missing file is just "no sources".
    const filePath = path.join(this.directoryPath, name);
    const gone = `${filePath}.${process.pid}.removing`;
    try {
      renameSync(filePath, gone);
      rmSync(gone, { force: true });
    } catch {
      // Already gone, or not ours to remove: retention never fails a write.
    }
  }

  private maybeSweep(currentSessionId: string): void {
    const limits = this.retention();
    const interval = limits.sweepIntervalMinutes * 60_000;
    if (interval > 0 && Date.now() - this.lastSweepAt < interval) return;
    try {
      this.sweep(currentSessionId);
    } catch {
      // A sweep is housekeeping: its failure must not fail the turn that
      // triggered it. The next write retries.
    }
  }
}
