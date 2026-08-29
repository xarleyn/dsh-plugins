import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { canonicalPath } from "../src/core.js";
import {
  SESSION_SCOPE_ERROR,
  SessionScopeError,
  collapseNestedRoots,
  createSessionScopeEvent,
  effectiveSessionScope,
  navigationRootsFor,
  normalizeSessionScopeRoots,
} from "../src/session-scope.js";

const temporaryDirectories: string[] = [];

function temporaryWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), "dsh-session-scope-"));
  temporaryDirectories.push(workspace);
  return workspace;
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("scope path model", () => {
  test("collapses duplicates and nested roots", () => {
    const workspace = temporaryWorkspace();
    const app = join(workspace, "apps", "a");
    const nested = join(app, "packages", "core");
    mkdirSync(nested, { recursive: true });

    expect(collapseNestedRoots([nested, app, app])).toEqual([app]);
  });

  test("derives only navigation ancestors", () => {
    const workspace = temporaryWorkspace();
    const apps = join(workspace, "apps");
    const project = join(apps, "project-a");
    mkdirSync(project, { recursive: true });

    expect(navigationRootsFor(workspace, [project])).toEqual([workspace, apps]);
  });

  test("normalizes existing directories and rejects workspace escapes", () => {
    const workspace = temporaryWorkspace();
    const selected = join(workspace, "selected");
    const nested = join(selected, "nested");
    const outside = temporaryWorkspace();
    mkdirSync(nested, { recursive: true });

    expect(normalizeSessionScopeRoots([nested, selected, selected], workspace)).toEqual([canonicalPath(selected)]);
    expect(() => normalizeSessionScopeRoots([outside], workspace)).toThrowError(
      expect.objectContaining({ code: SESSION_SCOPE_ERROR.OUTSIDE_WORKSPACE }),
    );
    expect(() => normalizeSessionScopeRoots([join(workspace, "missing")], workspace)).toThrowError(
      expect.objectContaining({ code: SESSION_SCOPE_ERROR.INVALID_ROOT }),
    );
  });

  test("classifies a canonical escape separately from a lexical escape", () => {
    const workspace = temporaryWorkspace();
    const link = join(workspace, "linked-project");
    const outside = temporaryWorkspace();
    const paths = {
      isDirectory: () => true,
      canonical: (path: string) => path === link ? outside : path,
    };

    expect(() => normalizeSessionScopeRoots([link], workspace, { paths })).toThrowError(
      expect.objectContaining({ code: SESSION_SCOPE_ERROR.SYMLINK_ESCAPE }),
    );
  });
});

describe("durable scope state", () => {
  test("defaults to the full session workspace", () => {
    const workspace = temporaryWorkspace();
    expect(effectiveSessionScope([], { cwd: workspace })).toEqual({
      mode: "full",
      workspaceRoot: canonicalPath(workspace),
      roots: [],
      navigationRoots: [],
    });
  });

  test("folds the last complete snapshot and ignores roots in full mode", () => {
    const workspace = temporaryWorkspace();
    const first = join(workspace, "first");
    const second = join(workspace, "second");
    mkdirSync(first);
    mkdirSync(second);
    const events = [
      { type: "session-scope/set", data: createSessionScopeEvent("focused", [first], workspace, "ui") },
      { type: "turn/start", data: {} },
      { type: "session-scope/set", data: createSessionScopeEvent("full", [second], workspace, "command") },
    ];

    expect(effectiveSessionScope(events, { cwd: workspace })).toEqual({
      mode: "full",
      workspaceRoot: canonicalPath(workspace),
      roots: [],
      navigationRoots: [],
    });
  });

  test("fails closed for malformed and stale focused snapshots", () => {
    const workspace = temporaryWorkspace();
    const otherWorkspace = temporaryWorkspace();
    const selected = join(workspace, "selected");
    mkdirSync(selected);

    const malformed = effectiveSessionScope([
      { type: "session-scope/set", data: { version: 9, mode: "focused", roots: [selected], workspaceRoot: workspace } },
    ], { cwd: workspace });
    expect(malformed.mode).toBe("focused");
    expect(malformed.roots).toEqual([]);

    const stale = effectiveSessionScope([
      { type: "session-scope/set", data: { version: 1, mode: "focused", roots: [selected], workspaceRoot: otherWorkspace } },
    ], { cwd: workspace });
    expect(stale.roots).toEqual([]);
  });

  test("creates versioned snapshots with normalized roots", () => {
    const workspace = temporaryWorkspace();
    const selected = join(workspace, "selected");
    mkdirSync(selected);

    expect(createSessionScopeEvent("focused", [selected], workspace, "ui")).toEqual({
      version: 1,
      mode: "focused",
      roots: [canonicalPath(selected)],
      workspaceRoot: canonicalPath(workspace),
      source: "ui",
    });
  });

  test("treats filesystem aliases of the workspace as the same durable identity", () => {
    const container = temporaryWorkspace();
    const actualWorkspace = join(container, "actual");
    const aliasWorkspace = join(container, "alias");
    const selected = join(actualWorkspace, "selected");
    mkdirSync(selected, { recursive: true });
    symlinkSync(actualWorkspace, aliasWorkspace, "junction");

    const event = createSessionScopeEvent(
      "focused",
      [selected],
      aliasWorkspace,
      "ui",
    );
    expect(event).toMatchObject({
      workspaceRoot: canonicalPath(actualWorkspace),
      roots: [canonicalPath(selected)],
    });
    expect(effectiveSessionScope([{ type: "session-scope/set", data: event }], {
      cwd: aliasWorkspace,
    })).toMatchObject({
      workspaceRoot: canonicalPath(actualWorkspace),
      roots: [canonicalPath(selected)],
    });
  });

  test("exposes stable error instances", () => {
    const error = new SessionScopeError(SESSION_SCOPE_ERROR.DENIED, "Path is outside the active session scope.");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("SESSION_SCOPE_DENIED");
  });
});
