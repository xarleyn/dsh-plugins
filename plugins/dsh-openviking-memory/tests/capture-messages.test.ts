/**
 * Turn capture: one DSH session event becomes an OpenViking `addMessage`
 * payload, or nothing at all.
 *
 * The captures are asserted as exact payloads because the server treats this
 * object as the conversation of record: role, timing and call identity all have
 * to survive the trip (SPEC §24-§25).
 */

import { describe, expect, it } from "vitest";

import {
  OPENVIKING_PLUGIN_SOURCE,
  captureEvent,
  type CapturePayload,
} from "../src/capture.js";
import {
  CONFIG,
  EVENT_TIME,
  EVENT_TIME_ISO,
  userEvent,
  withoutTimestamp,
} from "./capture.helpers.js";

describe("user and assistant messages", () => {
  it("captures a user message with its role, parts, event time and peer", () => {
    const payload = captureEvent(
      userEvent("Remember that deployment uses blue.", EVENT_TIME),
      CONFIG,
    );

    expect(payload).toEqual({
      role: "user",
      parts: [{ type: "text", text: "Remember that deployment uses blue." }],
      created_at: EVENT_TIME_ISO,
      peer_id: "workspace-a",
    });
  });

  it("omits peer_id when the config has none", () => {
    const payload = captureEvent(
      userEvent("Remember that deployment uses blue."),
      {
        ...CONFIG,
        peerId: "",
      },
    );

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
            content: [
              {
                type: "text",
                text: "Deployment uses blue for every environment.",
              },
            ],
            source: { kind: "model" },
          },
        },
      },
      CONFIG,
    );

    expect(payload).toEqual({
      role: "assistant",
      parts: [
        { type: "text", text: "Deployment uses blue for every environment." },
      ],
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
            content: [
              {
                type: "text",
                text: "Deployment uses blue for every environment.",
              },
            ],
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
          content: [
            {
              type: "text",
              text: "<openviking-context>blue</openviking-context>",
            },
          ],
          source: {
            kind: "plugin",
            plugin: OPENVIKING_PLUGIN_SOURCE,
            form: "recall",
          },
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
          content: [
            { type: "text", text: "Time sampled while preparing turn 3" },
          ],
          source: { kind: "plugin", plugin: "time-context", form: "snapshot" },
        },
      },
      CONFIG,
    );

    expect(payload).toBeNull();
  });
});

describe("event timing", () => {
  it("keeps the event time so identical offline messages do not deduplicate", () => {
    const first = captureEvent(
      userEvent("Repeat this exact fact.", 1_700_000_000_000),
      CONFIG,
    );
    const second = captureEvent(
      userEvent("Repeat this exact fact.", 1_700_000_001_000),
      CONFIG,
    );

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
