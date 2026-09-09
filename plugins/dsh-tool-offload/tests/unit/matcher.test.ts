/**
 * Unit tests for tool-name pattern matching (SPEC §10.2, §32.1).
 */

import { describe, expect, it } from "vitest";

import { matchesAnyTool, matchesToolPattern } from "../../src/routing/matcher.js";

describe("matchesToolPattern", () => {
  it("matches exact names case-sensitively", () => {
    expect(matchesToolPattern("read", "read")).toBe(true);
    expect(matchesToolPattern("read", "Read")).toBe(false);
    expect(matchesToolPattern("read", "read_file")).toBe(false);
  });

  it("supports prefix globs", () => {
    expect(matchesToolPattern("mcp__*", "mcp__github_search")).toBe(true);
    expect(matchesToolPattern("mcp__*", "web_fetch")).toBe(false);
    expect(matchesToolPattern("*", "anything")).toBe(true);
  });
});

describe("matchesAnyTool", () => {
  it("matches when any pattern hits", () => {
    expect(matchesAnyTool(["write", "grep", "web_*"], "web_fetch")).toBe(true);
    expect(matchesAnyTool(["write", "grep"], "bash")).toBe(false);
    expect(matchesAnyTool([], "bash")).toBe(false);
  });
});
