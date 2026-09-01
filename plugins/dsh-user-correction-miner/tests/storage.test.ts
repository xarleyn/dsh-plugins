import { describe, expect, it } from "vitest";
import {
  CORRECTION_MINER_DOMAIN,
  DomainCorrectionStore,
  MemoryCorrectionStore,
  type CorrectionMinerDomain,
  correctionRecordSchema,
  scanCursorSchema,
} from "../src/dsh/storage.js";
import type { CorrectionRecord, CorrectionStore, ScanCursor } from "../src/types.js";

function record(id: string, workspaceKey: string, createdAt: number): CorrectionRecord {
  return {
    id,
    sessionId: `session-${id}`,
    eventSeq: createdAt,
    workspaceKey,
    cwd: workspaceKey,
    text: id,
    textDigest: `text-${id}`,
    contextDigest: `context-${id}`,
    contextEvents: [],
    previousAssistantEvents: [],
    previousToolEvents: [],
    matchedSignals: [],
    likelyOneOff: false,
    createdAt,
  };
}

function domainStore(): DomainCorrectionStore {
  const records = new Map<string, CorrectionRecord>();
  const table = {
    get: (key: string) => records.get(key),
    entries: () => new Map(records).entries(),
    keys: () => new Map(records).keys(),
    get size() {
      return records.size;
    },
    async put(key: string, value: CorrectionRecord) {
      records.set(key, structuredClone(value));
    },
    async delete(key: string) {
      return records.delete(key);
    },
    async update(key: string, transform: (value: CorrectionRecord) => CorrectionRecord) {
      const current = records.get(key);
      if (current === undefined) throw new Error("missing key");
      const next = transform(current);
      records.set(key, next);
      return next;
    },
  };
  const domain = { table: () => table } as unknown as CorrectionMinerDomain;
  return new DomainCorrectionStore(domain);
}

describe("correction miner storage domain", () => {
  it("declares the complete planned table vocabulary", () => {
    expect(CORRECTION_MINER_DOMAIN.name).toBe("dsh_user_correction_miner");
    expect(Object.keys(CORRECTION_MINER_DOMAIN.tables)).toEqual([
      "corrections",
      "clusters",
      "candidates",
      "replays",
      "decisions",
      "rule_bindings",
      "scan_cursors",
    ]);
  });

  it("rejects malformed durable records", () => {
    expect(() => correctionRecordSchema.parse({ id: "only-an-id" })).toThrow();
    expect(() => scanCursorSchema.parse({ workspaceKey: "x", sessionWatermarks: {} })).toThrow();
  });

  it("counts and retains the newest records independently per workspace", async () => {
    const stores: CorrectionStore[] = [new MemoryCorrectionStore(), domainStore()];
    for (const store of stores) {
      for (const value of [
        record("a-1", "workspace-a", 1),
        record("b-1", "workspace-b", 1),
        record("a-2", "workspace-a", 2),
        record("b-2", "workspace-b", 2),
        record("a-3", "workspace-a", 3),
      ]) {
        await store.putCorrection(value, 2);
      }

      expect(store.countCorrections("workspace-a")).toBe(2);
      expect(store.countCorrections("workspace-b")).toBe(2);
      expect(store.listCorrections("workspace-a").map(({ id }) => id)).toEqual(["a-3", "a-2"]);
      expect(store.listCorrections("workspace-b").map(({ id }) => id)).toEqual(["b-2", "b-1"]);
    }
  });

  it("returns a defensive clone of a memory cursor", async () => {
    const store = new MemoryCorrectionStore();
    const cursor: ScanCursor = {
      workspaceKey: "workspace-a",
      sessionWatermarks: { session: 4 },
      updatedAt: 5,
    };
    await store.putCursor(cursor);

    const first = store.getCursor("workspace-a") as {
      sessionWatermarks: Record<string, number>;
    };
    first.sessionWatermarks.session = 99;

    expect(store.getCursor("workspace-a")?.sessionWatermarks.session).toBe(4);
  });
});
