import { describe, expect, it } from "vitest";

import {
  badgeText,
  filtersToText,
  isOverridden,
  overriddenKeys,
  parseNumberDraft,
  textToFilters,
} from "../src/client/format.js";

describe("badge text", () => {
  it("projects the master switch", () => {
    expect(badgeText(true)).toBe("Auto-inject");
    expect(badgeText(undefined)).toBe("Auto-inject");
  });

  it("says manual recall only when auto-inject is explicitly off", () => {
    expect(badgeText(false)).toBe("Manual recall");
  });
});

describe("override detection", () => {
  it("marks presence, not difference", () => {
    const user = { endpoint: "http://127.0.0.1:1933", syncTurns: true };
    expect(isOverridden(user, "endpoint")).toBe(true);
    // Same value as the composition default is still an override.
    expect(isOverridden(user, "syncTurns")).toBe(true);
    expect(isOverridden(user, "apiKey")).toBe(false);
  });

  it("tolerates a missing or non-object user layer", () => {
    expect(isOverridden(undefined, "endpoint")).toBe(false);
    expect(isOverridden("nope", "endpoint")).toBe(false);
    expect(isOverridden(["endpoint"], "endpoint")).toBe(false);
  });

  it("lists the user layer's keys sorted for the reset-all action", () => {
    expect(overriddenKeys({ syncTurns: true, apiKey: "k" })).toEqual([
      "apiKey",
      "syncTurns",
    ]);
    expect(overriddenKeys(undefined)).toEqual([]);
  });
});

describe("number draft parsing", () => {
  it("parses finite numbers and rejects the rest", () => {
    expect(parseNumberDraft("42")).toBe(42);
    expect(parseNumberDraft(" 0.35 ")).toBe(0.35);
    expect(parseNumberDraft("")).toBeNull();
    expect(parseNumberDraft("   ")).toBeNull();
    expect(parseNumberDraft("abc")).toBeNull();
  });
});

describe("capture filter round trip", () => {
  it("renders one filter per line", () => {
    expect(filtersToText(["s/a/b/", "d|noise|"])).toBe("s/a/b/\nd|noise|");
    expect(filtersToText(undefined)).toBe("");
    expect(filtersToText([])).toBe("");
  });

  it("parses the textarea back, dropping blank lines", () => {
    expect(textToFilters("s/a/b/\n\nd|noise|\n")).toEqual([
      "s/a/b/",
      "d|noise|",
    ]);
    expect(textToFilters("   \n")).toEqual([]);
  });

  it("survives a full round trip", () => {
    const filters = ["user:s/x/y/", "k|keep|"];
    expect(textToFilters(filtersToText(filters))).toEqual(filters);
  });
});
