import { describe, expect, it } from "vitest";
import {
  buildIdentity,
  consume,
  createHarness,
  makeRequest,
  residentKey,
  run,
} from "../fixtures/harness.js";

describe("single-slot coordinator: slot lifecycle (SPEC §69-§75)", () => {
  it("cold start: request succeeds, slot assigned, state dirty, nothing saved yet", async () => {
    const harness = await createHarness();
    try {
      const chunks = await run(harness, "session-a");
      expect(chunks.map((chunk) => chunk.type)).toEqual(["text-delta", "finish"]);
      expect(harness.backend.eraseCount).toBe(1);
      expect(harness.backend.saveCount).toBe(0);
      expect(harness.backend.restoreCount).toBe(0);
      expect(harness.coordinator.slot.ownerSessionId).toBe("session-a");
      expect(harness.coordinator.slot.state).toBe("dirty");
      const runtime = harness.coordinator.getSessionState("session-a");
      expect(runtime?.dirtyRevision).toBe(1);
      expect(runtime?.persistedRevision).toBe(0);
      expect(harness.metrics.counters.coldPrefills).toBe(1);
    } finally {
      await harness.cleanup();
    }
  });

  it("resident reuse: repeated A requests do zero disk I/O and zero management calls (Invariant 6)", async () => {
    const harness = await createHarness();
    try {
      await run(harness, "session-a");
      const eraseAfterFirst = harness.backend.eraseCount;
      await run(harness, "session-a");
      expect(harness.backend.eraseCount).toBe(eraseAfterFirst);
      expect(harness.backend.saveCount).toBe(0);
      expect(harness.backend.restoreCount).toBe(0);
      const runtime = harness.coordinator.getSessionState("session-a");
      expect(runtime?.dirtyRevision).toBe(2);
    } finally {
      await harness.cleanup();
    }
  });

  it("switch A -> B: dirty A is saved before eviction (Invariant 3, §70)", async () => {
    const harness = await createHarness();
    try {
      await run(harness, "session-a");
      await run(harness, "session-b");
      expect(harness.backend.saveCount).toBe(1);
      expect(harness.coordinator.slot.ownerSessionId).toBe("session-b");
      const manifest = await harness.repository.load(buildIdentity(harness, "session-a"));
      expect(manifest?.state).toBe("ready");
      const runtimeA = harness.coordinator.getSessionState("session-a");
      expect(runtimeA?.persistedRevision).toBe(1);
      expect(runtimeA?.dirtyRevision).toBe(1);
    } finally {
      await harness.cleanup();
    }
  });

  it("switch back B -> A: A snapshot is restored (§70)", async () => {
    const harness = await createHarness();
    try {
      await run(harness, "session-a");
      await run(harness, "session-b");
      await run(harness, "session-a");
      expect(harness.backend.restoreCount).toBe(1);
      expect(harness.coordinator.slot.ownerSessionId).toBe("session-a");
      expect(harness.coordinator.slot.state).toBe("dirty");
      expect(harness.metrics.counters.restoreHits).toBe(1);
    } finally {
      await harness.cleanup();
    }
  });

  it("corrupt restore: snapshot invalidated, request falls back to cold (§23, §32, §75)", async () => {
    const harness = await createHarness();
    try {
      await run(harness, "session-a");
      await run(harness, "session-b"); // saves A
      const key = residentKey(harness, "session-a");
      harness.backend.corruptSnapshot(key);
      const chunks = await run(harness, "session-a"); // restore fails -> cold
      expect(chunks.map((chunk) => chunk.type)).toEqual(["text-delta", "finish"]);
      expect(harness.metrics.counters.restoreFailures).toBe(1);
      const manifest = await harness.repository.load(buildIdentity(harness, "session-a"));
      expect(manifest?.state).toBe("invalid");
      expect(manifest?.invalidReason).toBe("RESTORE_FAILED");
    } finally {
      await harness.cleanup();
    }
  });

  it("restore verification rejects n_restored <= 0 (SPEC §24)", async () => {
    const harness = await createHarness();
    harness.backend.setRestoredTokens(0);
    try {
      await run(harness, "session-a");
      await run(harness, "session-b");
      const before = harness.backend.restoreCount;
      await run(harness, "session-a");
      expect(harness.backend.restoreCount).toBe(before + 1);
      expect(harness.metrics.counters.restoreFailures).toBe(1);
      expect(harness.metrics.counters.coldPrefills).toBe(3); // a-cold, b-cold, a-fallback
    } finally {
      await harness.cleanup();
    }
  });

  it("auxiliary requests save the dirty owner and never own the slot (§22, §72, Invariant 7)", async () => {
    const harness = await createHarness();
    try {
      await run(harness, "session-a");
      const auxStream = await harness.coordinator.runSessionRequest(
        makeRequest({ sessionId: null, purpose: "session-title" }),
      );
      await consume(auxStream);
      expect(harness.backend.saveCount).toBe(1);
      expect(harness.coordinator.slot.ownerSessionId).toBeNull();
      // Next main request restores A instead of trusting the polluted slot.
      await run(harness, "session-a");
      expect(harness.backend.restoreCount).toBe(1);
      expect(harness.coordinator.slot.ownerSessionId).toBe("session-a");
    } finally {
      await harness.cleanup();
    }
  });

  it("unmanaged providers are not coordinated at the service boundary (§37, §74.19)", async () => {
    const harness = await createHarness();
    try {
      // The coordinator still executes what it is given; the managed-provider
      // filter lives at the service boundary and is covered in service tests.
      const stream = await harness.coordinator.runSessionRequest(
        makeRequest({ sessionId: "s", provider: "deepseek" }),
      );
      expect((await consume(stream)).length).toBe(2);
    } finally {
      await harness.cleanup();
    }
  });

  it("invalidate and purge remove usability and metadata without touching binaries (§31)", async () => {
    const harness = await createHarness();
    try {
      await run(harness, "session-a");
      await harness.coordinator.checkpoint("session-a", "manual");
      await harness.coordinator.invalidate("session-a", "EXPLICIT");
      const manifest = await harness.repository.load(buildIdentity(harness, "session-a"));
      expect(manifest?.state).toBe("invalid");
      await run(harness, "session-a"); // invalid snapshot -> cold
      expect(harness.metrics.counters.coldPrefills).toBeGreaterThanOrEqual(2);
      await harness.coordinator.purge("session-a");
      await expect(
        harness.repository.load(buildIdentity(harness, "session-a")),
      ).resolves.toBeNull();
    } finally {
      await harness.cleanup();
    }
  });
});
