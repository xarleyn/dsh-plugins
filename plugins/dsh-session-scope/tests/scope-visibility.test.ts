import { sep } from "node:path";

import { describe, expect, test } from "vitest";

import {
  assertScopeAccess,
  classifyScopePath,
  filterScopeDirectoryListing,
  scopedSearchRoots,
} from "../src/scope-visibility.js";
import { SESSION_SCOPE_ERROR, type EffectiveSessionScope } from "../src/session-scope.js";

const workspace = `${sep}workspace`;
const apps = `${workspace}${sep}apps`;
const projectA = `${apps}${sep}project-a`;
const projectB = `${apps}${sep}project-b`;
const external = `${sep}external`;

const focused: EffectiveSessionScope = {
  mode: "focused",
  workspaceRoot: workspace,
  roots: [projectA],
  navigationRoots: [workspace, apps],
};

describe("path visibility", () => {
  test("distinguishes content, navigation, and denied paths", () => {
    expect(classifyScopePath(focused, `${projectA}${sep}visible.txt`)).toBe("content");
    expect(classifyScopePath(focused, workspace)).toBe("navigation");
    expect(classifyScopePath(focused, `${projectB}${sep}hidden.txt`)).toBe("denied");
    expect(classifyScopePath(focused, `${external}${sep}user-skill.md`)).toBe("content");
  });

  test("allows navigation only for listing", () => {
    expect(assertScopeAccess(focused, workspace, "list")).toBe("navigation");
    expect(() => assertScopeAccess(focused, workspace, "read")).toThrowError(
      expect.objectContaining({ code: SESSION_SCOPE_ERROR.DENIED }),
    );
    expect(() => assertScopeAccess(focused, projectB, "write")).toThrowError(
      expect.objectContaining({ code: SESSION_SCOPE_ERROR.DENIED }),
    );
  });

  test("full scope bypasses path filtering", () => {
    const full: EffectiveSessionScope = { ...focused, mode: "full", roots: [], navigationRoots: [] };
    expect(classifyScopePath(full, projectB)).toBe("content");
    expect(assertScopeAccess(full, projectB, "write")).toBe("content");
  });
});

describe("observation filtering", () => {
  test("hides sibling names while preserving the route to selected content", () => {
    const listing = {
      path: apps,
      home: workspace,
      crumbs: [
        { name: "workspace", path: workspace },
        { name: "apps", path: apps },
      ],
      entries: [
        { name: "project-a", path: projectA, hidden: false },
        { name: "project-b", path: projectB, hidden: false },
      ],
      truncated: false,
    };

    expect(filterScopeDirectoryListing(focused, listing).entries.map((entry) => entry.name)).toEqual([
      "project-a",
    ]);
  });

  test("keeps ordinary listings once inside a content root", () => {
    const listing = {
      path: projectA,
      home: workspace,
      crumbs: [],
      entries: [{ name: "src", path: `${projectA}${sep}src`, hidden: false }],
      truncated: false,
    };
    expect(filterScopeDirectoryListing(focused, listing)).toBe(listing);
  });

  test("splits workspace searches into selected content roots", () => {
    expect(scopedSearchRoots(focused, workspace)).toEqual([projectA]);
    expect(scopedSearchRoots(focused, `${projectA}${sep}src`)).toEqual([`${projectA}${sep}src`]);
    expect(() => scopedSearchRoots(focused, projectB)).toThrowError(
      expect.objectContaining({ code: SESSION_SCOPE_ERROR.DENIED }),
    );
    expect(scopedSearchRoots(focused, external)).toEqual([external]);
    expect(scopedSearchRoots(focused, sep)).toEqual([projectA]);
  });
});
