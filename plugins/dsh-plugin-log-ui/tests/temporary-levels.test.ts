/**
 * The store behind a level the operator holds rather than saves.
 *
 * Two ways a window closes, and the card cannot tell them apart: the Host's timer
 * fires, or nobody asked while the clock ran out and the next read finds the window
 * gone. Both have to land on the same answer — the plugin back on its settings — so
 * the store is driven here by a clock the suite moves, with no Config in sight: a
 * held level is not a setting, and these tests are where that stops being a claim.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_TEMPORARY_LEVEL_MINUTES,
  TemporaryLevels,
} from "../src/temporary-levels.js";
import type { ManagedPluginLogLevel } from "../src/types.js";

const MINUTE = 60_000;

/** A clock and the timers it handed out, so a window is fired, not waited for. */
function stand() {
  let current = 1_700_000_000_000;
  const pending: Array<{ readonly at: number; readonly run: () => void }> = [];
  const lapses: number[] = [];
  const levels = new TemporaryLevels({
    now: () => current,
    schedule: (callback, delayMs) => {
      const timer = { at: current + delayMs, run: callback };
      pending.push(timer);
      return () => {
        const index = pending.indexOf(timer);
        if (index >= 0) pending.splice(index, 1);
      };
    },
    onLapse: () => lapses.push(current),
  });
  return {
    levels,
    lapses,
    pending: () => pending.length,
    advance: (ms: number) => {
      current += ms;
    },
    fireDue: () => {
      for (const timer of [...pending]) {
        if (timer.at > current) continue;
        pending.splice(pending.indexOf(timer), 1);
        timer.run();
      }
    },
  };
}

describe("temporary levels", () => {
  it("holds nothing until it is asked", () => {
    const held = new TemporaryLevels();
    expect(held.levelOf("dsh-sample")).toBeUndefined();
    expect(held.list()).toEqual([]);
  });

  it("counts a timed window down for the snapshot", () => {
    const { levels, advance } = stand();
    levels.set("dsh-sample", "debug", 15);

    expect(levels.levelOf("dsh-sample")).toBe("debug");
    expect(levels.list()).toEqual([
      {
        pluginId: "dsh-sample",
        level: "debug",
        scope: "timed",
        remainingMs: 15 * MINUTE,
      },
    ]);

    advance(4 * MINUTE);
    expect(levels.list()[0]?.remainingMs).toBe(11 * MINUTE);
  });

  it("states a session window as held, with nothing to count", () => {
    const { levels, advance, fireDue, lapses } = stand();
    levels.set("dsh-sample", "trace");

    expect(levels.list()).toEqual([
      { pluginId: "dsh-sample", level: "trace", scope: "session" },
    ]);
    // No timer was scheduled: revoking it is the operator's, not the clock's.
    expect(levels.levelOf("dsh-sample")).toBe("trace");
    advance(60 * MINUTE);
    fireDue();
    expect(lapses).toEqual([]);
    expect(levels.levelOf("dsh-sample")).toBe("trace");
  });

  it("closes a window on its timer and says so once", () => {
    const { levels, advance, fireDue, lapses, pending } = stand();
    levels.set("dsh-sample", "debug", 5);
    expect(pending()).toBe(1);

    advance(5 * MINUTE);
    fireDue();

    expect(levels.levelOf("dsh-sample")).toBeUndefined();
    expect(levels.list()).toEqual([]);
    // The owner re-applies its policy on this one call; a second would be a
    // registry notification loop the card never asked for.
    expect(lapses).toHaveLength(1);
  });

  it("drops a window whose timer never ran the next time it is read", () => {
    const { levels, advance } = stand();
    levels.set("dsh-sample", "debug", 5);
    advance(6 * MINUTE);

    expect(levels.levelOf("dsh-sample")).toBeUndefined();
    expect(levels.list()).toEqual([]);
  });

  it("replaces a held level without keeping the window it replaced", () => {
    const { levels, advance, fireDue, lapses, pending } = stand();
    levels.set("dsh-sample", "debug", 5);
    levels.set("dsh-sample", "trace", 30);
    expect(levels.levelOf("dsh-sample")).toBe("trace");

    // The first window is gone with its timer: five minutes must not close a hold
    // the operator just extended to half an hour.
    advance(5 * MINUTE);
    expect(fireDue()).toBeUndefined();
    expect(levels.levelOf("dsh-sample")).toBe("trace");
    expect(lapses).toEqual([]);
    // One timer left, and it is the 30-minute one: the replaced window cancelled
    // its own rather than leaving it to fire over the hold it no longer owns.
    expect(pending()).toBe(1);

    advance(25 * MINUTE);
    fireDue();
    expect(levels.levelOf("dsh-sample")).toBeUndefined();
    expect(lapses).toHaveLength(1);
  });

  it("gives a plugin back on request and schedules nothing new", () => {
    const { levels, pending } = stand();
    levels.set("dsh-sample", "debug", 10);
    levels.clear("dsh-sample");

    expect(levels.levelOf("dsh-sample")).toBeUndefined();
    expect(levels.list()).toEqual([]);
    expect(pending()).toBe(0);
  });

  it("orders the snapshot by the window that closes first", () => {
    const { levels, advance } = stand();
    levels.set("dsh-slow", "debug", 60);
    levels.set("dsh-quick", "trace", 5);
    levels.set("dsh-open", "warn");

    expect(levels.list().map((level) => level.pluginId)).toEqual([
      "dsh-quick",
      "dsh-slow",
      "dsh-open",
    ]);
    // A read that finds a window closed removes it from the list it builds.
    advance(10 * MINUTE);
    expect(levels.list().map((level) => level.pluginId)).toEqual([
      "dsh-slow",
      "dsh-open",
    ]);
  });

  it("cancels every window on dispose, so a stopping Host leaves no timer", () => {
    const { levels, advance, fireDue, lapses, pending } = stand();
    levels.set("dsh-sample", "debug", 5);
    levels.dispose();

    expect(pending()).toBe(0);
    expect(levels.levelOf("dsh-sample")).toBeUndefined();
    advance(5 * MINUTE);
    fireDue();
    expect(lapses).toEqual([]);
  });

  it("refuses a window or an address it cannot apply", () => {
    const { levels, lapses } = stand();
    const id = "dsh-sample";
    const refused: Array<readonly [string, ManagedPluginLogLevel, number?]> = [
      [id, "debug", 0],
      [id, "debug", -5],
      [id, "debug", MAX_TEMPORARY_LEVEL_MINUTES + 1],
      [id, "debug", 2.5],
      ["", "debug"],
      ["dsh sample", "debug"],
      [id, "shout" as ManagedPluginLogLevel],
    ];

    for (const [pluginId, level, minutes] of refused) {
      expect(() => levels.set(pluginId, level, minutes)).toThrow(TypeError);
    }
    // A refusal that left a half-built hold behind would be the worse outcome.
    expect(levels.list()).toEqual([]);
    expect(lapses).toEqual([]);
  });

  it("keeps the hold it has when a replacement is refused", () => {
    const { levels } = stand();
    levels.set("dsh-sample", "debug", 10);

    expect(() => levels.set("dsh-sample", "debug", 0)).toThrow(TypeError);
    expect(levels.levelOf("dsh-sample")).toBe("debug");
  });
});
