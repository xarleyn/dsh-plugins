/**
 * Presentation helpers of the Safety Gate card: badge wording, counter and
 * latency formatting, and the user-layer override walk the card marks fields
 * with. These are pure functions so the card's wording is pinned without a DOM.
 */

import { describe, expect, it } from "vitest";

import {
  badgeText,
  describeEndpoint,
  describeMode,
  formatAverage,
  formatCount,
  formatMs,
  formatUptime,
  isOverridden,
  joinList,
  overriddenKeys,
  parseListDraft,
  parseNumberDraft,
  shortHash,
} from "../../src/client/format.js";

describe("card formatting", () => {
  it("labels every gate mode and falls back to the default profile", () => {
    expect(describeMode("off")).toEqual({ label: "Off", tone: "off" });
    expect(describeMode("audit").label).toBe("Audit");
    expect(describeMode("enforce").label).toBe("Enforce");
    expect(describeMode("warn").label).toBe("Warn");
    expect(describeMode(undefined).label).toBe("Warn");
  });

  it("reports a switched-off gate as disabled whatever the mode says", () => {
    expect(badgeText(true, "enforce")).toBe("Enforce");
    expect(badgeText(undefined, "warn")).toBe("Warn");
    expect(badgeText(false, "enforce")).toBe("Disabled");
  });

  it("formats counters, averages, and latencies", () => {
    expect(formatCount(12345)).toBe("12,345");
    expect(formatCount(undefined)).toBe("—");
    expect(formatAverage(300, 4)).toBe("75.0 ms");
    expect(formatAverage(300, 0)).toBe("—");
    expect(formatMs(81)).toBe("81 ms");
    expect(formatMs(2_500)).toBe("2.50 s");
    expect(formatMs(undefined)).toBe("—");
  });

  it("describes uptime in at most two units", () => {
    const start = 1_000_000;
    expect(formatUptime(start, start + 45_000)).toBe("45s");
    expect(formatUptime(start, start + 125_000)).toBe("2m 5s");
    expect(formatUptime(start, start + 7_260_000)).toBe("2h 1m");
    expect(formatUptime(undefined, start)).toBe("—");
  });

  it("shortens content hashes and empty lists", () => {
    expect(shortHash("a".repeat(64))).toBe(`${"a".repeat(12)}…`);
    expect(shortHash("abc")).toBe("abc");
    expect(shortHash(undefined)).toBe("—");
    expect(joinList([])).toBe("—");
    expect(joinList(["jailbreak", "secret_leak"])).toBe(
      "jailbreak, secret_leak",
    );
  });

  it("parses drafts without inventing values", () => {
    expect(parseNumberDraft(" 1536 ")).toBe(1_536);
    expect(parseNumberDraft("")).toBeNull();
    expect(parseNumberDraft("nope")).toBeNull();
    expect(parseListDraft("bash, write\nedit")).toEqual([
      "bash",
      "write",
      "edit",
    ]);
    expect(parseListDraft("  ")).toEqual([]);
  });

  it("walks the user layer to mark overridden fields", () => {
    const user = { mode: "enforce", output: { mode: "observe" } };
    expect(isOverridden(user, ["mode"])).toBe(true);
    expect(isOverridden(user, ["output", "mode"])).toBe(true);
    expect(isOverridden(user, ["output", "windowChars"])).toBe(false);
    expect(isOverridden(user, ["classifier"])).toBe(false);
    expect(isOverridden(undefined, ["mode"])).toBe(false);
    expect(overriddenKeys(user)).toEqual(["mode", "output"]);
    expect(overriddenKeys(undefined)).toEqual([]);
  });

  it("names the remote classifier endpoint for the privacy notice", () => {
    expect(
      describeEndpoint("openai-compatible", "https://moderator.example/v1"),
    ).toBe("https://moderator.example/v1");
    expect(describeEndpoint("none", "")).toBe("no classifier endpoint");
    expect(describeEndpoint("dsh", "")).toBe("the configured endpoint");
  });
});
