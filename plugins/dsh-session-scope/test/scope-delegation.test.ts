import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { canonicalPath } from "../src/core.js";
import {
  initializeDelegatedSessionScope,
  type DelegatedScopeSession,
} from "../src/scope-delegation.js";
import {
  SESSION_SCOPE_ERROR,
  createSessionScopeEvent,
  effectiveSessionScope,
} from "../src/session-scope.js";

const temporaryDirectories: string[] = [];

function temporaryWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), "dsh-session-scope-delegation-"));
  temporaryDirectories.push(workspace);
  return workspace;
}

function session(
  header: DelegatedScopeSession["header"],
  events: DelegatedScopeSession["events"] = [],
): DelegatedScopeSession {
  const target: DelegatedScopeSession = {
    header,
    events: [...events],
    append(type, data) {
      (target.events as Array<{ type: string; data: Record<string, unknown> }>).push({ type, data });
    },
  };
  return target;
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("delegated session scope", () => {
  test("fresh subagents persist the live parent scope", () => {
    const workspace = temporaryWorkspace();
    const selected = join(workspace, "selected");
    mkdirSync(selected);
    const parent = session({ id: "parent", cwd: workspace }, [{
      type: "session-scope/set",
      data: createSessionScopeEvent("focused", [selected], workspace, "ui"),
    }]);
    const child = session({
      id: "child",
      cwd: workspace,
      parentSession: "parent",
      origin: "subagent",
    });

    expect(initializeDelegatedSessionScope(child, () => parent)).toMatchObject({
      mode: "focused",
      roots: [canonicalPath(selected)],
      source: "delegation",
    });
    expect(effectiveSessionScope(child.events, child.header)).toMatchObject({
      mode: "focused",
      roots: [canonicalPath(selected)],
    });
  });

  test("forked subagents use the immutable seed scope instead of a later parent widening", () => {
    const workspace = temporaryWorkspace();
    const selected = join(workspace, "selected");
    mkdirSync(selected);
    const focused = {
      type: "session-scope/set",
      data: createSessionScopeEvent("focused", [selected], workspace, "ui"),
    };
    const parent = session({ id: "parent", cwd: workspace }, [{
      type: "session-scope/set",
      data: createSessionScopeEvent("full", [], workspace, "ui"),
    }]);
    const child = session({
      id: "child",
      cwd: workspace,
      parentSession: "parent",
      origin: "subagent",
      seedLength: 1,
    }, [focused]);

    expect(initializeDelegatedSessionScope(child, () => parent)).toMatchObject({
      mode: "focused",
      roots: [canonicalPath(selected)],
    });
    expect(child.events.at(-1)?.data).toMatchObject({ source: "delegation" });
  });

  test("resumed children keep their durable child-owned snapshot", () => {
    const workspace = temporaryWorkspace();
    const delegated = {
      type: "session-scope/set",
      data: createSessionScopeEvent("focused", [], workspace, "delegation"),
    };
    const child = session({
      id: "child",
      cwd: workspace,
      parentSession: "offline-parent",
      origin: "subagent",
      seedLength: 0,
    }, [delegated]);
    const resolveParent = vi.fn();

    expect(initializeDelegatedSessionScope(child, resolveParent)).toBeUndefined();
    expect(resolveParent).not.toHaveBeenCalled();
    expect(child.events).toHaveLength(1);
  });

  test("missing parent fails closed before a fresh child can run", () => {
    const workspace = temporaryWorkspace();
    const child = session({
      id: "child",
      cwd: workspace,
      parentSession: "missing",
      origin: "subagent",
    });

    expect(() => initializeDelegatedSessionScope(child, () => undefined)).toThrowError(
      expect.objectContaining({ code: SESSION_SCOPE_ERROR.PARENT_UNAVAILABLE }),
    );
    expect(child.events).toHaveLength(0);
  });

  test("nested subagents inherit the delegated scope transitively", () => {
    const workspace = temporaryWorkspace();
    const selected = join(workspace, "selected");
    mkdirSync(selected);
    const parent = session({
      id: "parent-child",
      cwd: workspace,
      parentSession: "root",
      origin: "subagent",
    }, [{
      type: "session-scope/set",
      data: createSessionScopeEvent("focused", [selected], workspace, "delegation"),
    }]);
    const child = session({
      id: "nested",
      cwd: workspace,
      parentSession: "parent-child",
      origin: "subagent",
    });

    initializeDelegatedSessionScope(child, () => parent);
    expect(effectiveSessionScope(child.events, child.header).roots).toEqual([canonicalPath(selected)]);
  });

  test("ordinary session forks retain scope through their copied event prefix", () => {
    const workspace = temporaryWorkspace();
    const selected = join(workspace, "selected");
    mkdirSync(selected);
    const fork = session({
      id: "fork",
      cwd: workspace,
      parentSession: "parent",
      seedLength: 1,
    }, [{
      type: "session-scope/set",
      data: createSessionScopeEvent("focused", [selected], workspace, "ui"),
    }]);

    expect(initializeDelegatedSessionScope(fork, () => undefined)).toBeUndefined();
    expect(effectiveSessionScope(fork.events, fork.header).roots).toEqual([canonicalPath(selected)]);
  });
});
