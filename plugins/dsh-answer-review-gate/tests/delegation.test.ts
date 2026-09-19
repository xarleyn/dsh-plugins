import { describe, expect, it } from "vitest";

import { DelegationTracker } from "../src/delegation-tracker.js";

function continuableResult(subagentId: string) {
  return { isError: false, value: { kind: "continuable", subagentId } };
}

function backgroundResult(jobId: string) {
  return { isError: false, value: { kind: "background", jobId } };
}

describe("DelegationTracker", () => {
  it("tracks continuable and background children per parent session", () => {
    const tracker = new DelegationTracker();
    tracker.observeToolResult(
      { name: "subagent", agent: { id: "parent-1" } },
      continuableResult("child-a"),
      3,
    );
    tracker.observeToolResult(
      { name: "subagent", agent: { id: "parent-1" } },
      backgroundResult("job-9"),
      3,
    );
    tracker.observeToolResult(
      { name: "subagent", agent: { id: "parent-2" } },
      continuableResult("child-b"),
      1,
    );
    expect(tracker.pendingCount("parent-1")).toBe(2);
    expect(tracker.pendingCount("parent-2")).toBe(1);
    expect(tracker.entries("parent-1").map((entry) => entry.id)).toEqual([
      "child-a",
      "job-9",
    ]);
    expect(
      tracker.entries("parent-1").every((entry) => entry.createdAtTurn === 3),
    ).toBe(true);
  });

  it("ignores foreground runs, failed results, and other tools", () => {
    const tracker = new DelegationTracker();
    tracker.observeToolResult(
      { name: "subagent", agent: { id: "parent" } },
      {
        isError: false,
        value: { kind: "foreground", runId: "r1", output: [] },
      },
      1,
    );
    tracker.observeToolResult(
      { name: "subagent", agent: { id: "parent" } },
      { isError: true, value: { kind: "continuable", subagentId: "r2" } },
      1,
    );
    tracker.observeToolResult(
      { name: "read", agent: { id: "parent" } },
      continuableResult("r3"),
      1,
    );
    tracker.observeToolResult({ name: "subagent" }, continuableResult("r4"), 1);
    tracker.observeToolResult(
      { name: "subagent", agent: { id: "parent" } },
      { isError: false, value: { kind: "something-else" } },
      1,
    );
    expect(tracker.pendingCount("parent")).toBe(0);
  });

  it("settles a child on the runtime subagent-settled notice", () => {
    const tracker = new DelegationTracker();
    tracker.observeToolResult(
      { name: "subagent", agent: { id: "parent" } },
      continuableResult("child-a"),
      1,
    );
    tracker.observeToolResult(
      { name: "subagent", agent: { id: "parent" } },
      continuableResult("child-b"),
      1,
    );
    tracker.observeInboxInsert("parent", {
      source: {
        kind: "subagent-settled",
        form: "notice",
        summary: "settled",
        senderSessionId: "child-a",
      },
    });
    expect(tracker.pendingCount("parent")).toBe(1);
    expect(tracker.entries("parent").map((entry) => entry.id)).toEqual([
      "child-b",
    ]);
  });

  it("does not settle on other notices, including future waiting notices", () => {
    const tracker = new DelegationTracker();
    tracker.observeToolResult(
      { name: "subagent", agent: { id: "parent" } },
      continuableResult("child-a"),
      1,
    );
    tracker.observeInboxInsert("parent", {
      source: { kind: "subagent-waiting", senderSessionId: "child-a" },
    });
    tracker.observeInboxInsert("parent", {
      source: { kind: "agent-message", senderSessionId: "child-a" },
    });
    tracker.observeInboxInsert("parent", {
      source: { kind: "subagent-settled" },
    });
    tracker.observeInboxInsert("parent", { source: null });
    tracker.observeInboxInsert("other-parent", {
      source: { kind: "subagent-settled", senderSessionId: "child-a" },
    });
    expect(tracker.pendingCount("parent")).toBe(1);
  });

  it("settles the child for whatever terminal reason it ended with", () => {
    const tracker = new DelegationTracker();
    tracker.observeToolResult(
      { name: "subagent", agent: { id: "parent" } },
      continuableResult("child-a"),
      1,
    );
    tracker.observeInboxInsert("parent", {
      source: {
        kind: "subagent-settled",
        senderSessionId: "child-a",
        summary: "failed",
      },
    });
    expect(tracker.pendingCount("parent")).toBe(0);
  });

  it("forgets a session entirely when its agent is disposed", () => {
    const tracker = new DelegationTracker();
    tracker.observeToolResult(
      { name: "subagent", agent: { id: "parent" } },
      continuableResult("child-a"),
      1,
    );
    tracker.forgetSession("parent");
    expect(tracker.pendingCount("parent")).toBe(0);
  });
});
