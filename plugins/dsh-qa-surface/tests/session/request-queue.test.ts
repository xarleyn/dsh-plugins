import { describe, expect, it } from "vitest";
import { qaActiveRequests, qaQueueStatus } from "../../src/request-queue.js";

const running = { status: "running" } as const;
const idle = { status: "idle" } as const;

describe("QA request queue", () => {
  it("counts the turns the harness reports as answering", () => {
    expect(qaActiveRequests([idle, running, running])).toBe(2);
    expect(qaActiveRequests([])).toBe(0);
  });

  it("treats a ceiling of zero as no limit at all", () => {
    // The default: a hosted deployment has no ceiling to name, and the queue
    // must stay silent rather than report a full stand with nothing configured.
    expect(qaQueueStatus(0, 40)).toEqual({ limit: 0, active: 40, full: false });
  });

  it("keeps the queue empty while a place is free", () => {
    expect(qaQueueStatus(2, 1)).toEqual({ limit: 2, active: 1, full: false });
  });

  it("reports a full stand at its ceiling and past it", () => {
    expect(qaQueueStatus(2, 2)).toEqual({ limit: 2, active: 2, full: true });
    // A stand that overshot the ceiling is still full: the next question has no
    // place to land either way.
    expect(qaQueueStatus(2, 5)).toMatchObject({ full: true, active: 5 });
  });

  it("names the load it measured and nothing else", () => {
    // No per-visitor position: `active` counts this visitor's own turns too, so
    // any number claiming to be "ahead of you" would be invented.
    expect(Object.keys(qaQueueStatus(1, 3)).sort()).toEqual([
      "active",
      "full",
      "limit",
    ]);
  });
});
