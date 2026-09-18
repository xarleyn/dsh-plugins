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
} from "../src/capture.js";
import { CONFIG, firstText, userEvent } from "./capture.helpers.js";

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
      userEvent(
        "The retry policy for ingest lives in settings.yaml and uses exponential backoff.",
      ),
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
      captureEvent(userEvent(text), {
        ...CONFIG,
        captureFilters: ["d|wipe the production\\b|"],
      }),
    ).toBeNull();
  });

  it("honours a substitution filter", () => {
    const payload = captureEvent(
      userEvent(
        "The secret handshake is documented in the vault for the team.",
      ),
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
      content: [
        { type: "text", text: "OpenViking recall: deployment uses blue" },
      ],
      source: {
        kind: "plugin",
        plugin: OPENVIKING_PLUGIN_SOURCE,
        form: "recall",
      },
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
      content: [
        { type: "text", text: "OpenViking recall: deployment uses blue" },
      ],
      source: {
        kind: "plugin",
        plugin: OPENVIKING_PLUGIN_SOURCE,
        form: "recall",
      },
    });
    const other = createUserMessage({
      content: [{ type: "text", text: "background job completed" }],
      source: {
        kind: "plugin",
        plugin: "job-controller",
        form: "notice",
        summary: "done",
      },
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
