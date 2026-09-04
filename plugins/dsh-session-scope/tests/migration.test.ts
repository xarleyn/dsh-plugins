import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import { canonicalPath } from "../src/core.js";
import { effectiveSessionScope } from "../src/session-scope.js";

const temporaryDirectories: string[] = [];

function temporaryWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), "dsh-session-scope-migration-"));
  temporaryDirectories.push(workspace);
  return workspace;
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

test("derives focused scope from the last legacy selection", () => {
  const workspace = temporaryWorkspace();
  const first = join(workspace, "first");
  const second = join(workspace, "second");
  mkdirSync(first);
  mkdirSync(second);
  const events = [
    { type: "workspace-scope/selection", data: { roots: [first], workspaceRoot: workspace, workspace: false } },
    { type: "workspace-scope/selection", data: { roots: [second], workspaceRoot: workspace, workspace: false } },
  ];

  expect(effectiveSessionScope(events, { cwd: workspace })).toMatchObject({
    mode: "focused",
    workspaceRoot: canonicalPath(workspace),
    roots: [canonicalPath(second)],
  });
});

test("a new snapshot is authoritative over later legacy events", () => {
  const workspace = temporaryWorkspace();
  const selected = join(workspace, "selected");
  mkdirSync(selected);
  const events = [
    { type: "session-scope/set", data: { version: 1, mode: "focused", roots: [selected], workspaceRoot: workspace } },
    { type: "workspace-scope/selection", data: { roots: [workspace], workspaceRoot: workspace } },
  ];

  expect(effectiveSessionScope(events, { cwd: workspace })).toMatchObject({
    mode: "focused",
    roots: [canonicalPath(selected)],
  });
});
