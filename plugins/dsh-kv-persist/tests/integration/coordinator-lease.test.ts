import { describe, expect, it } from "vitest";
import type { StreamChunk } from "@deepseek-ai/dsh-llm";
import {
  consume,
  createHarness,
  deferred,
  makeRequest,
  run,
  sleep,
} from "../fixtures/harness.js";

describe("single-slot coordinator: leases and queueing (SPEC §72-§74)", () => {
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
});
