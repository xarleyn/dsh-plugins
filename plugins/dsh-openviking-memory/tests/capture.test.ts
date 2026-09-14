/**
 * Turn capture: one DSH session event becomes an OpenViking `addMessage`
 * payload, or nothing at all.
 *
 * The captures are asserted as exact payloads because the server treats this
 * object as the conversation of record: role, timing and call identity all have
 * to survive the trip (SPEC §24-§25).
 */

import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { describe, expect, it } from "vitest";

import {
  OPENVIKING_PLUGIN_SOURCE,
  captureEvent,
  promptText,
  type CapturePayload,
  type CaptureSessionEvent,
} from "../src/capture.js";
import type { CaptureConfig } from "../src/openviking/capture-utils.js";

const CONFIG: CaptureConfig = {
  captureAssistantTurns: true,
  captureToolResults: true,
  captureToolMaxChars: 1_000_000,
  captureMaxLength: 24_000,
  captureFilters: [],
  peerId: "workspace-a",
};

/** The DSH event time used by the timing assertions. */
const EVENT_TIME = 1_786_681_234_567;

/** `created_at` for {@link EVENT_TIME}. */
const EVENT_TIME_ISO = "2026-08-14T04:20:34.567Z";

function userEvent(text: string, time?: number): CaptureSessionEvent {
  return {
    type: "user/message",
    ...(time === undefined ? {} : { time }),
    data: {
      role: "user",
      content: [{ type: "text", text }],
      source: { kind: "user" },
    },
  };
}

/** A captured payload with the derived `created_at` neutralized, for field-by-field comparison. */
function withoutTimestamp(payload: CapturePayload): CapturePayload {
  return { ...payload, created_at: undefined };
}

/** The first text part of a captured payload, or "" when there is none. */
function firstText(payload: CapturePayload | null): string {
  for (const part of payload?.parts ?? []) {
    if (part.type === "text") return part.text;
  }
  return "";
}

describe("user and assistant messages", () => {
  it("captures a user message with its role, parts, event time and peer", () => {
    const payload = captureEvent(userEvent("Remember that deployment uses blue.", EVENT_TIME), CONFIG);

    expect(payload).toEqual({
      role: "user",
      parts: [{ type: "text", text: "Remember that deployment uses blue." }],
      created_at: EVENT_TIME_ISO,
      peer_id: "workspace-a",
    });
  });

  it("omits peer_id when the config has none", () => {
    const payload = captureEvent(userEvent("Remember that deployment uses blue."), {
      ...CONFIG,
      peerId: "",
    });

    expect(payload).not.toBeNull();
    expect(Object.hasOwn(payload as CapturePayload, "peer_id")).toBe(false);
  });

  it("captures an assistant message as the assistant role", () => {
    const payload = captureEvent(
      {
        type: "assistant/message",
        time: EVENT_TIME,
        data: {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Deployment uses blue for every environment." }],
            source: { kind: "model" },
          },
        },
      },
      CONFIG,
    );

    expect(payload).toEqual({
      role: "assistant",
      parts: [{ type: "text", text: "Deployment uses blue for every environment." }],
      created_at: EVENT_TIME_ISO,
      peer_id: "workspace-a",
    });
  });

  it("drops assistant turns when captureAssistantTurns is false", () => {
    const payload = captureEvent(
      {
        type: "assistant/message",
        data: {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Deployment uses blue for every environment." }],
            source: { kind: "model" },
          },
        },
      },
      { ...CONFIG, captureAssistantTurns: false },
    );

    expect(payload).toBeNull();
  });
});

describe("injected context is never mirrored into memory", () => {
  it("drops this plugin's own injected blocks", () => {
    const payload = captureEvent(
      {
        type: "user/message",
        data: {
          role: "user",
          content: [{ type: "text", text: "<openviking-context>blue</openviking-context>" }],
          source: { kind: "plugin", plugin: OPENVIKING_PLUGIN_SOURCE, form: "recall" },
        },
      },
      CONFIG,
    );

    expect(payload).toBeNull();
  });

  it("drops another plugin's injected context too", () => {
    const payload = captureEvent(
      {
        type: "user/message",
        data: {
          role: "user",
          content: [{ type: "text", text: "Time sampled while preparing turn 3" }],
          source: { kind: "plugin", plugin: "time-context", form: "snapshot" },
        },
      },
      CONFIG,
    );

    expect(payload).toBeNull();
  });
});

describe("tool calls and results", () => {
  it("keeps DSH call identity in a captured tool result", () => {
    const toolNames = new Map<string, string>();

    const call = captureEvent(
      {
        type: "tool/call",
        data: { callId: "call-1", name: "bash", arguments: '{"command":"pwd"}' },
      },
      CONFIG,
      toolNames,
    );
    expect(call).toBeNull();
    expect([...toolNames]).toEqual([["call-1", "bash"]]);

    const captured = captureEvent(
      {
        type: "tool/result",
        data: {
          message: {
            role: "user",
            content: [
              {
                type: "tool-result",
                toolCallId: "call-1",
                content: [{ type: "text", text: "/workspace" }],
              },
            ],
            source: { kind: "tool", callId: "call-1" },
          },
        },
      },
      CONFIG,
      toolNames,
    );

    expect(captured?.role).toBe("user");
    const part = captured?.parts?.[0];
    if (part?.type !== "tool") {
      throw new Error(`expected a tool part, got ${part?.type ?? "none"}`);
    }
    // The DSH call identity survives: the block's `toolCallId` becomes the
    // captured `tool_id`, and the name came from the recorded `tool/call`.
    expect(part.tool_id).toBe("call-1");
    expect(part.tool_name).toBe("bash");
    expect(part.tool_status).toBe("completed");
    expect(part.tool_output).toMatch(/workspace/);
    // The entry was consumed by the `finally` block, so the map cannot grow.
    expect(toolNames.size).toBe(0);
  });

  it("marks a tool result error with the error status", () => {
    const toolNames = new Map([["call-err", "bash"]]);

    const captured = captureEvent(
      {
        type: "tool/result",
        data: {
          message: {
            role: "user",
            content: [
              {
                type: "tool-result",
                toolCallId: "call-err",
                content: [{ type: "text", text: "bash: df: command not found" }],
                is_error: true,
              },
            ],
            source: { kind: "tool", callId: "call-err" },
          },
        },
      },
      CONFIG,
      toolNames,
    );

    expect(captured?.parts?.[0]).toMatchObject({ type: "tool", tool_status: "error" });
    expect(toolNames.size).toBe(0);
  });

  it("treats a bare `error` field on the result block as a failure too", () => {
    const captured = captureEvent(
      {
        type: "tool/result",
        data: {
          message: {
            role: "user",
            content: [
              { type: "tool-result", toolCallId: "call-boom", error: "boom", content: [] },
            ],
            source: { kind: "tool", callId: "call-boom" },
          },
        },
      },
      CONFIG,
      new Map([["call-boom", "bash"]]),
    );

    expect(captured?.parts?.[0]).toMatchObject({ type: "tool", tool_status: "error" });
  });

  it("records no names and captures nothing when tool results are disabled", () => {
    const toolNames = new Map<string, string>();
    const disabled: CaptureConfig = { ...CONFIG, captureToolResults: false };

    const call = captureEvent(
      { type: "tool/call", data: { callId: "call-disabled", name: "bash" } },
      disabled,
      toolNames,
    );
    expect(call).toBeNull();
    expect(toolNames.size).toBe(0);

    const result = captureEvent(
      {
        type: "tool/result",
        data: {
          message: {
            role: "user",
            content: [
              { type: "tool-result", toolCallId: "call-disabled", content: [{ type: "text", text: "/workspace" }] },
            ],
            source: { kind: "tool", callId: "call-disabled" },
          },
        },
      },
      disabled,
      toolNames,
    );
    expect(result).toBeNull();
    expect(toolNames.size).toBe(0);
  });

  it("releases a recorded call name even when the result captures nothing", () => {
    const toolNames = new Map([["call-empty", "bash"]]);

    const captured = captureEvent(
      {
        type: "tool/result",
        data: {
          message: { role: "user", content: [], source: { kind: "tool", callId: "call-empty" } },
        },
      },
      CONFIG,
      toolNames,
    );

    expect(captured).toBeNull();
    expect(toolNames.size).toBe(0);
  });
});

describe("event timing", () => {
  it("keeps the event time so identical offline messages do not deduplicate", () => {
    const first = captureEvent(userEvent("Repeat this exact fact.", 1_700_000_000_000), CONFIG);
    const second = captureEvent(userEvent("Repeat this exact fact.", 1_700_000_001_000), CONFIG);

    expect(first?.created_at).toBe("2023-11-14T22:13:20.000Z");
    expect(second?.created_at).toBe("2023-11-14T22:13:21.000Z");
    expect(first?.created_at).not.toBe(second?.created_at);
    expect(withoutTimestamp(first as CapturePayload)).toEqual(
      withoutTimestamp(second as CapturePayload),
    );
  });

  it("omits created_at when the event carries no usable time", () => {
    const payload = captureEvent(userEvent("Repeat this exact fact."), CONFIG);

    expect(payload).not.toBeNull();
    expect(Object.hasOwn(payload as CapturePayload, "created_at")).toBe(false);
  });
});

describe("the capture gate", () => {
  const DROPPED: readonly (readonly [string, string])[] = [
    ["an acknowledgement", "ok"],
    ["a Chinese acknowledgement", "收到"],
    ["a slash command", "/clear"],
    ["punctuation only", "---"],
    ["too short to carry signal", "ab"],
  ];

  it.each(DROPPED)("drops %s", (_label, text) => {
    expect(captureEvent(userEvent(text), CONFIG)).toBeNull();
  });

  it("captures a long factual sentence", () => {
    const payload = captureEvent(
      userEvent("The retry policy for ingest lives in settings.yaml and uses exponential backoff."),
      CONFIG,
    );

    expect(payload?.parts?.[0]).toEqual({
      type: "text",
      text: "The retry policy for ingest lives in settings.yaml and uses exponential backoff.",
    });
  });

  it("honours a drop filter", () => {
    const payload = captureEvent(userEvent("/clear"), {
      ...CONFIG,
      captureFilters: ["d|^\\s*/clear\\b|"],
    });

    expect(payload).toBeNull();
  });

  it("honours a drop filter for text the gate would otherwise keep", () => {
    const text = "please wipe the production database before the demo";

    expect(captureEvent(userEvent(text), CONFIG)).not.toBeNull();
    expect(
      captureEvent(userEvent(text), { ...CONFIG, captureFilters: ["d|wipe the production\\b|"] }),
    ).toBeNull();
  });

  it("honours a substitution filter", () => {
    const payload = captureEvent(
      userEvent("The secret handshake is documented in the vault for the team."),
      { ...CONFIG, captureFilters: ["s/secret/REDACTED/g"] },
    );

    const text = firstText(payload);
    expect(text).toContain("REDACTED");
    expect(text).not.toContain("secret");
  });
});

describe("promptText builds the recall query", () => {
  it("keeps the current input and excludes this plugin's own injected blocks", () => {
    const own = createUserMessage({
      content: [{ type: "text", text: "OpenViking recall: deployment uses blue" }],
      source: { kind: "plugin", plugin: OPENVIKING_PLUGIN_SOURCE, form: "recall" },
    });

    expect(
      promptText([
        createUserMessage({
          content: [{ type: "text", text: "first" }],
          source: { kind: "user" },
        }),
        own,
      ]),
    ).toBe("first");
  });

  it("keeps another plugin's context, which is not this plugin retrieving itself", () => {
    const own = createUserMessage({
      content: [{ type: "text", text: "OpenViking recall: deployment uses blue" }],
      source: { kind: "plugin", plugin: OPENVIKING_PLUGIN_SOURCE, form: "recall" },
    });
    const other = createUserMessage({
      content: [{ type: "text", text: "background job completed" }],
      source: { kind: "plugin", plugin: "job-controller", form: "notice", summary: "done" },
    });

    expect(
      promptText([
        createUserMessage({
          content: [{ type: "text", text: "first" }],
          source: { kind: "user" },
        }),
        own,
        other,
      ]),
    ).toBe("first\n\nbackground job completed");
  });

  it("is empty without messages", () => {
    expect(promptText([])).toBe("");
    expect(promptText(undefined)).toBe("");
  });
});
