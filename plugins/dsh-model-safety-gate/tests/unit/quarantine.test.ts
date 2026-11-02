import { describe, expect, it } from "vitest";

import {
  ChannelQuarantine,
  PassThroughMonitor,
  ReleasedTail,
} from "../../src/stream/quarantine.js";

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
    const slow = new ChannelQuarantine({
      ...options,
      minCheckIntervalMs: 1_000,
    });
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

  it("fills a snapshot from the pending head with released context in front", () => {
    const quarantine = new ChannelQuarantine(options);
    quarantine.append("pending".repeat(4), 0);
    const tail = new ReleasedTail(options.lookbehindChars);
    tail.append("r".repeat(100));
    expect(quarantine.snapshotText(tail.tail())).toBe(
      "r".repeat(32) + "pending".repeat(4),
    );
  });

  it("clamps a snapshot to the window without dropping the pending head", () => {
    const quarantine = new ChannelQuarantine(options);
    quarantine.append("pending".repeat(30), 0);
    // A full pending window still reserves the overlap at its leading seam.
    expect(quarantine.snapshotText("r".repeat(32))).toBe(
      "r".repeat(32) + "pending".repeat(30).slice(0, 32),
    );
  });

  it("flushes verified pending content in order with the stashed block-start", () => {
    const quarantine = new ChannelQuarantine(options);
    quarantine.stashBlockStart({ type: "block-start", index: 0 });
    quarantine.append("a", 0);
    quarantine.append("b", 0);
    quarantine.snapshotText("");
    quarantine.markChecked(0);
    const flushed = quarantine.flush();
    expect(flushed.blockStart).toEqual({ type: "block-start", index: 0 });
    expect(flushed.texts).toEqual(["a", "b"]);
    expect(quarantine.hasPending).toBe(false);
  });

  it("withholds everything no check has covered", () => {
    const quarantine = new ChannelQuarantine(options);
    quarantine.stashBlockStart({ type: "block-start", index: 0 });
    quarantine.append("never examined", 0);
    const flushed = quarantine.flush();
    expect(flushed.texts).toEqual([]);
    // The header opens this text, so it stays stashed with it.
    expect(flushed.blockStart).toBeNull();
    expect(quarantine.size).toBe(14);
    expect(quarantine.hasPending).toBe(true);
  });

  it("releases one window of an oversized buffer and keeps the rest quarantined", () => {
    const quarantine = new ChannelQuarantine(options);
    quarantine.stashBlockStart({ type: "block-start", index: 0 });
    quarantine.append("a".repeat(64) + "b".repeat(36), 0);
    expect(quarantine.snapshotText("")).toBe("a".repeat(64));
    quarantine.markChecked(0);
    expect(quarantine.flush().texts).toEqual(["a".repeat(64)]);
    expect(quarantine.size).toBe(36);
    // The next window re-reads the released seam in front of the rest, so the
    // two windows leave no range unchecked between them.
    expect(quarantine.snapshotText("a".repeat(64))).toBe(
      "a".repeat(32) + "b".repeat(32),
    );
    quarantine.markChecked(0);
    expect(quarantine.flush().texts).toEqual(["b".repeat(32)]);
    expect(quarantine.size).toBe(4);
    expect(quarantine.snapshotText("b".repeat(32))).toBe("b".repeat(36));
    quarantine.markChecked(0);
    expect(quarantine.flush().texts).toEqual(["b".repeat(4)]);
    expect(quarantine.hasPending).toBe(false);
  });

  it.each([0, 64, 128])(
    "makes progress with lookbehind size %i",
    (lookbehindChars) => {
      const quarantine = new ChannelQuarantine({ ...options, lookbehindChars });
      quarantine.append("abc", 0);
      expect(
        quarantine.snapshotText("r".repeat(128)).length,
      ).toBeLessThanOrEqual(64);
      quarantine.markChecked(0);
      const flushed = quarantine.flush().texts.join("");
      expect(flushed.length).toBeGreaterThan(0);
      expect("abc".startsWith(flushed)).toBe(true);
    },
  );
});

describe("PassThroughMonitor", () => {
  it("detects check thresholds for observe/interrupt modes", () => {
    const monitor = new PassThroughMonitor({
      checkEveryChars: 10,
      lookbehindChars: 20,
      minCheckIntervalMs: 0,
    });
    expect(monitor.append("abc", 0)).toBe("monitor");
    expect(monitor.append("defghijklm", 0)).toBe("check");
    monitor.markChecked(0);
    expect(monitor.append("n", 0)).toBe("monitor");
  });

  it("caps its recent window", () => {
    const monitor = new PassThroughMonitor({
      checkEveryChars: 10,
      lookbehindChars: 20,
      minCheckIntervalMs: 0,
    });
    for (let index = 0; index < 50; index += 1)
      monitor.append("x".repeat(50), index);
    expect(monitor.windowText().length).toBeLessThanOrEqual(20 + 10 * 2);
  });
});

describe("ReleasedTail", () => {
  it.each([0, 8, 128])(
    "bounds retained context after repeated flushes with lookbehind %i",
    (lookbehind) => {
      const tail = new ReleasedTail(lookbehind);
      for (let index = 0; index < 100; index += 1) {
        const chunk = String(index % 10).repeat(1000);
        tail.append(chunk);
        expect(tail.tail()).toBe(
          lookbehind === 0 ? "" : chunk.slice(-lookbehind),
        );
      }
    },
  );

  it("keeps the lookbehind tail", () => {
    const tail = new ReleasedTail(8);
    tail.append("1234567890");
    expect(tail.tail()).toBe("34567890");
  });
});
