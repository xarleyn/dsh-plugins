import { describe, expect, it } from "vitest";
import {
  createHarness,
  run,
  sleep,
} from "../fixtures/harness.js";

describe("single-slot coordinator: idle and manual checkpoints (§26-§28, §50, §71)", () => {
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
});
