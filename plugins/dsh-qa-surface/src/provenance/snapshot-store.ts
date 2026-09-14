import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
}

/** Default durable provenance path, deliberately outside Harness journals. */
export function defaultQaProvenanceFilePath(): string {
  const home = process.env.DSH_HOME?.trim();
  return path.join(
    home !== undefined && home !== "" ? home : process.cwd(),
    "qa-sources.json",
  );
}

/** Atomically persists per-turn QA source snapshots in plugin-owned storage. */
export class FileQaProvenanceSnapshotStore implements QaProvenanceSnapshotStore {
  constructor(
    private readonly filePath: string = defaultQaProvenanceFilePath(),
  ) {}

  list(sessionId: string): readonly QaTurnSources[] {
    const turns = this.load().sessions[sessionId] ?? {};
    return Object.values(turns).sort((left, right) => left.turn - right.turn);
  }

  put(bundle: QaTurnSources): void {
    const current = this.load();
    const next: SnapshotFile = {
      version: 1,
      sessions: {
        ...current.sessions,
        [bundle.sessionId]: {
          ...(current.sessions[bundle.sessionId] ?? {}),
          [String(bundle.turn)]: structuredClone(bundle),
        },
      },
    };
    this.persist(next);
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
    writeFileSync(temp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    renameSync(temp, this.filePath);
  }
}
