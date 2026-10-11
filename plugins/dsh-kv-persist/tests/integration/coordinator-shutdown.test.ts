/**
 * Shutdown checkpoint (SPEC §58, §59): disposal must still write the final
 * snapshot of the dirty session that owns the slot, must wait for the slot
 * lease rather than race it, must not hold the host unload open forever, and
 * must stop accepting any work that would start new persistence.
 */

import { describe, expect, it, vi } from "vitest";
import type { StreamChunk } from "@deepseek-ai/dsh-llm";
import { KvCoordinatorDisposedError } from "../../src/errors.js";
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

  it("refuses a request that arrives after dispose, without starting work", async () => {
    const harness = await createHarness();
    try {
      await run(harness, "session-a");
      await harness.coordinator.dispose();

      const counters = harness.metrics.snapshot();
      const events = [...harness.backend.events];
      const saves = harness.backend.saveCount;

      const refusal = await harness.coordinator
        .runSessionRequest(makeRequest({ sessionId: "session-b" }))
        .catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(KvCoordinatorDisposedError);
      expect((refusal as KvCoordinatorDisposedError).code).toBe(
        "KV_COORDINATOR_DISPOSED",
      );
      // The auxiliary branch is refused the same way.
      await expect(
        harness.coordinator.runSessionRequest(
          makeRequest({ sessionId: "session-a", purpose: "session-title" }),
        ),
      ).rejects.toBeInstanceOf(KvCoordinatorDisposedError);

      expect(harness.metrics.snapshot()).toEqual(counters);
      expect(harness.backend.saveCount).toBe(saves);
      expect(harness.backend.events).toEqual(events);
      // No runtime was created and no lease was taken: a mutex-guarded call
      // still gets through promptly.
      expect(harness.coordinator.getSessionState("session-b")).toBeUndefined();
      await expect(
        harness.coordinator.restoreNow("session-b"),
      ).resolves.toMatchObject({ kind: "cold" });
    } finally {
      await harness.cleanup();
    }
  });

  it("refuses a queued request once it obtains the lease after dispose", async () => {
    const harness = await createHarness();
    const finishA = deferred();
    try {
      const streamA = await harness.coordinator.runSessionRequest({
        ...makeRequest({ sessionId: "session-a" }),
        next: async function* (): AsyncIterable<StreamChunk> {
          yield { type: "text-delta", index: 0, text: "a" };
          await finishA.promise;
          yield { type: "finish", reason: { kind: "stop" } };
        },
      });
      const iteratorA = streamA[Symbol.asyncIterator]();
      await iteratorA.next();

      // B queues behind the lease A still holds.
      const queued = harness.coordinator.runSessionRequest(
        makeRequest({ sessionId: "session-b" }),
      );
      await Promise.resolve();
      await Promise.resolve();
      expect(harness.coordinator.slot.ownerSessionId).toBe("session-a");

      const shutdown = harness.coordinator.dispose();
      finishA.resolve();
      await iteratorA.next();
      await iteratorA.next();

      await expect(queued).rejects.toBeInstanceOf(KvCoordinatorDisposedError);
      await shutdown;

      // B never reached the backend; the only save is A's final checkpoint.
      expect(harness.backend.saveCount).toBe(1);
      expect(harness.backend.restoreCount).toBe(0);
      expect(harness.backend.eraseCount).toBe(1);
      // The refused lease was released, so the mutex is free again.
      await expect(
        harness.coordinator.restoreNow("session-b"),
      ).resolves.toMatchObject({ kind: "cold" });
    } finally {
      finishA.resolve();
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
