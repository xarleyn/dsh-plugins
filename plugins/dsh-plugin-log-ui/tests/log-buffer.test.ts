import { describe, expect, it } from "vitest";
import type { PluginLogRecord } from "@yadsh/dsh-plugin-log";
import {
  LOG_FIELD_LIMIT,
  LOG_FIELD_VALUE_LIMIT,
  LOG_TAIL_MAX_LIMIT,
  PluginLogBuffer,
  clampCursor,
  clampLimit,
  renderFields,
  toRecordView,
} from "../src/log-buffer.js";

/** One bus record, with the sequence a reader resumes from. */
function record(
  seq: number,
  fields: Record<string, unknown> = {},
): PluginLogRecord {
  return Object.freeze({
    seq,
    time: 1_700_000_000_000 + seq,
    level: "info" as const,
    pluginId: "dsh-sample",
    module: undefined,
    event: `event.${seq}`,
    fields: Object.freeze(fields),
  });
}

describe("renderFields", () => {
  it("renders primitives, nested values and errors as text", () => {
    expect(
      renderFields({
        text: "plain",
        count: 3,
        ok: true,
        missing: null,
        nothing: undefined,
        nested: { attempt: 2, tags: ["a", "b"] },
        failure: new Error("boom"),
      }),
    ).toEqual([
      { key: "text", value: "plain" },
      { key: "count", value: "3" },
      { key: "ok", value: "true" },
      { key: "missing", value: "null" },
      { key: "nothing", value: "undefined" },
      { key: "nested", value: "{attempt: 2, tags: [a, b]}" },
      { key: "failure", value: "Error: boom" },
    ]);
  });

  it("elides values past the depth limit instead of recursing forever", () => {
    const deep = { a: { b: { c: { d: "gone" } } } };
    expect(renderFields({ deep })[0]?.value).toBe("{a: {b: {c: {…}}}}");

    // A cycle is the same case: bounded depth is what makes the render return.
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic["self"] = cyclic;
    expect(renderFields({ cyclic })[0]?.value).toBe(
      "{name: loop, self: {name: loop, self: {name: loop, self: {…}}}}",
    );
  });

  it("cuts a long value and summarizes surplus fields", () => {
    const long =
      renderFields({ text: "x".repeat(LOG_FIELD_VALUE_LIMIT + 50) })[0]
        ?.value ?? "";
    expect(long.length).toBe(LOG_FIELD_VALUE_LIMIT);
    expect(long.endsWith("…")).toBe(true);

    const many = Object.fromEntries(
      Array.from({ length: LOG_FIELD_LIMIT + 3 }, (_, index) => [
        `k${index}`,
        index,
      ]),
    );
    const fields = renderFields(many);
    expect(fields).toHaveLength(LOG_FIELD_LIMIT + 1);
    expect(fields.at(-1)).toEqual({ key: "…", value: "3 more field(s)" });
  });
});

describe("toRecordView", () => {
  it("turns an absent module into the empty scope segment", () => {
    expect(toRecordView(record(1)).module).toBe("");
    expect(toRecordView({ ...record(1), module: "worker" }).module).toBe(
      "worker",
    );
  });
});

describe("PluginLogBuffer", () => {
  it("serves everything after the cursor and advances it", () => {
    const buffer = new PluginLogBuffer();
    buffer.append(record(1));
    buffer.append(record(2));
    buffer.append(record(3));

    const read = buffer.read(0, 10);
    expect(read.records.map((item) => item.seq)).toEqual([1, 2, 3]);
    expect(read.cursor).toBe(4);
    expect(read.dropped).toBe(0);
    expect(read.buffered).toBe(3);
    expect(buffer.read(read.cursor, 10).records).toEqual([]);
  });

  it("leaves a cursor ahead of the stream alone until those records arrive", () => {
    const buffer = new PluginLogBuffer();
    expect(buffer.read(0, 10)).toMatchObject({
      records: [],
      cursor: 0,
      dropped: 0,
    });
    buffer.append(record(1));
    expect(buffer.read(0, 10).records.map((item) => item.seq)).toEqual([1]);
    // A reader that already saw sequence 1 asks for what follows it.
    expect(buffer.read(2, 10)).toMatchObject({ records: [], cursor: 2 });
    buffer.append(record(2));
    expect(buffer.read(2, 10).records.map((item) => item.seq)).toEqual([2]);
  });

  it("reports evictions a reader never saw instead of skipping them silently", () => {
    const buffer = new PluginLogBuffer(2);
    buffer.append(record(1));
    buffer.append(record(2));
    buffer.append(record(3));
    buffer.append(record(4));

    const read = buffer.read(0, 10);
    expect(read.records.map((item) => item.seq)).toEqual([3, 4]);
    expect(read.dropped).toBe(2);
    expect(read.capacity).toBe(2);
    // A reader that was already past the evicted records lost nothing.
    expect(buffer.read(3, 10).dropped).toBe(0);
  });

  it("drains a backlog over several reads under the per-read limit", () => {
    const buffer = new PluginLogBuffer(10);
    for (let seq = 1; seq <= 5; seq += 1) buffer.append(record(seq));

    const first = buffer.read(0, 2);
    expect(first.records.map((item) => item.seq)).toEqual([1, 2]);
    const second = buffer.read(first.cursor, 2);
    expect(second.records.map((item) => item.seq)).toEqual([3, 4]);
    const third = buffer.read(second.cursor, 2);
    expect(third.records.map((item) => item.seq)).toEqual([5]);
  });

  it("clamps hostile cursors and read sizes", () => {
    expect(clampCursor(Number.NaN)).toBe(0);
    expect(clampCursor(-5)).toBe(0);
    expect(clampCursor(2.7)).toBe(2);
    expect(clampLimit(Number.NaN)).toBe(LOG_TAIL_MAX_LIMIT);
    expect(clampLimit(0)).toBe(LOG_TAIL_MAX_LIMIT);
    expect(clampLimit(1e9)).toBe(LOG_TAIL_MAX_LIMIT);
    expect(clampLimit(7.9)).toBe(7);
  });
});
