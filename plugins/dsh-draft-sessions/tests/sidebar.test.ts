import { describe, expect, it } from "vitest";
import {
  draftShellSessionIds,
  planDraftReorder,
} from "../src/client/sidebar.js";
import type { DraftSession } from "../src/shared/types.js";

function draft(
  id: string,
  order: number,
  overrides: Partial<DraftSession> = {},
): DraftSession {
  return {
    version: 1,
    id,
    sessionId: `shell-${id}`,
    workspaceId: "workspace-a",
    text: `Task ${id}`,
    createdAt: 1_000,
    updatedAt: 1_000,
    order,
    state: "ready",
    revision: order + 1,
    ...overrides,
  };
}

describe("draft sidebar source projections", () => {
  it("collects only materialized execution shells", () => {
    expect([
      ...draftShellSessionIds([
        draft("a", 0),
        draft("b", 1, { sessionId: null }),
      ]),
    ]).toEqual(["shell-a"]);
  });

  it("plans a stable append reorder with optimistic revisions", () => {
    expect(
      planDraftReorder([draft("a", 0), draft("b", 1), draft("c", 2)], "a"),
    ).toEqual([
      { id: "b", expectedRevision: 2, order: 0 },
      { id: "c", expectedRevision: 3, order: 1 },
      { id: "a", expectedRevision: 1, order: 2 },
    ]);
  });

  it("rejects unknown reorder identities and no-ops self insertion", () => {
    const drafts = [draft("a", 0), draft("b", 1)];
    expect(planDraftReorder(drafts, "a", "a")).toEqual([]);
    expect(() => planDraftReorder(drafts, "missing")).toThrow(
      'unknown draft "missing"',
    );
    expect(() => planDraftReorder(drafts, "a", "missing")).toThrow(
      'unknown before draft "missing"',
    );
  });
});
