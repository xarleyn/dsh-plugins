import { describe, expect, it } from "vitest";
import type { PluginLogRecordLevel, PluginLogRecordView } from "../src/types.js";
import {
  LOG_PANEL_LEVELS,
  appendRecords,
  createLogTailReader,
  filterRecords,
  formatRecord,
  formatScope,
  formatTime,
  matchesFilter,
  mergeSources,
  type LogFilter,
} from "../src/client/panel/log-view.js";

const ALL_LEVELS = new Set<PluginLogRecordLevel>(LOG_PANEL_LEVELS);

/** The panel's filters with only the named fields changed. */
function filter(overrides: Partial<LogFilter> = {}): LogFilter {
  return { levels: ALL_LEVELS, query: "", source: "", ...overrides };
}

/** One record as the panel receives it: fields already rendered by the host. */
function view(
  seq: number,
  overrides: Partial<PluginLogRecordView> = {},
): PluginLogRecordView {
  return {
    seq,
    // Local time, because the line's clock is local; a UTC literal would make
    // these assertions depend on the machine's zone.
    time: new Date(2026, 8, 13, 10, 2, 3, 456).getTime(),
    level: "info",
    pluginId: "dsh-sample",
    module: "",
    event: `event.${seq}`,
    fields: [],
    ...overrides,
  };
}

describe("line formatting", () => {
  it("leads with a local clock at millisecond precision", () => {
    const time = new Date(2026, 8, 13, 10, 2, 3, 7).getTime();
    expect(formatTime(time)).toBe("10:02:03.007");
  });

  it("joins plugin and module into one scope, and omits an absent module", () => {
    expect(formatScope(view(1))).toBe("dsh-sample");
    expect(formatScope(view(1, { module: "worker" }))).toBe("dsh-sample/worker");
  });

  it("renders clock, level, scope, event and fields as one line", () => {
    expect(formatRecord(view(1, { level: "warn", fields: [{ key: "attempt", value: "2" }] })))
      .toBe("10:02:03.456 WARN  [dsh-sample] event.1 attempt=2");
  });
});

describe("filtering", () => {
  it("keeps the records whose level is enabled", () => {
    expect(matchesFilter(view(1, { level: "debug" }), filter({ levels: new Set(["info"]) }))).toBe(false);
    expect(matchesFilter(view(1, { level: "info" }), filter({ levels: new Set(["info"]) }))).toBe(true);
  });

  it("matches the rendered line case-insensitively, fields included", () => {
    const record = view(1, {
      pluginId: "dsh-kv-persist",
      event: "kv.session.cold",
      fields: [{ key: "sessionId", value: "a1b2c3" }],
    });
    expect(matchesFilter(record, filter({ query: "KV.SESSION" }))).toBe(true);
    expect(matchesFilter(record, filter({ query: "a1b2c3" }))).toBe(true);
    expect(matchesFilter(record, filter({ query: "nothing-like-this" }))).toBe(false);
  });

  it("keeps one source exactly, and every source by default", () => {
    const mine = view(1, { pluginId: "dsh-sleev" });
    const other = view(2, { pluginId: "dsh-tool-offload" });

    expect(matchesFilter(mine, filter({ source: "" }))).toBe(true);
    expect(matchesFilter(other, filter({ source: "" }))).toBe(true);
    expect(matchesFilter(mine, filter({ source: "dsh-sleev" }))).toBe(true);
    // A source is an identifier, not prose: a prefix does not select it.
    expect(matchesFilter(other, filter({ source: "dsh-sleev" }))).toBe(false);
    expect(matchesFilter(mine, filter({ source: "dsh-slee" }))).toBe(false);
  });

  it("combines the three filters", () => {
    const record = view(1, { level: "warn", pluginId: "dsh-sleev", event: "sleev.gap" });
    expect(matchesFilter(record, { levels: new Set(["warn"]), query: "gap", source: "dsh-sleev" })).toBe(true);
    expect(matchesFilter(record, { levels: new Set(["info"]), query: "gap", source: "dsh-sleev" })).toBe(false);
    expect(matchesFilter(record, { levels: new Set(["warn"]), query: "gap", source: "dsh-other" })).toBe(false);
  });

  it("returns the window untouched when no filter is set, and trims the query", () => {
    const records = [view(1), view(2)];
    expect(filterRecords(records, filter())).toBe(records);
    expect(filterRecords(records, filter({ query: "  " }))).toBe(records);
    expect(filterRecords(records, filter({ levels: new Set(["warn"]) }))).toEqual([]);
  });
});

describe("mergeSources", () => {
  it("lists the window's plugins, the registered ones, and the selection, sorted", () => {
    const records = [view(1, { pluginId: "dsh-sleev" }), view(2, { pluginId: "dsh-tool-offload" })];
    expect(mergeSources(records, ["dsh-cas-results"], "")).toEqual([
      "dsh-cas-results",
      "dsh-sleev",
      "dsh-tool-offload",
    ]);
  });

  it("keeps a selected source an option after its lines scroll away", () => {
    expect(mergeSources([], ["dsh-sleev"], "dsh-gone")).toEqual(["dsh-gone", "dsh-sleev"]);
    // The "every source" value is not a plugin id and never becomes an option.
    expect(mergeSources([], [], "")).toEqual([]);
  });
});

describe("appendRecords", () => {
  it("appends new sequences and ignores ones already in the window", () => {
    const window = [view(1), view(2)];
    expect(appendRecords(window, [view(2), view(3)]).map((item) => item.seq)).toEqual([1, 2, 3]);
    expect(appendRecords(window, [])).toBe(window);
    expect(appendRecords(window, [view(1)])).toBe(window);
  });

  it("drops the oldest once the window is full", () => {
    const window = [view(1), view(2)];
    expect(appendRecords(window, [view(3)], 2).map((item) => item.seq)).toEqual([2, 3]);
  });
});

describe("createLogTailReader", () => {
  it("passes a settled read through and turns a failure into text", async () => {
    const value = { records: [view(1)], cursor: 2, dropped: 0, buffered: 1, capacity: 10 };
    const reader = createLogTailReader({
      tail: (cursor, limit) => {
        expect([cursor, limit]).toEqual([0, 500]);
        return Promise.resolve({ ok: true as const, value });
      },
    });
    expect(await reader(0, 500)).toEqual({ ok: true, value });

    const failing = createLogTailReader({
      tail: () => Promise.resolve({ ok: false as const, error: { message: "stream unavailable" } as never }),
    });
    expect(await failing(0, 500)).toEqual({ ok: false, message: "stream unavailable" });
  });

  it("reports a thrown transport error instead of rejecting", async () => {
    const reader = createLogTailReader({
      tail: () => Promise.reject(new Error("socket closed")),
    });
    expect(await reader(0, 500)).toEqual({ ok: false, message: "socket closed" });
  });
});
