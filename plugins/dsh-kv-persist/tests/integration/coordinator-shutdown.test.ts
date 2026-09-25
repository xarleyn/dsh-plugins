/**
 * Shutdown checkpoint (SPEC §58, §59): disposal must still write the final
 * snapshot of the dirty session that owns the slot, must wait for the slot
 * lease rather than race it, and must not hold the host unload open forever.
 */

import { describe, expect, it, vi } from "vitest";
import type { StreamChunk } from "@deepseek-ai/dsh-llm";
import {
  buildIdentity,
  createHarness,
  deferred,
  makeRequest,
  recordingLogger,
  residentKey,
  run,
} from "../fixtures/harness.js";
import type { Harness } from "../fixtures/harness.js";

/**
 * Start a coordinated stream and consume its first chunk, so the slot lease is
 * provably held by the generator until `hold` is resolved.
 */
async function holdLeaseOpen(
  harness: Harness,
  sessionId: string,
  hold: ReturnType<typeof deferred>,
): Promise<AsyncIterator<StreamChunk>> {
  const stream = await harness.coordinator.runSessionRequest({
    ...makeRequest({ sessionId }),
    next: async function* (): AsyncIterable<StreamChunk> {
      harness.backend.events.push(`inference:${sessionId}:start`);
      yield { type: "text-delta", index: 0, text: "partial" };
      await hold.promise;
      harness.backend.events.push(`inference:${sessionId}:finish`);
      yield { type: "finish", reason: { kind: "stop" } };
    },
  });
  const iterator = stream[Symbol.asyncIterator]();
  expect((await iterator.next()).value).toMatchObject({ type: "text-delta" });
  expect(harness.backend.events).toEqual([
    "erase:0",
    `inference:${sessionId}:start`,
  ]);
  return iterator;
}

describe("single-slot coordinator: shutdown flush (SPEC §58)", () => {
  it("dispose saves the dirty owner instead of skipping it (SPEC §58)", async () => {
    const harness = await createHarness();
    try {
      await run(harness, "session-a");
      expect(harness.backend.saveCount).toBe(0);

      await harness.coordinator.dispose();

      expect(harness.backend.saveCount).toBe(1);
      expect(harness.metrics.counters.saves).toBe(1);
      const manifest = await harness.repository.load(
        buildIdentity(harness, "session-a"),
      );
      expect(manifest?.state).toBe("ready");
      expect(
        harness.coordinator.getSessionState("session-a")?.persistedRevision,
      ).toBe(1);
    } finally {
      await harness.cleanup();
    }
  });

  it("queues the final flush behind an open inference lease (Invariant 8)", async () => {
    const harness = await createHarness();
    const holdStream = deferred();
    try {
      const iterator = await holdLeaseOpen(harness, "session-a", holdStream);
      const shutdown = harness.coordinator.dispose();

      holdStream.resolve();
      expect((await iterator.next()).value).toMatchObject({ type: "finish" });
      await iterator.next();
      await shutdown;

      // `save:0` after `inference:a:finish` is the proof of queueing: a flush
      // that skipped the lease would be recorded between the two markers.
      expect(harness.backend.events).toEqual([
        "erase:0",
        "inference:session-a:start",
        "inference:session-a:finish",
        "save:0",
      ]);
      expect(harness.backend.saveCount).toBe(1);
      expect(harness.metrics.counters.saves).toBe(1);
    } finally {
      holdStream.resolve();
      await harness.cleanup();
    }
  });

  it("abandons the wait after the grace period instead of stalling the unload (SPEC §59)", async () => {
    const logs = recordingLogger();
    const harness = await createHarness(
      { checkpoint: { shutdownGraceMs: 25 } },
      undefined,
      logs.logger,
    );
    const holdStream = deferred();
    try {
      const iterator = await holdLeaseOpen(harness, "session-a", holdStream);

      // The lease never frees while the grace period runs, so `dispose` can
      // only resolve if the wait is bounded.
      await expect(harness.coordinator.dispose()).resolves.toBeUndefined();
      expect(logs.events).toContain("kv.session.shutdown_flush_abandoned");
      expect(harness.backend.saveCount).toBe(0);

      // Giving up the wait does not give up the write: once the lease frees,
      // the queued checkpoint still saves the turn it waited for.
      holdStream.resolve();
      await iterator.next();
      await iterator.next();
      await vi.waitFor(() => {
        expect(harness.backend.saveCount).toBe(1);
      });
      expect(harness.metrics.counters.saves).toBe(1);
    } finally {
      holdStream.resolve();
      await harness.cleanup();
    }
  });

  it("a failed shutdown save reports itself and leaves the manifest alone (§32, §58)", async () => {
    const harness = await createHarness();
    try {
      await run(harness, "session-a");
      await run(harness, "session-b"); // save-before-evict writes A
      harness.backend.corruptSnapshot(residentKey(harness, "session-a"));
      await run(harness, "session-a"); // restore fails -> A invalid, dirty
      harness.backend.failNextSave(); // the shutdown checkpoint dies

      await harness.coordinator.dispose();

      // `repository.put` is never reached, so there is no half-written
      // manifest to recover from: A keeps the state the restore failure left.
      expect(harness.metrics.counters.saveFailures).toBe(1);
      expect(harness.metrics.counters.saves).toBe(2); // both switch saves
      const manifest = await harness.repository.load(
        buildIdentity(harness, "session-a"),
      );
      expect(manifest?.state).toBe("invalid");
      expect(manifest?.invalidReason).toBe("RESTORE_FAILED");
    } finally {
      await harness.cleanup();
    }
  });

  it("clean and unowned slots make shutdown a no-op, and new work is refused", async () => {
    const harness = await createHarness();
    try {
      await run(harness, "session-a");
      await harness.coordinator.dispose();
      expect(harness.backend.saveCount).toBe(1);

      // Refusing new intake is separate from the final internal flush.
      await expect(
        harness.coordinator.checkpoint("session-a", "manual"),
      ).resolves.toBeNull();
      await harness.coordinator.flushOwned("manual");
      await harness.coordinator.handleSessionDisposed("session-a");
      expect(harness.backend.saveCount).toBe(1);
    } finally {
      await harness.cleanup();
    }
  });

  it("onShutdown: false keeps the final checkpoint disabled", async () => {
    const harness = await createHarness({ checkpoint: { onShutdown: false } });
    try {
      await run(harness, "session-a");
      await harness.coordinator.dispose();
      expect(harness.backend.saveCount).toBe(0);
    } finally {
      await harness.cleanup();
    }
  });
});
