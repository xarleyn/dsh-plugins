// Unit tests for the dependency-free helpers in src/core.ts.

import { test } from "vitest";
import assert from "node:assert/strict";
import {
  MODE,
  SELECTION_EVENT,
  normalizeSelectionRoots,
  selectedRootsOf,
  selectionOf,
} from "../src/core.js";

test("MODE and SELECTION_EVENT are the plugin vocabulary", () => {
  assert.equal(MODE, "selected-workspace-write");
  assert.equal(SELECTION_EVENT, "workspace-scope/selection");
});

test("selectionOf folds the whole scope (normalized roots + workspace marker) last-wins", () => {
  // The folded roots ARE the writable set: the workspace root is a member
  // exactly when the workspace is writable.
  const events = [
    {
      type: SELECTION_EVENT,
      data: { roots: ["/ws", "/a"], workspaceRoot: "/ws", workspace: true },
    },
    { type: "turn/start", data: {} },
    {
      type: SELECTION_EVENT,
      data: { roots: ["/ws", "/c"], workspaceRoot: "/ws", workspace: true },
    },
  ];
  assert.deepEqual(selectionOf(events), {
    roots: ["/ws", "/c"],
    workspace: true,
    workspaceRoot: "/ws",
  });
  // workspace:false removes the workspace root from the selection.
  assert.deepEqual(
    selectionOf([
      {
        type: SELECTION_EVENT,
        data: { roots: ["/ws", "/x"], workspaceRoot: "/ws", workspace: false },
      },
    ]),
    { roots: ["/x"], workspace: false, workspaceRoot: "/ws" },
  );
  // An event that omits the workspace root still yields it when writable.
  assert.deepEqual(
    selectionOf([
      {
        type: SELECTION_EVENT,
        data: { roots: ["/x"], workspaceRoot: "/ws", workspace: true },
      },
    ]),
    { roots: ["/ws", "/x"], workspace: true, workspaceRoot: "/ws" },
  );
  // Legacy events without the workspace field stay workspace-writable.
  assert.deepEqual(
    selectionOf([
      { type: SELECTION_EVENT, data: { roots: ["/y"], workspaceRoot: "/ws" } },
    ]),
    { roots: ["/ws", "/y"], workspace: true, workspaceRoot: "/ws" },
  );
  assert.deepEqual(selectionOf([{ type: "turn/end", data: {} }]), {
    roots: [],
    workspace: true,
    workspaceRoot: "",
  });
  assert.deepEqual(selectionOf([]), {
    roots: [],
    workspace: true,
    workspaceRoot: "",
  });
  assert.deepEqual(
    selectionOf([
      { type: SELECTION_EVENT, data: { roots: "nope", workspaceRoot: "/ws" } },
    ]),
    { roots: ["/ws"], workspace: true, workspaceRoot: "/ws" },
  );
});

test("normalizeSelectionRoots makes the workspace an ordinary member", () => {
  assert.deepEqual(normalizeSelectionRoots(["/ws", "/a"], "/ws", true), [
    "/ws",
    "/a",
  ]);
  assert.deepEqual(normalizeSelectionRoots(["/a"], "/ws", true), ["/ws", "/a"]);
  assert.deepEqual(normalizeSelectionRoots(["/ws", "/a"], "/ws", false), [
    "/a",
  ]);
  assert.deepEqual(normalizeSelectionRoots([], "/ws", true), ["/ws"]);
  assert.deepEqual(normalizeSelectionRoots([], "/ws", false), []);
  assert.deepEqual(normalizeSelectionRoots(["/a"], "", true), ["/a"]);
  assert.deepEqual(normalizeSelectionRoots("nope", "/ws", true), ["/ws"]);
});

test("selectedRootsOf folds last-wins over the log", () => {
  const events = [
    { type: "sandbox/mode", data: { mode: "workspace-write" } },
    {
      type: SELECTION_EVENT,
      data: { roots: ["/a", "/b"], workspaceRoot: "/ws" },
    },
    { type: "turn/start", data: {} },
    { type: SELECTION_EVENT, data: { roots: ["/c"], workspaceRoot: "/ws" } },
  ];
  assert.deepEqual(selectedRootsOf(events), ["/ws", "/c"]);
  assert.deepEqual(
    selectedRootsOf([
      { type: SELECTION_EVENT, data: { roots: ["/x"], workspaceRoot: "/ws" } },
    ]),
    ["/ws", "/x"],
  );
  assert.deepEqual(selectedRootsOf([{ type: "turn/end", data: {} }]), []);
  assert.deepEqual(selectedRootsOf([]), []);
  // A malformed payload degrades to no selection, never a crash.
  assert.deepEqual(
    selectedRootsOf([{ type: SELECTION_EVENT, data: { roots: "nope" } }]),
    [],
  );
});
