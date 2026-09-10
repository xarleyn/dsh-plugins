import { describe, expect, it } from "vitest";

import { ChannelQuarantine, PassThroughMonitor, ReleasedTail } from "../../src/stream/quarantine.js";

const options = {
  checkEveryChars: 16,
  windowChars: 64,
  lookbehindChars: 32,
  minCheckIntervalMs: 0,
  maxBufferedChars: 128,
};

describe("ChannelQuarantine", () => {
  it("buffers below the check threshold", () => {
    const quarantine = new ChannelQuarantine(options);
    expect(quarantine.append("short", 0)).toBe("buffer");
    expect(quarantine.size).toBe(5);
  });

  it("requests a check at the threshold and honours the interval", () => {
    const quarantine = new ChannelQuarantine(options);
    expect(quarantine.append("x".repeat(16), 0)).toBe("check");
    quarantine.markChecked(0);
    expect(quarantine.append("y", 100)).toBe("buffer");
    const slow = new ChannelQuarantine({ ...options, minCheckIntervalMs: 1_000 });
    expect(slow.append("y".repeat(16), 0)).toBe("check");
    slow.markChecked(0);
    expect(slow.append("y".repeat(16), 500)).toBe("buffer");
    expect(slow.append("", 2_000)).toBe("check");
  });

  it("keeps buffering while a classifier is in flight and overflows fail closed", () => {
    const quarantine = new ChannelQuarantine(options);
    quarantine.classifierRunning = true;
    expect(quarantine.append("z".repeat(100), 0)).toBe("buffer");
    expect(quarantine.append("z".repeat(40), 0)).toBe("overflow");
  });

  it("includes lookbehind and clamps snapshots to the window", () => {
    const quarantine = new ChannelQuarantine(options);
    quarantine.append("pending".repeat(30), 0);
    const tail = new ReleasedTail(options.lookbehindChars);
    tail.append("r".repeat(100));
    const snapshot = quarantine.snapshotText(tail.tail());
    expect(snapshot.length).toBeLessThanOrEqual(options.windowChars);
    expect(snapshot.endsWith(quarantine.snapshotText("").slice(-7))).toBe(true);
  });

  it("flushes pending content in order with the stashed block-start", () => {
    const quarantine = new ChannelQuarantine(options);
    quarantine.stashBlockStart({ type: "block-start", index: 0 });
    quarantine.append("a", 0);
    quarantine.append("b", 0);
    const flushed = quarantine.flush();
    expect(flushed.blockStart).toEqual({ type: "block-start", index: 0 });
    expect(flushed.texts).toEqual(["a", "b"]);
    expect(quarantine.hasPending).toBe(false);
  });
});

describe("PassThroughMonitor", () => {
  it("detects check thresholds for observe/interrupt modes", () => {
    const monitor = new PassThroughMonitor({ checkEveryChars: 10, lookbehindChars: 20, minCheckIntervalMs: 0 });
    expect(monitor.append("abc", 0)).toBe("monitor");
    expect(monitor.append("defghijklm", 0)).toBe("check");
    monitor.markChecked(0);
    expect(monitor.append("n", 0)).toBe("monitor");
  });

  it("caps its recent window", () => {
    const monitor = new PassThroughMonitor({ checkEveryChars: 10, lookbehindChars: 20, minCheckIntervalMs: 0 });
    for (let index = 0; index < 50; index += 1) monitor.append("x".repeat(50), index);
    expect(monitor.windowText().length).toBeLessThanOrEqual(20 + 10 * 2);
  });
});

describe("ReleasedTail", () => {
  it("keeps the lookbehind tail", () => {
    const tail = new ReleasedTail(8);
    tail.append("1234567890");
    expect(tail.tail()).toBe("34567890");
  });
});
