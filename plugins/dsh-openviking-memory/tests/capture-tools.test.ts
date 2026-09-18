/**
 * Turn capture: one DSH session event becomes an OpenViking `addMessage`
 * payload, or nothing at all.
 *
 * The captures are asserted as exact payloads because the server treats this
 * object as the conversation of record: role, timing and call identity all have
 * to survive the trip (SPEC §24-§25).
 */

import { describe, expect, it } from "vitest";

import { captureEvent } from "../src/capture.js";
import type { CaptureConfig } from "../src/openviking/capture-utils.js";
import { CONFIG } from "./capture.helpers.js";

describe("tool calls and results", () => {
  it("keeps DSH call identity in a captured tool result", () => {
    const toolNames = new Map<string, string>();

    const call = captureEvent(
      {
        type: "tool/call",
        data: {
          callId: "call-1",
          name: "bash",
          arguments: '{"command":"pwd"}',
        },
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
                content: [
                  { type: "text", text: "bash: df: command not found" },
                ],
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

    expect(captured?.parts?.[0]).toMatchObject({
      type: "tool",
      tool_status: "error",
    });
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
              {
                type: "tool-result",
                toolCallId: "call-boom",
                error: "boom",
                content: [],
              },
            ],
            source: { kind: "tool", callId: "call-boom" },
          },
        },
      },
      CONFIG,
      new Map([["call-boom", "bash"]]),
    );

    expect(captured?.parts?.[0]).toMatchObject({
      type: "tool",
      tool_status: "error",
    });
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
              {
                type: "tool-result",
                toolCallId: "call-disabled",
                content: [{ type: "text", text: "/workspace" }],
              },
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
          message: {
            role: "user",
            content: [],
            source: { kind: "tool", callId: "call-empty" },
          },
        },
      },
      CONFIG,
      toolNames,
    );

    expect(captured).toBeNull();
    expect(toolNames.size).toBe(0);
  });
});
