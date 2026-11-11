import { describe, expect, it } from "vitest";
import { resolveCodeSources, selectCodeSource } from "../src/code-sources.js";

const entries = [
  {
    id: "stable",
    label: "Release",
    path: "/code/arbitrary-one",
    docsVersion: "2.0",
  },
  {
    id: "preview",
    label: "Development",
    path: "/code/another-name",
    docsVersion: "2.0",
  },
];

describe("named code sources", () => {
  it("keeps release and development distinct even with the same docs edition", () => {
    const catalog = resolveCodeSources({ defaultSource: "stable", entries });
    expect(selectCodeSource(catalog)?.path).toBe("/code/arbitrary-one");
    expect(selectCodeSource(catalog, "preview")?.path).toBe(
      "/code/another-name",
    );
    expect(Object.isFrozen(catalog.entries[0])).toBe(true);
  });
  it("never picks the first of several unnamed alternatives", () => {
    expect(() => selectCodeSource(resolveCodeSources({ entries }))).toThrow(
      /Several/u,
    );
    expect(() =>
      selectCodeSource(resolveCodeSources({ entries }), "missing"),
    ).toThrow(/Unknown/u);
  });
  it("supports an empty legacy deployment and a single source", () => {
    expect(selectCodeSource(resolveCodeSources())).toBeUndefined();
    expect(
      selectCodeSource(resolveCodeSources({ entries: entries.slice(0, 1) }))
        ?.id,
    ).toBe("stable");
  });
  it.each([
    { entries, defaultSource: "missing" },
    { entries: [entries[0], entries[0]] },
    { entries: [{ id: "relative", label: "Relative", path: "code/tree" }] },
    { entries: [{ id: "control\n", label: "Text", path: "/code/tree" }] },
    { entries: [{ id: "empty", label: "", path: "/code/tree" }] },
  ])("rejects invalid operator configuration %#", (raw) => {
    expect(() =>
      resolveCodeSources(raw as Parameters<typeof resolveCodeSources>[0]),
    ).toThrow();
  });
  it("accepts absolute Windows paths independently of the current OS", () => {
    expect(
      resolveCodeSources({
        entries: [{ id: "win", label: "Windows", path: "E:\\sources\\tree" }],
      }).entries,
    ).toHaveLength(1);
  });
});
