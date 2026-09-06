import { describe, expect, it } from "vitest";
import {
  createSessionRuntime,
  isDirty,
  markDirty,
  markPersisted,
} from "../../src/coordinator/state-machine.js";
import { CheckpointPolicy } from "../../src/coordinator/checkpoint-policy.js";
import { SlotMutex } from "../../src/coordinator/slot-lease.js";
import { CircuitBreaker } from "../../src/coordinator/circuit-breaker.js";
import { resolveKvPersistConfig } from "../../src/config.js";

describe("dirty generations (SPEC §28)", () => {
  it("starts clean at generation 0", () => {
    const runtime = createSessionRuntime("s", { provider: "p", model: "m" });
    expect(isDirty(runtime)).toBe(false);
    expect(runtime.lifecycle).toBe("none");
  });

  it("becomes dirty on a successful inference and stays dirty until persisted", () => {
    const runtime = createSessionRuntime("s", { provider: "p", model: "m" });
    markDirty(runtime);
    expect(runtime.dirtyRevision).toBe(1);
    expect(runtime.persistedRevision).toBe(0);
    expect(isDirty(runtime)).toBe(true);
    expect(runtime.lifecycle).toBe("active-dirty");
  });

  it("remains dirty when inference advances during a save of an older generation", () => {
    const runtime = createSessionRuntime("s", { provider: "p", model: "m" });
    markDirty(runtime); // revision 1
    markDirty(runtime); // revision 2 — inference continued while save ran
    markPersisted(runtime, 1);
    expect(runtime.persistedRevision).toBe(1);
    expect(runtime.dirtyRevision).toBe(2);
    expect(isDirty(runtime)).toBe(true);
  });

  it("becomes clean when the latest generation is persisted", () => {
    const runtime = createSessionRuntime("s", { provider: "p", model: "m" });
    markDirty(runtime);
    markPersisted(runtime, runtime.dirtyRevision);
    expect(isDirty(runtime)).toBe(false);
    expect(runtime.lifecycle).toBe("saved");
  });
});

describe("checkpoint policy (SPEC §26)", () => {
  const defaults = resolveKvPersistConfig({});

  function policyWith(overrides: Parameters<typeof resolveKvPersistConfig>[0]): CheckpointPolicy {
    return new CheckpointPolicy(resolveKvPersistConfig(overrides));
  }

  it("follows the recommended switch + idle + shutdown defaults", () => {
    const policy = new CheckpointPolicy(defaults);
    const runtime = createSessionRuntime("s", { provider: "p", model: "m" });
    markDirty(runtime);
    expect(policy.shouldCheckpoint(runtime, "switch")).toBe(true);
    expect(policy.shouldCheckpoint(runtime, "idle")).toBe(true);
    expect(policy.shouldCheckpoint(runtime, "shutdown")).toBe(true);
    expect(policy.shouldCheckpoint(runtime, "session-flush")).toBe(true);
    expect(policy.shouldCheckpoint(runtime, "turn-end")).toBe(false);
    expect(policy.shouldCheckpoint(runtime, "manual")).toBe(true);
  });

  it("never checkpoints a clean session", () => {
    const policy = new CheckpointPolicy(defaults);
    const runtime = createSessionRuntime("s", { provider: "p", model: "m" });
    expect(policy.shouldCheckpoint(runtime, "switch")).toBe(false);
    expect(policy.shouldCheckpoint(runtime, "manual")).toBe(false);
    expect(policy.shouldCheckpoint(runtime, "idle")).toBe(false);
  });

  it("never checkpoints an unknown session", () => {
    const policy = new CheckpointPolicy(defaults);
    expect(policy.shouldCheckpoint(undefined, "switch")).toBe(false);
  });

  it("honors disabled switches and disabled idle timers", () => {
    const policy = policyWith({
      checkpoint: { onSwitch: false, idleMs: 0 },
    });
    const runtime = createSessionRuntime("s", { provider: "p", model: "m" });
    markDirty(runtime);
    expect(policy.shouldCheckpoint(runtime, "switch")).toBe(false);
    expect(policy.shouldCheckpoint(runtime, "idle")).toBe(false);
    expect(policy.shouldCheckpoint(runtime, "session-flush")).toBe(true);
  });
});

describe("slot mutex (SPEC §20, Invariant 8)", () => {
  it("serializes concurrent bodies", async () => {
    const mutex = new SlotMutex("test");
    const order: string[] = [];
    let releaseA: () => void = () => {};
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    const first = mutex.runExclusive(async () => {
      order.push("start:a");
      await gateA;
      order.push("end:a");
      return "a";
    });
    const second = mutex.runExclusive(async () => {
      order.push("start:b");
      return "b";
    });

    // Drain microtasks: only A may run while the gate is closed.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["start:a"]);

    releaseA();
    expect(await first).toBe("a");
    expect(await second).toBe("b");
    expect(order).toEqual(["start:a", "end:a", "start:b"]);
  });

  it("keeps serializing after a failing body", async () => {
    const mutex = new SlotMutex("test");
    await expect(
      mutex.runExclusive(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrowError("boom");
    expect(await mutex.runExclusive(async () => "recovered")).toBe("recovered");
  });

  it("exposes an idempotent lease that blocks following work until release", async () => {
    const mutex = new SlotMutex("test");
    const release = await mutex.acquire();
    let entered = false;
    const queued = mutex.runExclusive(async () => {
      entered = true;
      return "next";
    });

    await Promise.resolve();
    expect(entered).toBe(false);
    expect(mutex.held).toBe(true);

    release();
    release();
    expect(await queued).toBe("next");
    expect(entered).toBe(true);
    expect(mutex.held).toBe(false);
  });
});

describe("circuit breaker (SPEC §33)", () => {
  const options = { maxConsecutiveFailures: 3, cooldownMs: 60_000 };

  it("allows attempts while healthy and degraded", () => {
    const breaker = new CircuitBreaker(options);
    expect(breaker.allows(0)).toBe(true);
    breaker.recordFailure(0);
    expect(breaker.state).toBe("degraded");
    expect(breaker.allows(1)).toBe(true);
  });

  it("opens after the configured consecutive failures", () => {
    const breaker = new CircuitBreaker(options);
    breaker.recordFailure(0);
    breaker.recordFailure(1);
    breaker.recordFailure(2);
    expect(breaker.state).toBe("open");
    expect(breaker.allows(3)).toBe(false);
  });

  it("half-opens after the cooldown and recovers on success", () => {
    const breaker = new CircuitBreaker(options);
    breaker.recordFailure(0);
    breaker.recordFailure(1);
    breaker.recordFailure(2);
    // The last failure opened the circuit until 2 + 60_000.
    expect(breaker.allows(60_002)).toBe(true);
    expect(breaker.state).toBe("half-open");
    breaker.recordSuccess();
    expect(breaker.state).toBe("healthy");
  });

  it("re-opens when the half-open probe fails", () => {
    const breaker = new CircuitBreaker(options);
    for (let i = 0; i < 3; i += 1) breaker.recordFailure(i);
    expect(breaker.allows(60_002)).toBe(true);
    breaker.recordFailure(60_002);
    expect(breaker.state).toBe("open");
    expect(breaker.allows(60_003)).toBe(false);
  });
});
