import { describe, expect, it, vi } from "vitest";

import { createMessage } from "@deepseek-ai/dsh-llm";

import { toPiContext } from "../../src/upstream/context.js";

describe("toPiContext", () => {
  const validResponse = {
    kind: "pi-ai",
    version: 2,
    api: "openai-completions",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    stopReason: "stop",
  };

  const validReplay = { response: validResponse, blocks: [{ type: "text" }] };

  /** Convert with the given state and assert the message degraded to foreign with the given reason. */
  function expectDegraded(replayState: unknown, message: string): void {
    const onDegrade = vi.fn();
    const context = toPiContext(
      {
        provider: "deepseek",
        model: "next-model",
        messages: [
          createMessage({
            role: "assistant",
            content: [{ type: "text", text: "done" }],
            source: {
              kind: "model",
              ...{
                provider: "deepseek",
                model: "deepseek-v4-flash",
                replayState,
              },
            },
          }),
        ],
      },
      undefined,
      onDegrade,
    );
    expect(context.messages[0]).toMatchObject({
      role: "assistant",
      api: "dsh-foreign",
      content: [{ type: "text", text: "done" }],
    });
    expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining(message));
  }

  it.each([
    ["number state", 1, "expected a replay envelope"],
    ["null state", null, "expected a replay envelope"],
    ["array state", [], "expected a replay envelope"],
    ["missing response", { blocks: [] }, "expected a response object"],
    [
      "array response",
      { ...validReplay, response: [] },
      "expected a response object",
    ],
    [
      "unknown kind",
      { ...validReplay, response: { ...validResponse, kind: "other" } },
      "unknown state kind",
    ],
    [
      "non-string api",
      { ...validReplay, response: { ...validResponse, api: 1 } },
      "api must be a non-empty string",
    ],
    [
      "empty provider",
      { ...validReplay, response: { ...validResponse, provider: "" } },
      "provider must be a non-empty string",
    ],
    [
      "missing model",
      { ...validReplay, response: { ...validResponse, model: undefined } },
      "model must be a non-empty string",
    ],
    [
      "unknown stop reason",
      { ...validReplay, response: { ...validResponse, stopReason: "pause" } },
      "unknown stopReason",
    ],
    [
      "non-string response model",
      { ...validReplay, response: { ...validResponse, responseModel: 1 } },
      "responseModel must be a string",
    ],
    [
      "non-string response id",
      { ...validReplay, response: { ...validResponse, responseId: 1 } },
      "responseId must be a string",
    ],
    [
      "non-string provider thinking level",
      {
        ...validReplay,
        response: { ...validResponse, providerThinkingLevel: 1 },
      },
      "providerThinkingLevel must be a string",
    ],
    [
      "null provider thinking level",
      {
        ...validReplay,
        response: { ...validResponse, providerThinkingLevel: null },
      },
      "providerThinkingLevel must be a string",
    ],
    ["missing blocks", { response: validResponse }, "blocks must be an array"],
    [
      "non-array blocks",
      { ...validReplay, blocks: "text" },
      "blocks must be an array",
    ],
    [
      "number block",
      { ...validReplay, blocks: [1] },
      "block 0 must be an object",
    ],
    [
      "null block",
      { ...validReplay, blocks: [null] },
      "block 0 must be an object",
    ],
    [
      "array block",
      { ...validReplay, blocks: [[]] },
      "block 0 must be an object",
    ],
    [
      "unknown block type",
      { ...validReplay, blocks: [{ type: "audio" }] },
      "block 0 has an unknown type",
    ],
    [
      "non-string signature",
      { ...validReplay, blocks: [{ type: "text", textSignature: 1 }] },
      "textSignature must be a string",
    ],
    [
      "non-boolean redaction",
      { ...validReplay, blocks: [{ type: "reasoning", redacted: "yes" }] },
      "redacted must be boolean",
    ],
  ])("degrades malformed replay state: %s", (_name, replayState, message) => {
    expectDegraded(replayState, message);
  });
});
