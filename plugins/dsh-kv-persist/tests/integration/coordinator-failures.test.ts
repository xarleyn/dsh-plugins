import { describe, expect, it, vi } from "vitest";
import { buildIdentity, createHarness, run } from "../fixtures/harness.js";
import { snapshotGenerations } from "../../src/snapshots/naming.js";
import { KvRestoreFailedError } from "../../src/errors.js";

describe("single-slot coordinator: backend failures and degradation (§32-§33)", () => {
  it("keeps the committed filename across failed writes and failed manifest publication", async () => {
    const h = await createHarness({ checkpoint: { idleMs: 0 } });
    try {
      const session = "session-a";
      const identity = buildIdentity(h, session);
      const [first, second] = snapshotGenerations(identity);
      await run(h, session);
      await h.coordinator.saveNow(session);
      const committed = await h.repository.load(identity);
      expect(committed?.snapshotFilename).toBe(first);
      await run(h, session);
      h.backend.failNextSave();
      expect((await h.coordinator.saveNow(session)).kind).toBe("failed");
      expect(await h.repository.load(identity)).toEqual(committed);
      vi.spyOn(h.repository, "put").mockRejectedValueOnce(
        new Error("disk full"),
      );
      expect((await h.coordinator.saveNow(session)).kind).toBe("failed");
      expect(h.backend.hasSnapshot(second)).toBe(true);
      expect(await h.repository.load(identity)).toEqual(committed);
      expect((await h.coordinator.saveNow(session)).kind).toBe("saved");
      expect((await h.repository.load(identity))?.snapshotFilename).toBe(
        second,
      );
      await run(h, session);
      await h.coordinator.saveNow(session);
      expect((await h.repository.load(identity))?.snapshotFilename).toBe(first);
    } finally {
      await h.cleanup();
    }
  });
  it("backend unavailable: ordinary inference continues (§32, §75)", async () => {
    const harness = await createHarness();
    try {
      harness.backend.setUnavailable(true);
      const chunks = await run(harness, "session-a");
      expect(chunks.map((chunk) => chunk.type)).toEqual([
        "text-delta",
        "finish",
      ]);
      expect(harness.coordinator.slot.ownerSessionId).toBe("session-a");
    } finally {
      await harness.cleanup();
    }
  });

  it("save failure: session B still runs in non-strict mode (§32, §75)", async () => {
    const harness = await createHarness();
    try {
      await run(harness, "session-a");
      harness.backend.failNextSave();
      const chunks = await run(harness, "session-b");
      expect(chunks.map((chunk) => chunk.type)).toEqual([
        "text-delta",
        "finish",
      ]);
      expect(harness.metrics.counters.saveFailures).toBe(1);
      expect(
        harness.coordinator.getSessionState("session-a")?.persistedRevision,
      ).toBe(0);
    } finally {
      await harness.cleanup();
    }
  });

  it("strict mode turns a failed restore into a request failure (§32)", async () => {
    const harness = await createHarness({ failure: { strict: true } });
    try {
      await run(harness, "session-a");
      await run(harness, "session-b");
      harness.backend.failNextRestore();
      await expect(run(harness, "session-a")).rejects.toBeInstanceOf(
        KvRestoreFailedError,
      );
      await expect(run(harness, "session-c")).resolves.toHaveLength(2);
    } finally {
      await harness.cleanup();
    }
  });

  it("opens the circuit after repeated backend failures and still serves inference (§33)", async () => {
    const harness = await createHarness();
    try {
      harness.backend.setUnavailable(true);
      await run(harness, "session-a"); // erase fails -> failure #1 (degraded)
      await run(harness, "session-b"); // save A fails + erase fails -> #2, #3 (open)
      const erasesBefore = harness.backend.eraseCount;
      const chunks = await run(harness, "session-c"); // circuit open -> pass-through
      expect(chunks.map((chunk) => chunk.type)).toEqual([
        "text-delta",
        "finish",
      ]);
      expect(harness.backend.eraseCount).toBe(erasesBefore);
      expect(harness.metrics.counters.circuitSkips).toBe(1);
    } finally {
      await harness.cleanup();
    }
  });
});
