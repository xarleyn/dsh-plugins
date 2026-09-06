import { sep } from "node:path";

import { describe, expect, test } from "vitest";

import { renderSessionScopeContext } from "../src/scope-context.js";

const workspace = `${sep}workspace`;
const visible = `${workspace}${sep}visible`;

describe("model-facing scope context", () => {
  test("names only accessible focused roots", () => {
    const text = renderSessionScopeContext({
      mode: "focused",
      workspaceRoot: workspace,
      roots: [visible],
      navigationRoots: [workspace],
    });
    expect(text).toContain(visible);
    expect(text).not.toContain("hidden");
    expect(text).toContain("shell isolation is not guaranteed");
  });

  test("renders fail-closed empty scope without inventing paths", () => {
    const text = renderSessionScopeContext({
      mode: "focused",
      workspaceRoot: workspace,
      roots: [],
      navigationRoots: [],
    });
    expect(text).toContain("none");
    expect(text).toContain("fail-closed");
  });

  test("does not inject scope prompt text in full mode", () => {
    const text = renderSessionScopeContext({
      mode: "full",
      workspaceRoot: workspace,
      roots: [],
      navigationRoots: [],
    });
    expect(text).toBe("");
  });
});
