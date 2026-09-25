/**
 * Shutdown checkpoint (SPEC §58): disposal must still write the final
 * snapshot of the dirty session that owns the slot.
 */

import { describe, expect, it } from "vitest";
import type { StreamChunk } from "@deepseek-ai/dsh-llm";
import {
  buildIdentity,
  consume,
  createHarness,
  makeRequest,
  run,
} from "../fixtures/harness.js";

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

  it("dispose waits for an open inference lease, then saves its result", async () => {
    const harness = await createHarness();
    try {
      const stream = await harness.coordinator.runSessionRequest({
        ...makeRequest({ sessionId: "session-a" }),
        next: async function* (): AsyncIterable<StreamChunk> {
          yield { type: "text-delta", index: 0, text: "partial" };
          yield { type: "finish", reason: { kind: "stop" } };
        },
      });
      const shutdown = harness.coordinator.dispose();

      // The final flush is queued behind the held lease, not skipped.
      await Promise.resolve();
      await Promise.resolve();
      expect(harness.backend.saveCount).toBe(0);

      await consume(stream);
      await shutdown;

      expect(harness.backend.saveCount).toBe(1);
      expect(harness.metrics.counters.saves).toBe(1);
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
