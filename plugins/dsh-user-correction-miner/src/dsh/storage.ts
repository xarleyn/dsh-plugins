import { defineDomain, domainTable, type Domain } from "@deepseek-ai/dsh-storage-domain";
import { z } from "zod";
import type { CorrectionRecord, CorrectionStore, ScanCursor } from "../types.js";

const classificationSchema = z.object({
  isCorrection: z.boolean(),
  confidence: z.number().min(0).max(1),
  target: z.enum([
    "file-selection",
    "filesystem-scope",
    "tool-choice",
    "command",
    "workflow",
    "package-manager",
    "git",
    "deploy",
    "style",
    "testing",
    "environment",
    "agent-behavior",
    "other",
  ]),
  durability: z.enum([
    "one-off",
    "likely-project-rule",
    "likely-user-rule",
    "likely-skill",
    "uncertain",
  ]),
  severity: z.enum(["preference", "workflow", "destructive-risk", "security"]),
  correctedBehavior: z.string().optional(),
});

const contextEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  kind: z.enum(["user", "assistant", "tool-call", "tool-result"]),
  text: z.string(),
});

export const correctionRecordSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  eventSeq: z.number().int().nonnegative(),
  workspaceKey: z.string(),
  cwd: z.string(),
  text: z.string(),
  textDigest: z.string(),
  contextDigest: z.string(),
  contextEvents: z.array(contextEventSchema),
  previousUserEvent: z.number().int().nonnegative().optional(),
  previousAssistantEvents: z.array(z.number().int().nonnegative()),
  previousToolEvents: z.array(z.number().int().nonnegative()),
  matchedSignals: z.array(z.string()),
  likelyOneOff: z.boolean(),
  classification: classificationSchema.optional(),
  createdAt: z.number().int().nonnegative(),
});

export const scanCursorSchema = z.object({
  workspaceKey: z.string(),
  lastAnalyzedSession: z.string().optional(),
  lastAnalyzedEventSeq: z.number().int().nonnegative().optional(),
  sessionWatermarks: z.record(z.string(), z.number().int()),
  updatedAt: z.number().int().nonnegative(),
});

const futureRecordSchema = z.record(z.string(), z.unknown());

/**
 * The Phase 1 domain declares the complete planned table vocabulary now so
 * later phases do not silently reinterpret an existing durable layout.
 */
export const CORRECTION_MINER_DOMAIN = defineDomain({
  name: "dsh_user_correction_miner",
  version: 1,
  tables: {
    corrections: domainTable<string, CorrectionRecord>(correctionRecordSchema),
    clusters: domainTable<string, Record<string, unknown>>(futureRecordSchema),
    candidates: domainTable<string, Record<string, unknown>>(futureRecordSchema),
    replays: domainTable<string, Record<string, unknown>>(futureRecordSchema),
    decisions: domainTable<string, Record<string, unknown>>(futureRecordSchema),
    rule_bindings: domainTable<string, Record<string, unknown>>(futureRecordSchema),
    scan_cursors: domainTable<string, ScanCursor>(scanCursorSchema),
  },
});

export type CorrectionMinerDomain = Domain<typeof CORRECTION_MINER_DOMAIN>;

export class DomainCorrectionStore implements CorrectionStore {
  constructor(private readonly domain: CorrectionMinerDomain) {}

  getCursor(workspaceKey: string): ScanCursor | undefined {
    return this.domain.table("scan_cursors").get(workspaceKey);
  }

  putCursor(cursor: ScanCursor): Promise<void> {
    return this.domain.table("scan_cursors").put(cursor.workspaceKey, cursor);
  }

  hasCorrection(id: string): boolean {
    return this.domain.table("corrections").get(id) !== undefined;
  }

  putCorrection(record: CorrectionRecord): Promise<void> {
    return this.domain.table("corrections").put(record.id, record);
  }

  listCorrections(workspaceKey: string, limit = 50): readonly CorrectionRecord[] {
    return [...this.domain.table("corrections").entries()]
      .map(([, record]) => record)
      .filter((record) => record.workspaceKey === workspaceKey)
      .sort((left, right) => right.createdAt - left.createdAt || right.eventSeq - left.eventSeq)
      .slice(0, limit);
  }
}

export class MemoryCorrectionStore implements CorrectionStore {
  private readonly corrections = new Map<string, CorrectionRecord>();
  private readonly cursors = new Map<string, ScanCursor>();

  getCursor(workspaceKey: string): ScanCursor | undefined {
    return this.cursors.get(workspaceKey);
  }

  async putCursor(cursor: ScanCursor): Promise<void> {
    this.cursors.set(cursor.workspaceKey, structuredClone(cursor));
  }

  hasCorrection(id: string): boolean {
    return this.corrections.has(id);
  }

  async putCorrection(record: CorrectionRecord): Promise<void> {
    this.corrections.set(record.id, structuredClone(record));
  }

  listCorrections(workspaceKey: string, limit = 50): readonly CorrectionRecord[] {
    return [...this.corrections.values()]
      .filter((record) => record.workspaceKey === workspaceKey)
      .sort((left, right) => right.createdAt - left.createdAt || right.eventSeq - left.eventSeq)
      .slice(0, limit)
      .map((record) => structuredClone(record));
  }
}
