import { Context } from "@deepseek-ai/cordis";
import SessionStore, { SessionId } from "@deepseek-ai/dsh-session";
import { expect, it } from "vitest";
import {
  appendMode,
  appendModes,
  modeEvents,
} from "../src/answer-mode-records.js";

it("writes native ignorable records and restores the exact strategy and consent state", async () => {
  const ctx = new Context();
  await ctx.plugin(SessionStore);
  try {
    const session = ctx.sessions.create(SessionId("mode-record-roundtrip"));
    appendMode(session, "qa/answer-mode-command", {
      id: "command",
      modes: ["fast", "rag"],
    });
    appendModes(session, [
      [
        "qa/answer-modes",
        { requestId: "message", by: "message", modes: ["fast", "rag"] },
      ],
      ["qa/answer-mode-command-done", { id: "command" }],
      [
        "qa/answer-mode-turn",
        {
          turn: 1,
          modes: ["fast", "rag"],
          requests: ["message"],
          approved: false,
          declined: true,
        },
      ],
    ]);
    const persisted = JSON.parse(JSON.stringify(session.snapshotEvents()));
    expect(persisted).toHaveLength(4);
    expect(
      persisted.every(
        (event: { type: string; ignorable?: boolean }) =>
          event.type.startsWith("plugin:dsh-qa-surface/") &&
          event.ignorable === true,
      ),
    ).toBe(true);
    expect(session.surface.nodes).toEqual([]);
    expect(
      modeEvents({ snapshotEvents: () => persisted }).map((event) => [
        event.type,
        event.data,
      ]),
    ).toEqual([
      ["qa/answer-mode-command", { id: "command", modes: ["fast", "rag"] }],
      [
        "qa/answer-modes",
        { requestId: "message", by: "message", modes: ["fast", "rag"] },
      ],
      ["qa/answer-mode-command-done", { id: "command" }],
      [
        "qa/answer-mode-turn",
        {
          turn: 1,
          modes: ["fast", "rag"],
          requests: ["message"],
          approved: false,
          declined: true,
        },
      ],
    ]);
  } finally {
    await ctx.fiber.dispose();
  }
});

it("retains repaired legacy records and refuses malformed owned plugin state", async () => {
  const legacy = {
    type: "qa/answer-modes",
    seq: 0,
    time: 1,
    data: { requestId: "request", by: "rpc", modes: ["rag"] },
    ignorable: true,
  };
  expect(modeEvents({ snapshotEvents: () => [legacy] as never })[0]).toBe(
    legacy,
  );
  const malformed = {
    ...legacy,
    type: "plugin:dsh-qa-surface/answer-modes",
    data: { requestId: "request", by: "rpc", modes: ["invented"] },
  };
  expect(() =>
    modeEvents({ snapshotEvents: () => [malformed] as never }),
  ).toThrow("Invalid saved QA answer modes");
});

it("validates every pending record before publishing a group", async () => {
  const ctx = new Context();
  await ctx.plugin(SessionStore);
  try {
    const session = ctx.sessions.create(SessionId("invalid-mode-group"));
    expect(() =>
      appendModes(session, [
        ["qa/answer-mode-command-done", { id: "valid" }],
        [
          "qa/answer-modes",
          { requestId: "invalid", by: "rpc", modes: ["invented"] } as never,
        ],
      ]),
    ).toThrow("Invalid saved QA answer modes");
    expect(session.snapshotEvents()).toHaveLength(0);
  } finally {
    await ctx.fiber.dispose();
  }
});

it.each([
  "qa/answer-mode-unknown",
  "plugin:dsh-qa-surface/answer-mode-unknown",
])(
  "refuses unknown owned state %s instead of dropping its restriction",
  (type) => {
    const event = {
      type,
      seq: 0,
      time: 1,
      data: { modes: ["rag"] },
      ignorable: true,
    };
    expect(() =>
      modeEvents({ snapshotEvents: () => [event] as never }),
    ).toThrow("Unknown saved QA answer modes");
  },
);

it.each(["qa/answer-mode-turn", "plugin:dsh-qa-surface/answer-mode-turn"])(
  "refuses contradictory consent in %s",
  (type) => {
    const event = {
      type,
      seq: 0,
      time: 1,
      data: {
        turn: 1,
        modes: ["rag"],
        requests: ["request"],
        approved: true,
        declined: true,
      },
      ignorable: true,
    };
    expect(() =>
      modeEvents({ snapshotEvents: () => [event] as never }),
    ).toThrow("Invalid saved QA answer modes");
  },
);

it("leaves unrelated opaque plugin records intact", () => {
  const event = {
    type: "plugin:other/metadata",
    seq: 0,
    time: 1,
    data: { value: true },
    ignorable: true,
  };
  expect(modeEvents({ snapshotEvents: () => [event] as never })[0]).toBe(event);
});
