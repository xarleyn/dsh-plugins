import { sep } from "node:path";

import { describe, expect, test, vi } from "vitest";

import { isLexicallyUnder } from "../src/core.js";
import type { ScopeSession } from "../src/host-api.js";
import {
  SessionScopeRuntime,
  type ScopeAwareFileSystem,
  type ScopeFsDirEntry,
  type ScopeFsTarget,
} from "../src/scope-fs.js";
import { SESSION_SCOPE_ERROR } from "../src/session-scope.js";

const workspace = `${sep}workspace`;
const apps = `${workspace}${sep}apps`;
const projectA = `${apps}${sep}project-a`;
const projectB = `${apps}${sep}project-b`;

function target(path: string): ScopeFsTarget {
  return { targetKey: path, displayPath: path };
}

function focusedSession(root: string): ScopeSession {
  return {
    header: { cwd: workspace },
    events: [{
      type: "session-scope/set",
      data: { version: 1, mode: "focused", roots: [root], workspaceRoot: workspace },
    }],
    append: vi.fn(),
  };
}

function fullSession(): ScopeSession {
  return { header: { cwd: workspace }, events: [], append: vi.fn() };
}

function fakeFileSystem(): ScopeAwareFileSystem {
  const children = new Map<string, ScopeFsDirEntry[]>([
    [workspace, [
      { name: "apps", type: "directory", target: target(apps) },
      { name: "infrastructure", type: "directory", target: target(`${workspace}${sep}infrastructure`) },
    ]],
    [apps, [
      { name: "project-a", type: "directory", target: target(projectA) },
      { name: "project-b", type: "directory", target: target(projectB) },
    ]],
  ]);
  return {
    resolve: vi.fn(async (path: string) => target(path)),
    contains: (parent, child) => isLexicallyUnder(String(child.targetKey), String(parent.targetKey)),
    stat: vi.fn(async () => ({ type: "file" })),
    lstat: vi.fn(async () => ({ type: "file" })),
    readText: vi.fn(async (value) => `read:${value.displayPath}`),
    streamText: vi.fn(async (value) => (async function* () { yield `read:${value.displayPath}`; })()),
    readBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
    listDir: vi.fn(async (value) => children.get(value.displayPath) ?? []),
    writeText: vi.fn(async () => ({ operation: "update" })),
    editText: vi.fn(async () => ({ version: "next" })),
  };
}

describe("filesystem enforcement", () => {
  test("does not install runtime scope state or resolve roots in full mode", async () => {
    const runtime = new SessionScopeRuntime(workspace);
    const fs = fakeFileSystem();
    runtime.patchFileSystem(fs);

    await expect(runtime.run(fullSession(), async () => {
      expect(runtime.currentSession()).toBeUndefined();
      return fs.readText(target(`${projectA}${sep}visible.txt`));
    })).resolves.toContain("visible.txt");
    expect(fs.resolve).not.toHaveBeenCalled();
  });

  test("allows content reads and denies hidden siblings", async () => {
    const runtime = new SessionScopeRuntime();
    const fs = fakeFileSystem();
    runtime.patchFileSystem(fs, workspace);
    const session = focusedSession(projectA);

    await expect(runtime.run(session, () => fs.readText(target(`${projectA}${sep}visible.txt`)))).resolves.toContain("visible.txt");
    await expect(runtime.run(session, () => fs.readText(target(`${projectB}${sep}hidden.txt`)))).rejects.toMatchObject({
      code: SESSION_SCOPE_ERROR.DENIED,
    });
  });

  test("applies the same boundary to raw byte reads", async () => {
    const runtime = new SessionScopeRuntime();
    const fs = fakeFileSystem();
    runtime.patchFileSystem(fs, workspace);
    const session = focusedSession(projectA);

    await expect(runtime.run(session, () => fs.readBytes(target(`${projectA}${sep}visible.png`), undefined, 1024))).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await expect(runtime.run(session, () => fs.readBytes(target(`${projectB}${sep}hidden.png`), undefined, 1024))).rejects.toMatchObject({
      code: SESSION_SCOPE_ERROR.DENIED,
    });
  });

  test("allows navigation metadata but not navigation content", async () => {
    const runtime = new SessionScopeRuntime();
    const fs = fakeFileSystem();
    runtime.patchFileSystem(fs, workspace);
    const session = focusedSession(projectA);

    await expect(runtime.run(session, () => fs.stat(target(apps)))).resolves.toBeDefined();
    await expect(runtime.run(session, () => fs.readText(target(apps)))).rejects.toMatchObject({
      code: SESSION_SCOPE_ERROR.DENIED,
    });
  });

  test("leaves paths outside the session workspace to ordinary DSH policy", async () => {
    const runtime = new SessionScopeRuntime();
    const fs = fakeFileSystem();
    runtime.patchFileSystem(fs, workspace);
    const session = focusedSession(projectA);
    const external = `${sep}user-skills${sep}SKILL.md`;

    await expect(runtime.run(session, () => fs.readText(target(external)))).resolves.toContain("SKILL.md");
  });

  test("denies a workspace path whose filesystem identity escapes through a symlink", async () => {
    const runtime = new SessionScopeRuntime();
    const fs = fakeFileSystem();
    runtime.patchFileSystem(fs, workspace);
    const session = focusedSession(projectA);
    const escaped = {
      displayPath: `${projectA}${sep}linked-secret.txt`,
      targetKey: `${sep}external${sep}secret.txt`,
    };

    await expect(runtime.run(session, () => fs.readText(escaped))).rejects.toMatchObject({
      code: SESSION_SCOPE_ERROR.DENIED,
    });
  });

  test("filters each navigation listing before returning names", async () => {
    const runtime = new SessionScopeRuntime();
    const fs = fakeFileSystem();
    runtime.patchFileSystem(fs, workspace);
    const session = focusedSession(projectA);

    const rootEntries = await runtime.run(session, () => fs.listDir(target(workspace)));
    const appEntries = await runtime.run(session, () => fs.listDir(target(apps)));
    expect(rootEntries.map((entry) => entry.name)).toEqual(["apps"]);
    expect(appEntries.map((entry) => entry.name)).toEqual(["project-a"]);
  });

  test("scope denial wins independently of write permission arguments", async () => {
    const runtime = new SessionScopeRuntime();
    const fs = fakeFileSystem();
    runtime.patchFileSystem(fs, workspace);
    const session = focusedSession(projectA);

    await expect(runtime.run(session, () => fs.writeText(target(`${projectA}${sep}new.txt`), "ok", undefined, undefined, { mode: "danger-full-access" }))).resolves.toBeDefined();
    await expect(runtime.run(session, () => fs.writeText(target(`${projectB}${sep}new.txt`), "no", undefined, undefined, { mode: "danger-full-access" }))).rejects.toMatchObject({
      code: SESSION_SCOPE_ERROR.DENIED,
    });
  });

  test("keeps concurrent session scopes isolated", async () => {
    const runtime = new SessionScopeRuntime();
    const fs = fakeFileSystem();
    runtime.patchFileSystem(fs, workspace);
    const sessionA = focusedSession(projectA);
    const sessionB = focusedSession(projectB);

    const [a, b] = await Promise.all([
      runtime.run(sessionA, () => fs.readText(target(`${projectA}${sep}a.txt`))),
      runtime.run(sessionB, () => fs.readText(target(`${projectB}${sep}b.txt`))),
    ]);
    expect(a).toContain("a.txt");
    expect(b).toContain("b.txt");
  });
});
