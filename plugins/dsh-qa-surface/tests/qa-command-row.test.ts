import { describe, expect, it } from "vitest";
import { projectTranscript } from "../src/client/QaTranscriptAdapter.js";
import { snapshot, legacy } from "./helpers/conversation-fakes.js";
import type { ConversationNode } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { QaCommandActivity, QaMessage } from "../src/types.js";

/**
 * A human command is a durable session event, not a message: the Host writes
 * `command/run` and `command/done` and the model never sees either. The
 * adapter projects that pair into one control row, which is the only place
 * the user can see the command at all.
 */

function commandNode(
  overrides: Partial<Extract<ConversationNode, { kind: "command" }>> = {},
): Extract<ConversationNode, { kind: "command" }> {
  return {
    kind: "command",
    seq: 7,
    time: 1_700_000_000_000,
    commandId: "cmd-1" as never,
    name: "compact",
    args: null,
    outcome: { kind: "success", text: "Контекст диалога сжат" },
    ...overrides,
  };
}

function nodes(...items: ConversationNode[]) {
  return projectTranscript(snapshot(legacy({ nodes: items })));
}

/** The activity of a row, asserted to be a command row on the way in. */
function commandOf(row: QaMessage | undefined): QaCommandActivity {
  if (row === undefined || row.role !== "system" || row.command === undefined) {
    throw new Error("expected a command row");
  }
  return row.command;
}

describe("command rows in the transcript", () => {
  it("projects a settled command as a control row, not an answer", () => {
    const rows = nodes(commandNode());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "command:7",
      role: "system",
      status: "info",
      timestamp: 1_700_000_000_000,
      command: {
        commandId: "cmd-1",
        name: "compact",
        state: "success",
        resultText: "Контекст диалога сжат",
      },
    });
    expect(rows[0]?.role).not.toBe("assistant");
  });

  it("strips the separator whitespace off the arguments", () => {
    const rows = nodes(
      commandNode({ name: "goal", args: "  ship the release" }),
    );
    expect(commandOf(rows[0])).toMatchObject({
      name: "goal",
      args: "ship the release",
    });
  });

  it("omits the arguments of a bare invocation", () => {
    const rows = nodes(commandNode({ args: "" }));
    expect(Object.hasOwn(commandOf(rows[0]), "args")).toBe(false);
  });

  it("renders a command still executing as running", () => {
    const rows = nodes(commandNode({ outcome: null }));
    expect(commandOf(rows[0])).toMatchObject({ state: "running" });
    expect(rows[0]?.status).toBe("info");
  });

  it("marks a failed command as an error row", () => {
    const rows = nodes(
      commandNode({ outcome: { kind: "error", text: "Команда недоступна" } }),
    );
    expect(rows[0]?.status).toBe("error");
    expect(commandOf(rows[0])).toMatchObject({
      state: "error",
      resultText: "Команда недоступна",
    });
  });

  it("keeps the sourceEventSeq a richer presentation is built from", () => {
    const rows = nodes(
      commandNode({
        outcome: { kind: "success", text: "Сжато", sourceEventSeq: 42 },
      }),
    );
    expect(commandOf(rows[0])).toMatchObject({ sourceEventSeq: 42 });
  });

  it("drops a done whose run fell outside the loaded window", () => {
    // No name means the pair was cut: an unnamed row would be a lie, and the
    // native client renders the same case as an anonymous command card.
    expect(nodes(commandNode({ name: null }))).toEqual([]);
  });

  it("keeps commands in log order among the other rows", () => {
    const rows = nodes(
      {
        kind: "user",
        seq: 1,
        time: 1,
        content: [{ type: "text", text: "Привет" }],
        source: {},
      } as ConversationNode,
      commandNode({ seq: 2 }),
    );
    expect(rows.map((row) => row.role)).toEqual(["user", "system"]);
  });
});
