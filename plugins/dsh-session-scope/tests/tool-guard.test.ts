import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

import { describe, expect, test, vi } from "vitest";

import type { ScopeSession } from "../src/host-api.js";
import { createSessionScopeEvent } from "../src/session-scope.js";
import {
  ScopeToolAdapterRegistry,
  dispatchScopedSearchExecution,
  guardScopeToolExecution,
} from "../src/tool-guard.js";

const workspace = resolve(sep, "workspace");
const projectA = `${workspace}${sep}project-a`;
const projectB = `${workspace}${sep}project-b`;

function session(mode: "full" | "focused" | "isolated" = "focused"): ScopeSession {
  return {
    header: { cwd: workspace },
    events: [{
      type: "session-scope/set",
      data: { version: 1, mode, roots: mode === "full" ? [] : [projectA], workspaceRoot: workspace },
    }],
    append: vi.fn(),
  };
}

describe("monotonic path-aware tool guard", () => {
  const adapters = new ScopeToolAdapterRegistry();

  test("guards built-in read/write/edit arguments", () => {
    expect(guardScopeToolExecution({ name: "read", arguments: { file_path: `${projectA}${sep}ok.ts` }, agent: { session: session() } }, adapters)).toBeUndefined();
    expect(guardScopeToolExecution({ name: "write", arguments: { file_path: `${projectB}${sep}no.ts` }, agent: { session: session() } }, adapters)).toMatch(/^SESSION_SCOPE_DENIED:/);
    expect(guardScopeToolExecution({ name: "edit", arguments: { file_path: `${projectB}${sep}no.ts` }, agent: { session: session() } }, adapters)).toMatch(/^SESSION_SCOPE_DENIED:/);
    expect(guardScopeToolExecution({ name: "read_image", arguments: { file_path: `${projectB}${sep}hidden.png` }, agent: { session: session() } }, adapters)).toMatch(/^SESSION_SCOPE_DENIED:/);
    expect(guardScopeToolExecution({ name: "str_replace_editor", arguments: { path: `${projectB}${sep}no.ts`, command: "view" }, agent: { session: session() } }, adapters)).toMatch(/^SESSION_SCOPE_DENIED:/);
  });

  test("resolves relative paths against the immutable session cwd", () => {
    expect(guardScopeToolExecution({ name: "read", arguments: { file_path: `project-a${sep}ok.ts` }, agent: { session: session() } }, adapters)).toBeUndefined();
    expect(guardScopeToolExecution({ name: "read", arguments: { file_path: `project-b${sep}no.ts` }, agent: { session: session() } }, adapters)).toMatch(/^SESSION_SCOPE_DENIED:/);
  });

  test("does not turn session scope into a host-filesystem sandbox", () => {
    const external = `${sep}user-skills${sep}SKILL.md`;
    expect(guardScopeToolExecution(
      { name: "read", arguments: { file_path: external }, agent: { session: session() } },
      adapters,
    )).toBeUndefined();
  });

  test("normalizes workspace aliases and rejects symlink escapes before execution", () => {
    const container = mkdtempSync(join(tmpdir(), "dsh-session-scope-guard-alias-"));
    const actual = join(container, "actual");
    const alias = join(container, "alias");
    const selected = join(actual, "selected");
    const hidden = join(actual, "hidden");
    const external = join(container, "external");
    try {
      mkdirSync(selected, { recursive: true });
      mkdirSync(hidden);
      mkdirSync(external);
      writeFileSync(join(selected, "visible.txt"), "visible");
      writeFileSync(join(hidden, "hidden.txt"), "hidden");
      writeFileSync(join(external, "secret.txt"), "secret");
      symlinkSync(actual, alias, "junction");
      symlinkSync(external, join(selected, "escape"), "junction");
      const aliasedSession: ScopeSession = {
        header: { cwd: alias },
        events: [{
          type: "session-scope/set",
          data: createSessionScopeEvent("focused", [selected], alias, "ui"),
        }],
        append: vi.fn(),
      };
      const guard = (filePath: string) => guardScopeToolExecution(
        { name: "read", arguments: { file_path: filePath }, agent: { session: aliasedSession } },
        adapters,
      );

      expect(guard(join(alias, "selected", "visible.txt"))).toBeUndefined();
      expect(guard(join(alias, "hidden", "hidden.txt"))).toMatch(/^SESSION_SCOPE_DENIED:/);
      expect(guard(join(alias, "selected", "escape", "secret.txt"))).toMatch(/^SESSION_SCOPE_DENIED:/);
      expect(guardScopeToolExecution(
        { name: "write", arguments: { file_path: join(alias, "selected", "new.txt") }, agent: { session: aliasedSession } },
        adapters,
      )).toBeUndefined();
    } finally {
      rmSync(container, { recursive: true, force: true });
    }
  });

  test("denies broad searches that cannot be safely rewritten", () => {
    expect(guardScopeToolExecution({ name: "grep", arguments: { path: workspace, pattern: "secret" }, agent: { session: session() } }, adapters)).toMatch(/^SESSION_SCOPE_DENIED:/);
    expect(guardScopeToolExecution({ name: "grep", arguments: { pattern: "secret" }, agent: { session: session() } }, adapters)).toMatch(/^SESSION_SCOPE_DENIED:/);
    expect(guardScopeToolExecution({ name: "glob", arguments: { path: projectA, pattern: "**/*" }, agent: { session: session() } }, adapters)).toBeUndefined();
  });

  test("allows broad searches only when the scoped dispatcher is installed", () => {
    expect(guardScopeToolExecution(
      { name: "grep", arguments: { pattern: "secret" }, agent: { session: session() } },
      adapters,
      "",
      { splitBroadSearches: true },
    )).toBeUndefined();
  });

  test("full scope and tools without adapters remain untouched", () => {
    expect(guardScopeToolExecution({ name: "read", arguments: { file_path: projectB }, agent: { session: session("full") } }, adapters)).toBeUndefined();
    expect(guardScopeToolExecution({ name: "custom", arguments: { path: projectB }, agent: { session: session() } }, adapters)).toBeUndefined();
  });

  test("fails whole-workspace LSP indexing closed under a selected scope", () => {
    expect(guardScopeToolExecution(
      { name: "lsp", arguments: { operation: "hover", file_path: `${projectA}${sep}a.ts` }, agent: { session: session() } },
      adapters,
    )).toMatch(/^SESSION_SCOPE_DENIED:/);
    expect(guardScopeToolExecution(
      { name: "lsp", arguments: { operation: "hover", file_path: `${projectB}${sep}b.ts` }, agent: { session: session("full") } },
      adapters,
    )).toBeUndefined();
  });

  test("supports extension adapters without changing the guard", () => {
    const custom = new ScopeToolAdapterRegistry([]);
    custom.register({
      name: "custom",
      extractPaths: (args) => [{ path: (args as { repository: string }).repository, operation: "read" }],
    });
    expect(guardScopeToolExecution({ name: "custom", arguments: { repository: projectB }, agent: { session: session() } }, custom)).toMatch(/^SESSION_SCOPE_DENIED:/);
  });

  test("fails isolated shell and terminal execution closed without a ready backend", () => {
    expect(guardScopeToolExecution(
      { name: "bash", arguments: { command: "pwd" }, agent: { session: session("isolated") } },
      adapters,
    )).toMatch(/^SESSION_SCOPE_ISOLATION_UNAVAILABLE:/);
    expect(guardScopeToolExecution(
      { name: "terminal_open", arguments: { type: "shell" }, agent: { session: session("isolated") } },
      adapters,
    )).toMatch(/^SESSION_SCOPE_ISOLATION_UNAVAILABLE:/);
  });

  test("allows supported isolated processes only with safe cwd and confined permission", () => {
    const options = { isolatedBackendReady: true, sandboxMode: "workspace-write" };
    expect(guardScopeToolExecution(
      { name: "bash", arguments: { command: "pwd", workdir: projectA }, agent: { session: session("isolated") } },
      adapters,
      "",
      options,
    )).toBeUndefined();
    expect(guardScopeToolExecution(
      { name: "terminal_open", arguments: { type: "shell", cwd: workspace }, agent: { session: session("isolated") } },
      adapters,
      "",
      options,
    )).toBeUndefined();
    expect(guardScopeToolExecution(
      { name: "bash", arguments: { command: "pwd", workdir: projectB }, agent: { session: session("isolated") } },
      adapters,
      "",
      options,
    )).toMatch(/^SESSION_SCOPE_DENIED:/);
  });

  test("rejects danger-full-access without silently weakening isolated scope", () => {
    expect(guardScopeToolExecution(
      { name: "bash", arguments: { command: "pwd" }, agent: { session: session("isolated") } },
      adapters,
      "",
      { isolatedBackendReady: true, sandboxMode: "danger-full-access" },
    )).toContain("danger-full-access");
    expect(guardScopeToolExecution(
      {
        name: "bash",
        arguments: { command: "pwd", sandbox_permissions: "danger-full-access" },
        agent: { session: session("isolated") },
      },
      adapters,
      "",
      { isolatedBackendReady: true, sandboxMode: "read-only" },
    )).toContain("danger-full-access");
  });
});

describe("scoped search dispatcher", () => {
  function multiRootSession(): ScopeSession {
    return {
      header: { cwd: workspace },
      events: [{
        type: "session-scope/set",
        data: { version: 1, mode: "focused", roots: [projectA, projectB], workspaceRoot: workspace },
      }],
      append: vi.fn(),
    };
  }

  test("splits an omitted-path glob and merges canonical path values", async () => {
    const execute = vi.fn(async (execution) => ({
      isError: false,
      value: { root: execution.arguments.path, paths: [`${execution.arguments.path}${sep}file.ts`] },
      content: [],
    }));
    const next = vi.fn();

    await expect(dispatchScopedSearchExecution({
      callId: "call",
      name: "glob",
      arguments: { pattern: "**/*.ts" },
      agent: { session: multiRootSession() },
      signal: new AbortController().signal,
    }, { execute }, next)).resolves.toMatchObject({
      isError: false,
      value: {
        root: ".",
        paths: [`${projectA}${sep}file.ts`, `${projectB}${sep}file.ts`],
      },
    });
    expect(execute.mock.calls.map(([execution]) => execution.arguments.path)).toEqual([projectA, projectB]);
    expect(next).not.toHaveBeenCalled();
  });

  test("splits broad grep and preserves matches from every visible root", async () => {
    const execute = vi.fn(async (execution) => ({
      isError: false,
      value: { matches: [{ path: `${execution.arguments.path}${sep}file.ts`, lineNumber: 1, line: "hit" }] },
      content: [],
    }));

    const result = await dispatchScopedSearchExecution({
      callId: "call",
      name: "grep",
      arguments: { path: workspace, pattern: "hit" },
      agent: { session: multiRootSession() },
      signal: new AbortController().signal,
    }, { execute }, vi.fn());

    expect((result.value as { matches: unknown[] }).matches).toHaveLength(2);
  });

  test("drops any path and line content that a changed backend returns outside scope", async () => {
    const execute = vi.fn(async () => ({
      isError: false,
      value: {
        matches: [
          { path: `${projectA}${sep}visible.ts`, lineNumber: 1, line: "visible" },
          { path: `${workspace}${sep}hidden${sep}secret.ts`, lineNumber: 1, line: "secret" },
        ],
      },
      content: [],
    }));

    const result = await dispatchScopedSearchExecution({
      name: "grep",
      arguments: { path: workspace, pattern: "hit" },
      agent: { session: session() },
    }, { execute }, vi.fn());

    expect((result.value as { matches: Array<{ line: string }> }).matches).toEqual([
      { path: `${projectA}${sep}visible.ts`, lineNumber: 1, line: "visible" },
    ]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  test("passes direct in-scope search through without nested dispatch", async () => {
    const expected = { isError: false, value: { matches: [] }, content: [] };
    const next = vi.fn(async () => expected);
    const execute = vi.fn();

    await expect(dispatchScopedSearchExecution({
      name: "grep",
      arguments: { path: projectA, pattern: "hit" },
      agent: { session: session() },
    }, { execute }, next)).resolves.toBe(expected);
    expect(next).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
  });

  test("propagates a child search failure without searching later roots", async () => {
    const failure = { isError: true, error: { message: "failed" }, content: [] };
    const execute = vi.fn(async () => failure);

    await expect(dispatchScopedSearchExecution({
      name: "glob",
      arguments: { path: workspace, pattern: "**/*" },
      agent: { session: multiRootSession() },
    }, { execute }, vi.fn())).resolves.toBe(failure);
    expect(execute).toHaveBeenCalledOnce();
  });
});
