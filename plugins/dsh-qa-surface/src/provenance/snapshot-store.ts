import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import type { Stats } from "node:fs";
import path from "node:path";
import { z } from "zod";
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

const fileSchema = z
  .object({
    version: z.literal(1),
    sessions: z.record(z.string(), z.record(z.string(), bundleSchema)),
  })
  .strict();

interface SnapshotFile {
  readonly version: 1;
  readonly sessions: Record<string, Record<string, QaTurnSources>>;
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

/** Default durable provenance path, deliberately outside Harness journals. */
export function defaultQaProvenanceFilePath(): string {
  const home = process.env.DSH_HOME?.trim();
  return path.join(
    home !== undefined && home !== "" ? home : process.cwd(),
    "qa-sources.json",
  );
}

/**
 * Retention backstops. Primary retention is the session's own disposal, which
 * the host store forwards here; the caps only bound the damage a deployment
 * can accumulate through sessions that never dispose cleanly. They mirror the
 * row caps of the quality store: oldest falls off first, newest stays.
 */
export const MAX_QA_SOURCE_SESSIONS = 256;
export const MAX_QA_SOURCE_TURNS_PER_SESSION = 500;

/** mtime+size pair identifying one on-disk version of the file. */
interface FileStamp {
  readonly mtimeMs: number;
  readonly size: number;
}

function stampOf(stat: Stats): FileStamp {
  return { mtimeMs: stat.mtimeMs, size: stat.size };
}

/** Atomically persists per-turn QA source snapshots in plugin-owned storage. */
export class FileQaProvenanceSnapshotStore implements QaProvenanceSnapshotStore {
  /** In-memory copy as of the last load or persist; the write cache. */
  private file: SnapshotFile = { version: 1, sessions: {} };
  private fileStamp: FileStamp | undefined;
  /** Session ids, least recently put first; seeds from the file order. */
  private readonly recency = new Map<string, undefined>();

  constructor(
    private readonly filePath: string = defaultQaProvenanceFilePath(),
  ) {}

  list(sessionId: string): readonly QaTurnSources[] {
    const turns = this.current().sessions[sessionId] ?? {};
    return Object.values(turns).sort((left, right) => left.turn - right.turn);
  }

  put(bundle: QaTurnSources): void {
    const current = this.current();
    const existing = current.sessions[bundle.sessionId] ?? {};
    // The cap trims the session's own oldest turns first, so a long-lived
    // chat keeps reporting its latest provenance instead of failing to grow.
    const turns = Object.entries(existing)
      .map(([turn, value]) => [Number(turn), value] as const)
      .sort((left, right) => left[0] - right[0])
      .slice(-(MAX_QA_SOURCE_TURNS_PER_SESSION - 1))
      .reduce<Record<string, QaTurnSources>>(
        (accumulator, [turn, value]) => ({
          ...accumulator,
          [String(turn)]: value,
        }),
        {},
      );
    turns[String(bundle.turn)] = structuredClone(bundle);
    let sessions: SnapshotFile["sessions"] = {
      ...current.sessions,
      [bundle.sessionId]: turns,
    };
    this.touch(bundle.sessionId);
    // The cap evicts least recently put sessions. Insertion order of the file
    // seeds it after a restart, so eviction is approximate until this process
    // has written again — good enough for a backstop.
    while (Object.keys(sessions).length > MAX_QA_SOURCE_SESSIONS) {
      const oldest = this.recency.keys().next();
      if (oldest.done) break;
      this.recency.delete(oldest.value);
      sessions = { ...sessions };
      delete sessions[oldest.value];
    }
    this.persist({ version: 1, sessions });
  }

  drop(sessionId: string): void {
    this.current();
    if (this.file.sessions[sessionId] === undefined) return;
    this.recency.delete(sessionId);
    const sessions = { ...this.file.sessions };
    delete sessions[sessionId];
    this.persist({ version: 1, sessions });
  }

  /** The served file, re-read only when the disk copy actually changed. */
  private current(): SnapshotFile {
    let stat: Stats;
    try {
      stat = statSync(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.fileStamp = undefined;
        this.file = { version: 1, sessions: {} };
        this.recency.clear();
        return this.file;
      }
      throw error;
    }
    if (
      this.fileStamp !== undefined &&
      this.fileStamp.mtimeMs === stat.mtimeMs &&
      this.fileStamp.size === stat.size
    ) {
      return this.file;
    }
    this.file = this.load();
    this.fileStamp = { mtimeMs: stat.mtimeMs, size: stat.size };
    this.recency.clear();
    for (const sessionId of Object.keys(this.file.sessions))
      this.recency.set(sessionId, undefined);
    return this.file;
  }

  private touch(sessionId: string): void {
    this.recency.delete(sessionId);
    this.recency.set(sessionId, undefined);
  }

  private load(): SnapshotFile {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 1, sessions: {} };
      }
      throw error;
    }
    const parsed = fileSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(
        `qa-sources: ${this.filePath} is not a recognizable provenance file; refusing to overwrite it`,
        { cause: parsed.error },
      );
    }
    for (const [sessionId, turns] of Object.entries(parsed.data.sessions)) {
      for (const [turn, bundle] of Object.entries(turns)) {
        if (bundle.sessionId !== sessionId || String(bundle.turn) !== turn) {
          throw new Error(
            `qa-sources: ${this.filePath} contains a snapshot under the wrong session or turn; refusing to overwrite it`,
          );
        }
      }
    }
    return parsed.data as SnapshotFile;
  }

  private persist(file: SnapshotFile): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(file, null, 2)}\n`, {
      encoding: "utf8",
      // Not secrets, but the same owner-only default the other plugin data
      // files use (POSIX; Windows ignores the mode).
      mode: 0o600,
    });
    renameSync(temp, this.filePath);
    this.file = file;
    this.fileStamp = stampOf(statSync(this.filePath));
  }
}
