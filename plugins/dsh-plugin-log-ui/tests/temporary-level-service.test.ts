/**
 * The level an operator holds instead of saving, end to end through the service.
 *
 * This suite builds exactly one `PluginLogUi`. A second service in the process
 * would subscribe to the same logger registry, and applying its policy would land
 * inside the first one's `setPluginLogLevel` — the registry notification the level
 * change itself fires — so the older instance would win and a held level would read
 * as if it had never been set. The Host loads this plugin once, so that fight is
 * not a production shape; a suite with two services would be measuring which
 * listener ran last rather than what a hold does. `integration.test.ts` boots its
 * services through `ctx.plugin`, which cannot carry the clock and the timers this
 * suite has to drive, so the pair lives here.
 */
import { Context } from "@deepseek-ai/cordis";
import { createPluginLogger } from "@yadsh/dsh-plugin-log";
import { afterEach, describe, expect, it } from "vitest";
import PluginLogUi from "../src/index.js";
import type {
  ManagedPluginLogLevel,
  PluginLogUiConfig,
  VolatilePluginLogUiConfig,
} from "../src/types.js";

const MINUTE = 60_000;
const loggers: Array<ReturnType<typeof createPluginLogger>> = [];

function logger(pluginId: string) {
  const created = createPluginLogger({
    pluginId,
    file: false,
    console: "silent",
    level: "trace",
    format: "json",
  });
  loggers.push(created);
  return created;
}

afterEach(async () => {
  // Give back every hold the test took, so its window and its timer do not
  // outlive it: the next test counts the timers it scheduled, not the leftovers.
  for (const level of suite.ui.inspect().temporary) {
    suite.ui.clearTemporaryLevel(level.pluginId);
  }
  await Promise.all(loggers.splice(0).map((entry) => entry.close()));
});

/**
 * The one service, with a clock and timers the suite moves and a Config it reads as
 * a live section each test replaces.
 *
 * The volatile stand is hand-built for the same reason the Loader builds it: every
 * field is read at the moment of use. `section()` is what the settings hold, so a
 * hold that reached them would show up here as a changed section — the assertion the
 * card's own suite can only make from the browser side.
 */
const suite = (() => {
  let section: PluginLogUiConfig = {};
  let current = 0;
  const pending: Array<{ readonly at: number; readonly run: () => void }> = [];
  const config: VolatilePluginLogUiConfig = {
    defaultLevel: { get: () => section.defaultLevel ?? "info" },
    format: { get: () => section.format ?? "text" },
    levels: { get: () => section.levels ?? {} },
  };
  const ui = new PluginLogUi(new Context(), config, {
    now: () => current,
    schedule: (callback, delayMs) => {
      const timer = { at: current + delayMs, run: callback };
      pending.push(timer);
      return () => {
        const index = pending.indexOf(timer);
        if (index >= 0) pending.splice(index, 1);
      };
    },
  });
  return {
    ui,
    section: () => section,
    configure: (next: PluginLogUiConfig) => {
      section = next;
      // A settings edit reaches the loggers through the same policy the card's poll
      // drives; the suite says so out loud instead of waiting for a browser.
      ui.inspect();
    },
    advance: (ms: number) => {
      current += ms;
    },
    /** Fire what the Host's clock has run out — the timer, not a browser's poll. */
    fireDue: () => {
      for (const timer of [...pending]) {
        if (timer.at > current) continue;
        pending.splice(pending.indexOf(timer), 1);
        timer.run();
      }
    },
    pending: () => pending.length,
  };
})();

describe("the held level", () => {
  it("moves the live logger and leaves the settings where they were", () => {
    suite.configure({ defaultLevel: "info" });
    const created = logger("dsh-held");
    expect(created.level).toBe("info");

    suite.ui.setTemporaryLevel("dsh-held", "debug", 5);

    expect(created.level).toBe("debug");
    // Nothing of the hold reached the Config: the section still says what the
    // operator set before, with no override for this plugin. A diagnostics pass that
    // had to be undone is the bug; this is the proof it is not one.
    expect(suite.section()).toEqual({ defaultLevel: "info" });
    expect(suite.ui.getConfig()).toEqual({
      defaultLevel: "info",
      format: "text",
      levels: {},
    });
    // The snapshot the card polls carries it instead, with the window counted.
    expect(suite.ui.inspect().temporary).toEqual([
      {
        pluginId: "dsh-held",
        level: "debug",
        scope: "timed",
        remainingMs: 5 * MINUTE,
      },
    ]);
  });

  it("closes the window on the Host's timer with no browser left to poll", () => {
    suite.configure({ defaultLevel: "info" });
    const created = logger("dsh-window");
    suite.ui.setTemporaryLevel("dsh-window", "trace", 5);
    expect(created.level).toBe("trace");
    expect(suite.pending()).toBe(1);

    // The card was closed five minutes ago; nothing is going to ask again.
    suite.advance(5 * MINUTE);
    suite.fireDue();

    expect(created.level).toBe("info");
    expect(suite.ui.inspect().temporary).toEqual([]);
    expect(suite.pending()).toBe(0);
  });

  it("reverts on the next read a window whose timer never ran", () => {
    suite.configure({ defaultLevel: "warn" });
    const created = logger("dsh-throttled");
    suite.ui.setTemporaryLevel("dsh-throttled", "debug", 1);
    expect(created.level).toBe("debug");

    // A Host that slept through the window owes the plugin its settings level the
    // moment anyone asks, timer or no timer.
    suite.advance(2 * MINUTE);
    expect(suite.ui.inspect().temporary).toEqual([]);
    expect(created.level).toBe("warn");
  });

  it("keeps the held level over a logger that registers after the hold", () => {
    suite.configure({ defaultLevel: "info" });
    // The operator is looking for a plugin's DEBUG lines and starts it to get them.
    suite.ui.setTemporaryLevel("dsh-late", "debug", 10);

    const created = logger("dsh-late");
    // Registering runs the policy through the registry callback. A policy that read
    // only the settings would drop the hold here, one poll after the operator set it
    // — which is what no card could have done anything about before.
    expect(created.level).toBe("debug");
    expect(suite.ui.getConfig().levels).toEqual({});
  });

  it("holds a level until it is revoked, then gives the plugin back", () => {
    suite.configure({ defaultLevel: "error" });
    const created = logger("dsh-session");

    suite.ui.setTemporaryLevel("dsh-session", "debug");
    expect(created.level).toBe("debug");
    // A session hold has no window to lapse: an hour of clock changes nothing, and
    // the snapshot says so instead of counting down.
    suite.advance(60 * MINUTE);
    suite.fireDue();
    expect(suite.ui.inspect().temporary).toEqual([
      { pluginId: "dsh-session", level: "debug", scope: "session" },
    ]);
    expect(created.level).toBe("debug");

    suite.ui.clearTemporaryLevel("dsh-session");
    expect(created.level).toBe("error");
    expect(suite.ui.inspect().temporary).toEqual([]);
    expect(suite.section()).toEqual({ defaultLevel: "error" });
  });

  it("goes back to the saved override, not to the default, when the window ends", () => {
    suite.configure({ defaultLevel: "info", levels: { "dsh-saved": "trace" } });
    const created = logger("dsh-saved");
    expect(created.level).toBe("trace");

    suite.ui.setTemporaryLevel("dsh-saved", "silent", 5);
    expect(created.level).toBe("silent");
    // Not the timer — the read. A hold over a deliberate setting changes only the
    // moment, and hands back exactly what it found.
    suite.advance(6 * MINUTE);
    expect(suite.ui.inspect().temporary).toEqual([]);
    expect(created.level).toBe("trace");
  });

  it("refuses a window or an address the settings would refuse", () => {
    suite.configure({ defaultLevel: "info" });
    const created = logger("dsh-refused");

    const refusals: readonly (() => void)[] = [
      () => suite.ui.setTemporaryLevel("dsh-refused", "debug", 0),
      () => suite.ui.setTemporaryLevel("dsh-refused", "debug", -5),
      () => suite.ui.setTemporaryLevel("dsh-refused", "debug", 241),
      () => suite.ui.setTemporaryLevel("dsh-refused", "debug", 2.5),
      () => suite.ui.setTemporaryLevel("not an id", "debug"),
      () => suite.ui.setTemporaryLevel("", "debug"),
      () =>
        suite.ui.setTemporaryLevel(
          "dsh-refused",
          "verbose" as ManagedPluginLogLevel,
        ),
    ];
    for (const refusal of refusals) {
      expect(refusal).toThrow(TypeError);
    }
    // A refusal that moved a level, or held one halfway, would be worse than the
    // error: the operator would read a stand that is not what it looks like.
    expect(created.level).toBe("info");
    expect(suite.ui.inspect().temporary).toEqual([]);
    expect(suite.section()).toEqual({ defaultLevel: "info" });
  });
});
