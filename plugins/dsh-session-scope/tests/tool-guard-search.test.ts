import { sep } from "node:path";

import { describe, expect, test, vi } from "vitest";

import type { ScopeSession } from "../src/host-api.js";
import { dispatchScopedSearchExecution } from "../src/tool-guard.js";
import {
  projectA,
  projectB,
  session,
  workspace,
} from "./tool-guard.helpers.js";

describe("scoped search dispatcher", () => {
  function multiRootSession(): ScopeSession {
    return {
      header: { cwd: workspace },
      snapshotEvents: () => [
        {
          type: "session-scope/set",
          data: {
            version: 1,
            mode: "focused",
            roots: [projectA, projectB],
            workspaceRoot: workspace,
          },
        },
      ],
      append: vi.fn(),
    };
  }

  test("splits an omitted-path glob and merges canonical path values", async () => {
    const execute = vi.fn(async (execution) => ({
      isError: false,
      value: {
        root: execution.arguments.path,
        paths: [`${execution.arguments.path}${sep}file.ts`],
      },
      content: [],
    }));
    const next = vi.fn();

    await expect(
      dispatchScopedSearchExecution(
        {
          callId: "call",
          name: "glob",
          arguments: { pattern: "**/*.ts" },
          agent: { session: multiRootSession() },
          signal: new AbortController().signal,
        },
        { execute },
        next,
      ),
    ).resolves.toMatchObject({
      isError: false,
      value: {
        root: ".",
        paths: [`${projectA}${sep}file.ts`, `${projectB}${sep}file.ts`],
      },
    });
    expect(
      execute.mock.calls.map(([execution]) => execution.arguments.path),
    ).toEqual([projectA, projectB]);
    expect(next).not.toHaveBeenCalled();
  });

  test("splits broad grep and preserves matches from every visible root", async () => {
    const execute = vi.fn(async (execution) => ({
      isError: false,
      value: {
        matches: [
          {
            path: `${execution.arguments.path}${sep}file.ts`,
            lineNumber: 1,
            line: "hit",
          },
        ],
      },
      content: [],
    }));

    const result = await dispatchScopedSearchExecution(
      {
        callId: "call",
        name: "grep",
        arguments: { path: workspace, pattern: "hit" },
        agent: { session: multiRootSession() },
        signal: new AbortController().signal,
      },
      { execute },
      vi.fn(),
    );

    expect((result.value as { matches: unknown[] }).matches).toHaveLength(2);
  });

  test("drops any path and line content that a changed backend returns outside scope", async () => {
    const execute = vi.fn(async () => ({
      isError: false,
      value: {
        matches: [
          {
            path: `${projectA}${sep}visible.ts`,
            lineNumber: 1,
            line: "visible",
          },
          {
            path: `${workspace}${sep}hidden${sep}secret.ts`,
            lineNumber: 1,
            line: "secret",
          },
        ],
      },
      content: [],
    }));

    const result = await dispatchScopedSearchExecution(
      {
        name: "grep",
        arguments: { path: workspace, pattern: "hit" },
        agent: { session: session() },
      },
      { execute },
      vi.fn(),
    );

    expect(
      (result.value as { matches: Array<{ line: string }> }).matches,
    ).toEqual([
      { path: `${projectA}${sep}visible.ts`, lineNumber: 1, line: "visible" },
    ]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  test("passes direct in-scope search through without nested dispatch", async () => {
    const expected = { isError: false, value: { matches: [] }, content: [] };
    const next = vi.fn(async () => expected);
    const execute = vi.fn();

    await expect(
      dispatchScopedSearchExecution(
        {
          name: "grep",
          arguments: { path: projectA, pattern: "hit" },
          agent: { session: session() },
        },
        { execute },
        next,
      ),
    ).resolves.toBe(expected);
    expect(next).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
  });

  test("propagates a child search failure without searching later roots", async () => {
    const failure = {
      isError: true,
      error: { message: "failed" },
      content: [],
    };
    const execute = vi.fn(async () => failure);

    await expect(
      dispatchScopedSearchExecution(
        {
          name: "glob",
          arguments: { path: workspace, pattern: "**/*" },
          agent: { session: multiRootSession() },
        },
        { execute },
        vi.fn(),
      ),
    ).resolves.toBe(failure);
    expect(execute).toHaveBeenCalledOnce();
  });
});
