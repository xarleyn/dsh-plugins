// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { collectSubagents } from "../src/client/components/QaAgentsDrawer.js";
import type { SessionSummary } from "@deepseek-ai/dsh-api-session-controller/client";

describe("subagent panel", () => {
  const byId = {
    parent: {
      id: "parent",
      displayTitle: "Chat",
      running: false,
      blank: false,
      updatedAt: 1_000,
    },
    childRunning: {
      id: "child-running",
      displayTitle: "Count words in README.md",
      running: true,
      blank: false,
      updatedAt: 3_000,
      parentId: "parent",
      origin: "subagent",
    },
    childDone: {
      id: "child-done",
      displayTitle: "Print a greeting",
      running: false,
      blank: false,
      updatedAt: 2_000,
      parentId: "parent",
      origin: "subagent",
      completed: true,
    },
    stranger: {
      id: "stranger",
      displayTitle: "Unrelated chat",
      running: false,
      blank: false,
      updatedAt: 4_000,
    },
    grandchild: {
      id: "grandchild",
      displayTitle: "Nested",
      running: false,
      blank: false,
      updatedAt: 5_000,
      parentId: "child-running",
      origin: "subagent",
    },
  } as unknown as Record<string, SessionSummary>;

  it("lists direct subagent children running first", () => {
    const rows = collectSubagents(byId, "parent", 90_000);
    expect(rows.map((row) => row.id)).toEqual(["child-running", "child-done"]);
    expect(rows[0]).toMatchObject({
      title: "Count words in README.md",
      running: true,
      meta: "1 мин",
    });
    expect(rows[1]).toMatchObject({ completed: true });
  });

  it("follows the viewed subagent and ignores unrelated sessions", () => {
    expect(collectSubagents(byId, null, 90_000)).toEqual([]);
    expect(
      collectSubagents(byId, "child-running", 90_000).map((row) => row.id),
    ).toEqual(["grandchild"]);
    expect(collectSubagents(byId, "stranger", 90_000)).toEqual([]);
  });
});
