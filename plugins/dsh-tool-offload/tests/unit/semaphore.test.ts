/**
 * Unit tests for the non-blocking concurrency gates (SPEC §24, §32.2
 * "concurrent calls").
 */

import { describe, expect, it } from "vitest";

import { KeyedLimiter, Semaphore } from "../../src/utils/semaphore.js";

describe("Semaphore", () => {
  it("grants up to capacity and refuses beyond it", () => {
    const gate = new Semaphore(2);
    expect(gate.tryAcquire()).toBe(true);
    expect(gate.tryAcquire()).toBe(true);
    expect(gate.tryAcquire()).toBe(false);
    expect(gate.inUse).toBe(2);
    gate.release();
    expect(gate.tryAcquire()).toBe(true);
  });

  it("treats zero capacity as always exhausted", () => {
    const gate = new Semaphore(0);
    expect(gate.tryAcquire()).toBe(false);
  });
});

describe("KeyedLimiter", () => {
  it("tracks each key independently", () => {
    const limiter = new KeyedLimiter(1);
    expect(limiter.tryAcquire("a")).toBe(true);
    expect(limiter.tryAcquire("a")).toBe(false);
    expect(limiter.tryAcquire("b")).toBe(true);
    limiter.release("a");
    expect(limiter.tryAcquire("a")).toBe(true);
    expect(limiter.trackedKeys).toBe(2);
  });

  it("forgets keys after the last release", () => {
    const limiter = new KeyedLimiter(1);
    limiter.tryAcquire("a");
    limiter.release("a");
    expect(limiter.trackedKeys).toBe(0);
  });

  it("tolerates redundant releases", () => {
    const limiter = new KeyedLimiter(1);
    limiter.release("ghost");
    expect(limiter.trackedKeys).toBe(0);
  });
});
