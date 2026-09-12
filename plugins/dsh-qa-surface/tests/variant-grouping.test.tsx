// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { collectVariantGroups } from "../src/client/components/VariantSwitcher.js";

describe("variant grouping", () => {
  it("groups consecutive answer turns under their user message", () => {
    const messages = [
      { id: "user:1", role: "user", text: "Q", status: "committed" },
      {
        id: "assistant:1",
        role: "assistant",
        text: "A1",
        status: "committed",
        turn: 1,
      },
      {
        id: "assistant:2",
        role: "assistant",
        text: "A2",
        status: "committed",
        turn: 2,
      },
      { id: "user:2", role: "user", text: "Q2", status: "committed" },
      {
        id: "assistant:3",
        role: "assistant",
        text: "A3",
        status: "committed",
        turn: 3,
      },
    ] as Parameters<typeof collectVariantGroups>[0];
    const groups = collectVariantGroups(messages);
    expect(groups).toEqual([
      { groupId: "user:1", turns: [1, 2] },
      { groupId: "user:2", turns: [3] },
    ]);
  });

  it("ignores answers that precede any user message", () => {
    const groups = collectVariantGroups([
      {
        id: "assistant:0",
        role: "assistant",
        text: "Boot",
        status: "committed",
        turn: 0,
      },
    ] as Parameters<typeof collectVariantGroups>[0]);
    expect(groups).toEqual([]);
  });
});
