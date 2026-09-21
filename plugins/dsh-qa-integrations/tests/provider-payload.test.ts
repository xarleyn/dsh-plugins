/**
 * The readers every provider projection uses to index an upstream answer. They
 * are shared policy — including the emptiness rule below — so they are pinned
 * once here rather than re-derived from each provider's own tests.
 */
import { describe, expect, it } from "vitest";

import {
  arrayOf,
  booleanOf,
  compact,
  numberOf,
  recordOf,
  stringOf,
} from "../src/providers/shared/payload.js";

describe("recordOf", () => {
  it("passes an object through", () => {
    expect(recordOf({ id: 1 })).toEqual({ id: 1 });
  });

  it.each([
    ["an array", [1, 2]],
    ["null", null],
    ["a scalar", "text"],
    ["undefined", undefined],
  ])("turns %s into an empty record", (_label, value) => {
    expect(recordOf(value)).toEqual({});
  });
});

describe("stringOf", () => {
  it("reads a non-empty string field", () => {
    expect(stringOf({ name: "Мост" }, "name")).toBe("Мост");
  });

  it("treats an empty string as absent, so no caller has to guard for it", () => {
    expect(stringOf({ nextPageToken: "" }, "nextPageToken")).toBeUndefined();
  });

  it.each([
    ["a number", 7],
    ["a boolean", true],
    ["null", null],
    ["nothing at all", undefined],
  ])("reads %s as absent", (_label, value) => {
    expect(stringOf({ field: value }, "field")).toBeUndefined();
  });
});

describe("numberOf", () => {
  it("reads a finite number field", () => {
    expect(numberOf({ count: 3 }, "count")).toBe(3);
  });

  it.each([
    ["a numeric string", "3"],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["nothing at all", undefined],
  ])("reads %s as absent", (_label, value) => {
    expect(numberOf({ count: value }, "count")).toBeUndefined();
  });
});

describe("booleanOf", () => {
  it("reads a boolean field", () => {
    expect(booleanOf({ enabled: false }, "enabled")).toBe(false);
  });

  it.each([
    ["a string", "true"],
    ["a number", 1],
    ["nothing at all", undefined],
  ])("reads %s as absent", (_label, value) => {
    expect(booleanOf({ enabled: value }, "enabled")).toBeUndefined();
  });
});

describe("arrayOf", () => {
  it("reads an array field", () => {
    expect(arrayOf({ values: [1, 2] }, "values")).toEqual([1, 2]);
  });

  it.each([
    ["an object", { length: 2 }],
    ["a string", "ab"],
    ["nothing at all", undefined],
  ])("reads %s as no items", (_label, value) => {
    expect(arrayOf({ values: value }, "values")).toEqual([]);
  });
});

describe("compact", () => {
  it("drops unset keys and keeps the rest, including falsy values", () => {
    expect(compact({ a: 1, b: undefined, c: false, d: "", e: null })).toEqual({
      a: 1,
      c: false,
      d: "",
      e: null,
    });
  });
});
