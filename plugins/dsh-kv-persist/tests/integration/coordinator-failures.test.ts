import { describe, expect, it } from "vitest";
import {
  createHarness,
  run,
} from "../fixtures/harness.js";
import { KvRestoreFailedError } from "../../src/errors.js";

describe("single-slot coordinator: backend failures and degradation (§32-§33)", () => {
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
});
