import { describe, expect, it } from "vitest";
import type { StreamChunk } from "@deepseek-ai/dsh-llm";
import { createHarness, consume, makeRequest } from "../fixtures/harness.js";
import type { Harness } from "../fixtures/harness.js";
import { buildSnapshotIdentity } from "../../src/snapshots/fingerprint.js";
import type { SnapshotIdentity } from "../../src/snapshots/fingerprint.js";
import { snapshotFilename } from "../../src/snapshots/naming.js";
import { KvRestoreFailedError } from "../../src/errors.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function buildIdentity(harness: Harness, sessionId: string): SnapshotIdentity {
  return buildSnapshotIdentity({
    sessionId,
    route: { provider: "local-qwen", model: "qwen-test" },
    baseURL: harness.config.baseURL,
    runtimeKey: harness.config.runtimeKey,
  });
}

function residentKey(harness: Harness, sessionId: string): string {
  return snapshotFilename(buildIdentity(harness, sessionId));
}

async function run(harness: Harness, sessionId: string, provider = "local-qwen") {
  const stream = await harness.coordinator.runSessionRequest(
    makeRequest({ sessionId, provider }),
  );
  return consume(stream);
}

describe("single-slot coordinator (SPEC §69-§75)", () => {
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

  it("backend unavailable: ordinary inference continues (§32, §75)", async () => {
    const harness = await createHarness();
    try {
      harness.backend.setUnavailable(true);
      const chunks = await run(harness, "session-a");
      expect(chunks.map((chunk) => chunk.type)).toEqual(["text-delta", "finish"]);
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
      expect(chunks.map((chunk) => chunk.type)).toEqual(["text-delta", "finish"]);
      expect(harness.metrics.counters.saveFailures).toBe(1);
      expect(harness.coordinator.getSessionState("session-a")?.persistedRevision).toBe(0);
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
      await expect(run(harness, "session-a")).rejects.toBeInstanceOf(KvRestoreFailedError);
      await expect(run(harness, "session-c")).resolves.toHaveLength(2);
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

  it("cancellation: breaking the stream early does not mark dirty and releases the slot", async () => {
    const harness = await createHarness();
    try {
      let opened = false;
      const request = makeRequest({
        sessionId: "session-a",
        onStreamOpened: () => {
          opened = true;
        },
      });
      // A stream that would hang forever unless the consumer breaks.
      const stream = await harness.coordinator.runSessionRequest({
        ...request,
        next: async function* (): AsyncIterable<StreamChunk> {
          opened = true;
          yield { type: "text-delta", index: 0, text: "partial" };
          await new Promise(() => {});
        },
      });
      const iterator = stream[Symbol.asyncIterator]();
      const first = await iterator.next();
      expect(first.value).toMatchObject({ type: "text-delta" });
      await iterator.return?.(undefined);
      expect(opened).toBe(true);
      const runtime = harness.coordinator.getSessionState("session-a");
      expect(runtime?.dirtyRevision).toBe(0);

      // The lease is free: the next session runs immediately.
      const chunks = await run(harness, "session-b");
      expect(chunks.length).toBe(2);
      expect(harness.coordinator.slot.ownerSessionId).toBe("session-b");
    } finally {
      await harness.cleanup();
    }
  });

  it("holds the slot lease until A finishes, then saves A before starting B", async () => {
    const harness = await createHarness();
    const finishA = deferred();
    try {
      const streamA = await harness.coordinator.runSessionRequest({
        ...makeRequest({ sessionId: "session-a" }),
        next: async function* (): AsyncIterable<StreamChunk> {
          harness.backend.events.push("inference:a:start");
          yield { type: "text-delta", index: 0, text: "a" };
          await finishA.promise;
          harness.backend.events.push("inference:a:finish");
          yield { type: "finish", reason: { kind: "stop" } };
        },
      });
      const iteratorA = streamA[Symbol.asyncIterator]();
      await iteratorA.next();

      let bPrepared = false;
      const streamBPromise = harness.coordinator
        .runSessionRequest({
          ...makeRequest({ sessionId: "session-b" }),
          next: async function* (): AsyncIterable<StreamChunk> {
            harness.backend.events.push("inference:b:start");
            yield { type: "finish", reason: { kind: "stop" } };
          },
        })
        .then((stream) => {
          bPrepared = true;
          return stream;
        });

      await Promise.resolve();
      await Promise.resolve();
      expect(bPrepared).toBe(false);
      expect(harness.backend.eraseCount).toBe(1);
      expect(harness.backend.saveCount).toBe(0);
      expect(harness.coordinator.slot.ownerSessionId).toBe("session-a");

      finishA.resolve();
      expect((await iteratorA.next()).value).toMatchObject({ type: "finish" });
      await iteratorA.next();
      const streamB = await streamBPromise;
      await consume(streamB);

      expect(harness.backend.events).toEqual([
        "erase:0",
        "inference:a:start",
        "inference:a:finish",
        "save:0",
        "erase:0",
        "inference:b:start",
      ]);
      expect(harness.coordinator.slot.ownerSessionId).toBe("session-b");
    } finally {
      finishA.resolve();
      await harness.cleanup();
    }
  });

  it("releases the stream lease on downstream error so the next session can run", async () => {
    const harness = await createHarness();
    const failA = deferred();
    try {
      const streamA = await harness.coordinator.runSessionRequest({
        ...makeRequest({ sessionId: "session-a" }),
        next: async function* (): AsyncIterable<StreamChunk> {
          yield { type: "text-delta", index: 0, text: "partial" };
          await failA.promise;
          throw new Error("stream failed");
        },
      });
      const iteratorA = streamA[Symbol.asyncIterator]();
      await iteratorA.next();
      const streamBPromise = harness.coordinator.runSessionRequest(
        makeRequest({ sessionId: "session-b" }),
      );

      failA.resolve();
      await expect(iteratorA.next()).rejects.toThrowError("stream failed");
      const streamB = await streamBPromise;
      await expect(consume(streamB)).resolves.toHaveLength(2);
      expect(harness.coordinator.getSessionState("session-a")?.dirtyRevision).toBe(0);
      expect(harness.coordinator.slot.ownerSessionId).toBe("session-b");
    } finally {
      failA.resolve();
      await harness.cleanup();
    }
  });

  it("queues management mutations and idle work behind an open inference stream", async () => {
    const harness = await createHarness({ checkpoint: { idleMs: 15 } });
    try {
      await run(harness, "session-a");
      const savesBefore = harness.backend.saveCount;

      const streamA = await harness.coordinator.runSessionRequest({
        ...makeRequest({ sessionId: "session-a" }),
        next: async function* (): AsyncIterable<StreamChunk> {
          yield { type: "text-delta", index: 0, text: "partial" };
          await new Promise(() => undefined);
        },
      });
      const iteratorA = streamA[Symbol.asyncIterator]();
      await iteratorA.next();

      let checkpointSettled = false;
      let restoreSettled = false;
      let invalidateSettled = false;
      const checkpoint = harness.coordinator.checkpoint("session-a", "manual").then(() => {
        checkpointSettled = true;
      });
      const restore = harness.coordinator.restoreNow("session-a").then(() => {
        restoreSettled = true;
      });
      const invalidate = harness.coordinator.invalidate("session-a").then(() => {
        invalidateSettled = true;
      });

      await sleep(35);
      expect(checkpointSettled).toBe(false);
      expect(restoreSettled).toBe(false);
      expect(invalidateSettled).toBe(false);
      expect(harness.backend.saveCount).toBe(savesBefore);
      expect(harness.backend.eraseCount).toBe(1);

      await iteratorA.return?.(undefined);
      await Promise.all([checkpoint, restore, invalidate]);
      expect(harness.backend.saveCount).toBe(savesBefore + 1);
      expect(harness.backend.eraseCount).toBe(2);
    } finally {
      await harness.cleanup();
    }
  });

  it("idle checkpoint fires after idleMs and coalesces clean sessions (§26-§28, §71)", async () => {
    // Real timers with a tiny idle window keep the fs pipeline honest.
    const harness = await createHarness({ checkpoint: { idleMs: 30 } });
    try {
      await run(harness, "session-a");
      expect(harness.backend.saveCount).toBe(0);
      await sleep(120);
      expect(harness.backend.saveCount).toBe(1);
      const runtime = harness.coordinator.getSessionState("session-a");
      expect(runtime?.persistedRevision).toBe(1);
      expect(runtime?.lifecycle).toBe("saved");
      expect(harness.coordinator.slot.state).toBe("ready");

      // No further dirty state: the timer must not save again (§27).
      await sleep(80);
      expect(harness.backend.saveCount).toBe(1);
    } finally {
      await harness.cleanup();
    }
  }, 5_000);

  it("idle checkpoint rechecks ownership before saving (§71)", async () => {
    const harness = await createHarness({ checkpoint: { idleMs: 30 } });
    try {
      await run(harness, "session-a");
      await run(harness, "session-b"); // switch saves A; B owns now, dirty
      expect(harness.backend.saveCount).toBe(1); // A via switch
      await sleep(120);
      // The fired timer belongs to B and saves B, not A.
      expect(harness.backend.saveCount).toBe(2);
      expect(harness.coordinator.slot.ownerSessionId).toBe("session-b");
    } finally {
      await harness.cleanup();
    }
  }, 5_000);

  it("opens the circuit after repeated backend failures and still serves inference (§33)", async () => {
    const harness = await createHarness();
    try {
      harness.backend.setUnavailable(true);
      await run(harness, "session-a"); // erase fails -> failure #1 (degraded)
      await run(harness, "session-b"); // save A fails + erase fails -> #2, #3 (open)
      const erasesBefore = harness.backend.eraseCount;
      const chunks = await run(harness, "session-c"); // circuit open -> pass-through
      expect(chunks.map((chunk) => chunk.type)).toEqual(["text-delta", "finish"]);
      expect(harness.backend.eraseCount).toBe(erasesBefore);
      expect(harness.metrics.counters.circuitSkips).toBe(1);
    } finally {
      await harness.cleanup();
    }
  });

  it("session flush and disposal checkpoint dirty state (§50)", async () => {
    const harness = await createHarness();
    try {
      await run(harness, "session-a");
      await harness.coordinator.checkpoint("session-a", "session-flush");
      expect(harness.backend.saveCount).toBe(1);
      await run(harness, "session-a"); // dirty again
      await harness.coordinator.handleSessionDisposed("session-a");
      expect(harness.backend.saveCount).toBe(2);
      expect(harness.coordinator.slot.ownerSessionId).toBeNull();
      expect(harness.coordinator.getSessionState("session-a")).toBeUndefined();
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
