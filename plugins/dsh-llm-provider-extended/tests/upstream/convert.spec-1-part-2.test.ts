import { describe, expect, it, vi } from "vitest";

import { ToolCallId, createMessage } from "@deepseek-ai/dsh-llm";

import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";

import { toPiContext } from "../../src/upstream/context.js";

import { toPiReplayState } from "../../src/upstream/replay.js";

function usage(input = 0, output = 0, cacheRead = 0, cacheWrite = 0): Usage {
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function assistant(
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai-completions",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    usage: usage(),
    stopReason: "stop",
    timestamp: 0,
    ...overrides,
  };
}

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

  it("recombines durable content with pi-ai replay metadata across target providers and models", () => {
    const state = toPiReplayState(
      assistant({
        api: "openai-responses",
        provider: "openai",
        model: "gpt-5",
        responseModel: "gpt-5-2026-01-01",
        responseId: "resp_123",
        stopReason: "toolUse",
        content: [
          {
            type: "thinking",
            thinking: "private reasoning",
            thinkingSignature: "think-sig",
            redacted: true,
          },
          { type: "text", text: "calling", textSignature: "text-sig" },
          {
            type: "toolCall",
            id: "c1",
            name: "f",
            arguments: { a: 1 },
            thoughtSignature: "tool-sig",
          },
        ],
      }),
    );
    const context = toPiContext({
      provider: "anthropic",
      model: "claude-next",
      messages: [
        createMessage({
          role: "assistant",
          content: [
            { type: "reasoning", text: "private reasoning" },
            { type: "text", text: "calling" },
            {
              type: "tool-call",
              id: ToolCallId("c1"),
              name: "f",
              arguments: '{"a":1}',
            },
          ],
          source: {
            kind: "model",
            ...{ provider: "openai", model: "gpt-5", replayState: state },
          },
        }),
      ],
    });

    expect(context.messages[0]).toMatchObject({
      role: "assistant",
      api: "openai-responses",
      provider: "openai",
      model: "gpt-5",
      responseModel: "gpt-5-2026-01-01",
      responseId: "resp_123",
      stopReason: "toolUse",
      content: [
        {
          type: "thinking",
          thinking: "private reasoning",
          thinkingSignature: "think-sig",
          redacted: true,
        },
        { type: "text", text: "calling", textSignature: "text-sig" },
        {
          type: "toolCall",
          id: "c1",
          name: "f",
          arguments: { a: 1 },
          thoughtSignature: "tool-sig",
        },
      ],
    });
  });

  it.each(["high", ""])(
    "preserves provider thinking level %j through durable projection and replay",
    (providerThinkingLevel) => {
      const state = toPiReplayState(
        assistant({
          api: "anthropic-messages",
          provider: "anthropic",
          model: "claude-opus-5",
          providerThinkingLevel,
          content: [{ type: "text", text: "done" }],
        }),
      );
      expect(state).toEqual({
        response: {
          kind: "pi-ai",
          version: 2,
          api: "anthropic-messages",
          provider: "anthropic",
          model: "claude-opus-5",
          providerThinkingLevel,
          stopReason: "stop",
        },
        blocks: [{ type: "text" }],
      });
      const replayState: unknown = JSON.parse(JSON.stringify(state));
      const onDegrade = vi.fn();
      const context = toPiContext(
        {
          provider: "anthropic",
          model: "claude-opus-5",
          messages: [
            createMessage({
              role: "assistant",
              content: [{ type: "text", text: "done" }],
              source: {
                kind: "model",
                provider: "anthropic",
                model: "claude-opus-5",
                replayState,
              },
            }),
          ],
        },
        undefined,
        onDegrade,
      );
      expect(context.messages[0]).toMatchObject({
        api: "anthropic-messages",
        providerThinkingLevel,
        content: [{ type: "text", text: "done" }],
      });
      expect(onDegrade).not.toHaveBeenCalled();
    },
  );

  it("replays all native block kinds when optional metadata is absent", () => {
    const state = toPiReplayState(
      assistant({
        content: [
          { type: "thinking", thinking: "private reasoning" },
          { type: "text", text: "calling" },
          { type: "toolCall", id: "c1", name: "f", arguments: { a: 1 } },
        ],
      }),
    );
    const context = toPiContext({
      provider: "deepseek",
      model: "new-model",
      messages: [
        createMessage({
          role: "assistant",
          content: [
            { type: "reasoning", text: "private reasoning" },
            { type: "text", text: "calling" },
            {
              type: "tool-call",
              id: ToolCallId("c1"),
              name: "f",
              arguments: '{"a":1}',
            },
          ],
          source: {
            kind: "model",
            ...{
              provider: "deepseek",
              model: "deepseek-v4-flash",
              replayState: state,
            },
          },
        }),
      ],
    });

    expect(context.messages[0]).toMatchObject({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "private reasoning" },
        { type: "text", text: "calling" },
        { type: "toolCall", id: "c1", name: "f", arguments: { a: 1 } },
      ],
    });
    expect(context.messages[0]).not.toHaveProperty("responseModel");
    expect(context.messages[0]).not.toHaveProperty("responseId");
    expect(state.response).not.toHaveProperty("providerThinkingLevel");
    expect(context.messages[0]).not.toHaveProperty("providerThinkingLevel");
  });

  it("degrades unsupported replay-state versions to provider-neutral history", () => {
    const onDegrade = vi.fn();
    const context = toPiContext(
      {
        provider: "deepseek",
        model: "m",
        messages: [
          createMessage({
            role: "assistant",
            content: [{ type: "text", text: "done" }],
            source: {
              kind: "model",
              ...{
                provider: "deepseek",
                model: "old",
                replayState: {
                  response: { kind: "pi-ai", version: 3 },
                  blocks: [],
                },
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
      provider: "deepseek",
      model: "old",
      content: [{ type: "text", text: "done" }],
    });
    expect(onDegrade).toHaveBeenCalledWith(
      expect.stringContaining("unsupported version 3"),
    );
  });

  it("degrades the flat pre-envelope replay state a legacy session log carries", () => {
    const onDegrade = vi.fn();
    const context = toPiContext(
      {
        provider: "deepseek",
        model: "m",
        messages: [
          createMessage({
            role: "assistant",
            content: [{ type: "text", text: "done" }],
            source: {
              kind: "model",
              ...{
                provider: "deepseek",
                model: "deepseek-v4-flash",
                replayState: {
                  kind: "pi-ai",
                  version: 1,
                  api: "openai-completions",
                  provider: "deepseek",
                  model: "deepseek-v4-flash",
                  stopReason: "stop",
                  blocks: [{ type: "text" }],
                },
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
    });
    expect(onDegrade).toHaveBeenCalledWith(
      expect.stringContaining("expected a response object"),
    );
  });

  it("degrades replay metadata whose blocks do not match the durable content", () => {
    const onDegrade = vi.fn();
    const state = toPiReplayState(
      assistant({ content: [{ type: "text", text: "done" }] }),
    );
    const context = toPiContext(
      {
        provider: "deepseek",
        model: "m",
        messages: [
          createMessage({
            role: "assistant",
            content: [{ type: "reasoning", text: "done" }],
            source: {
              kind: "model",
              ...{
                provider: "deepseek",
                model: "deepseek-v4-flash",
                replayState: state,
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
      content: [{ type: "thinking", thinking: "done" }],
    });
    expect(onDegrade).toHaveBeenCalledWith(
      expect.stringContaining("block 0 does not match assistant content"),
    );
  });

  it("degrades replay metadata whose block count differs from durable content", () => {
    const onDegrade = vi.fn();
    const state = toPiReplayState(assistant());
    const context = toPiContext(
      {
        provider: "deepseek",
        model: "m",
        messages: [
          createMessage({
            role: "assistant",
            content: [{ type: "text", text: "done" }],
            source: {
              kind: "model",
              ...{
                provider: "deepseek",
                model: "deepseek-v4-flash",
                replayState: state,
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
      provider: "deepseek",
      model: "deepseek-v4-flash",
      content: [{ type: "text", text: "done" }],
      stopReason: "stop",
    });
    expect(onDegrade).toHaveBeenCalledWith(
      expect.stringContaining("block count does not match assistant content"),
    );
  });

  it.each([
    [
      "provider",
      { ...validReplay, response: { ...validResponse, provider: "openai" } },
    ],
    [
      "model",
      {
        ...validReplay,
        response: { ...validResponse, model: "deepseek-v4-pro" },
      },
    ],
  ])(
    "degrades replay metadata whose %s differs from assistant source",
    (field, replayState) => {
      expectDegraded(replayState, `${field} does not match assistant source`);
    },
  );
});
