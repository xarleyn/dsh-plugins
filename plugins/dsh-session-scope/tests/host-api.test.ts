import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { canonicalPath } from "../src/core.js";
import {
  detectScopeCapabilities,
  getScope,
  getScopeCapabilities,
  listScopeDirectory,
  setScope,
  type ScopeSession,
} from "../src/host-api.js";
import { SESSION_SCOPE_ERROR } from "../src/session-scope.js";

const temporaryDirectories: string[] = [];

function temporaryWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), "dsh-session-scope-host-"));
  temporaryDirectories.push(workspace);
  return workspace;
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("host scope state", () => {
  test("appends a complete durable snapshot", () => {
    const workspace = temporaryWorkspace();
    const selected = join(workspace, "selected");
    mkdirSync(selected);
    const append = vi.fn();
    const session: ScopeSession = { header: { cwd: workspace }, events: [], append };

    const event = setScope(session, { mode: "focused", roots: [selected], source: "ui" });

    expect(event).toMatchObject({
      version: 1,
      mode: "focused",
      roots: [canonicalPath(selected)],
      workspaceRoot: canonicalPath(workspace),
    });
    expect(append).toHaveBeenCalledWith("session-scope/set", event);
  });

  test("reads the effective state without shared mutable globals", () => {
    const workspace = temporaryWorkspace();
    const selected = join(workspace, "selected");
    mkdirSync(selected);
    const session: ScopeSession = {
      header: { cwd: workspace },
      events: [{
        type: "session-scope/set",
        data: { version: 1, mode: "focused", roots: [selected], workspaceRoot: workspace },
      }],
      append: vi.fn(),
    };

    expect(getScope(session)).toMatchObject({ mode: "focused", roots: [canonicalPath(selected)] });
  });

  test("does not append a durable snapshot when the effective scope is unchanged", () => {
    const workspace = temporaryWorkspace();
    const selected = join(workspace, "selected");
    mkdirSync(selected);
    const append = vi.fn();
    const event = {
      version: 1 as const,
      mode: "focused" as const,
      roots: [canonicalPath(selected)],
      workspaceRoot: canonicalPath(workspace),
      source: "ui" as const,
    };
    const session: ScopeSession = {
      header: { cwd: workspace },
      events: [{ type: "session-scope/set", data: event }],
      append,
    };

    expect(setScope(session, { mode: "focused", roots: [selected], source: "ui" })).toEqual(event);
    expect(append).not.toHaveBeenCalled();
  });

  test("does not materialize the implicit full default as an event", () => {
    const workspace = temporaryWorkspace();
    const append = vi.fn();
    const session: ScopeSession = { header: { cwd: workspace }, events: [], append };

    expect(setScope(session, { mode: "full", source: "ui" })).toMatchObject({ mode: "full", roots: [] });
    expect(append).not.toHaveBeenCalled();
  });
});

describe("host directory API", () => {
  test("lists workspace directories and refuses external paths", async () => {
    const workspace = temporaryWorkspace();
    const visible = join(workspace, "visible");
    const outside = temporaryWorkspace();
    mkdirSync(visible);
    const session: ScopeSession = { header: { cwd: workspace }, events: [], append: vi.fn() };

    await expect(listScopeDirectory(session, workspace)).resolves.toMatchObject({
      entries: [expect.objectContaining({ name: "visible", path: canonicalPath(visible) })],
    });
    await expect(listScopeDirectory(session, outside)).rejects.toMatchObject({
      code: SESSION_SCOPE_ERROR.OUTSIDE_WORKSPACE,
    });
  });

  test("reports isolated support only for an available Linux backend", () => {
    expect(getScopeCapabilities("linux", true)).toEqual({
      focused: true,
      isolated: true,
      isolatedBackend: "bwrap",
    });
    expect(getScopeCapabilities("win32", true)).toEqual({
      focused: true,
      isolated: false,
      isolatedBackend: null,
    });
  });

  test("keeps standalone detection fail-closed without provider evidence", () => {
    expect(detectScopeCapabilities("linux")).toEqual({
      focused: true,
      isolated: false,
      isolatedBackend: null,
    });
  });
});
