import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/resolve-config.js";
import { schemaParse } from "./config.helpers.js";

describe("file write policy configuration", () => {
  it("defaults both config paths to blocking Python files", () => {
    for (const input of [{}, schemaParse({})]) {
      expect(
        resolveConfig(input).tools.fileWritePolicy.blockedExtensions,
      ).toEqual([".py", ".pyw"]);
    }
  });

  it("normalizes and deduplicates exact suffixes through the Host schema", () => {
    const config = resolveConfig(
      schemaParse({
        tools: {
          fileWritePolicy: {
            blockedExtensions: [" PY ", ".Py", "tar.gz", ".PS1"],
            message: " Use document tools. ",
          },
        },
      }),
    );
    expect(config.tools.fileWritePolicy).toEqual({
      blockedExtensions: [".py", ".tar.gz", ".ps1"],
      message: "Use document tools.",
    });
  });

  it("preserves an explicitly empty list and defaults a missing message", () => {
    const policy = resolveConfig(
      schemaParse({ tools: { fileWritePolicy: { blockedExtensions: [] } } }),
    ).tools.fileWritePolicy;
    expect(policy.blockedExtensions).toEqual([]);
    expect(policy.message).not.toBe("");
    expect(Object.isFrozen(policy.blockedExtensions)).toBe(true);
  });

  it.each(["", ".", "*.py", "folder/.py", "..py", ".py ".repeat(40)])(
    "refuses invalid extension %j",
    (extension) => {
      expect(() =>
        resolveConfig({
          tools: { fileWritePolicy: { blockedExtensions: [extension] } },
        }),
      ).toThrow(/blockedExtensions/u);
    },
  );

  it.each(["", "  ", "x".repeat(4001)])(
    "refuses an empty or oversized message",
    (message) => {
      expect(() =>
        resolveConfig({ tools: { fileWritePolicy: { message } } }),
      ).toThrow(/message/u);
    },
  );

  it("bounds the list and refuses non-string entries", () => {
    for (const blockedExtensions of [
      Array.from({ length: 101 }, () => ".py"),
      [42],
      ".py",
    ]) {
      expect(() =>
        resolveConfig({
          tools: { fileWritePolicy: { blockedExtensions } },
        } as never),
      ).toThrow(/blockedExtensions/u);
    }
  });

  it("rejects invalid settings at the Host schema before they can be persisted", () => {
    for (const fileWritePolicy of [
      { blockedExtensions: ["*.py"] },
      { blockedExtensions: Array.from({ length: 101 }, () => ".py") },
      { message: " " },
      { message: "x".repeat(4001) },
    ]) {
      expect(() => schemaParse({ tools: { fileWritePolicy } })).toThrow(
        /schema rejected/u,
      );
    }
  });
});
