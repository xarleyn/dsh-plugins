import { describe, expect, it } from "vitest";

import {
  CONTEXT_WINDOW_EXCEEDED_CODE,
  EMPTY_RESPONSE_CODE,
} from "@deepseek-ai/dsh-llm";

import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";

import { mapStopReason, mapUsage } from "../../src/upstream/stream.js";

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

describe("mapStopReason / mapUsage", () => {
  it.each([
    ["stop", { kind: "stop" }],
    ["length", { kind: "max-tokens" }],
    ["toolUse", { kind: "tool-calls" }],
    [
      "pending",
      {
        kind: "error",
        failure: {
          message: 'pi-ai stream for model "deepseek-v4-flash" ended pending',
          code: "PI_AI_ERROR",
        },
      },
    ],
    [
      "deferred",
      {
        kind: "error",
        failure: {
          message:
            'pi-ai deferred response for model "deepseek-v4-flash" is not supported',
          code: "PI_AI_ERROR",
        },
      },
    ],
    [
      "aborted",
      {
        kind: "aborted",
        failure: { message: "pi-ai stream aborted", code: "ABORTED" },
      },
    ],
  ] as const)("maps %s", (stopReason, expected) => {
    expect(
      mapStopReason(
        assistant({ stopReason, content: [{ type: "text", text: "ok" }] }),
      ),
    ).toEqual(expected);
  });

  it("classifies a completed stop with no content as an EMPTY_RESPONSE error", () => {
    expect(mapStopReason(assistant({ stopReason: "stop" }))).toEqual({
      kind: "error",
      failure: {
        message:
          'model "deepseek-v4-flash" returned a completed response with no content',
        code: EMPTY_RESPONSE_CODE,
      },
    });
  });

  it("keeps a thinking-only stop successful (any block counts as content)", () => {
    expect(
      mapStopReason(
        assistant({
          stopReason: "stop",
          content: [{ type: "thinking", thinking: "mull" }],
        }),
      ),
    ).toEqual({ kind: "stop" });
  });

  it("defaults the error message when pi-ai omits it", () => {
    expect(mapStopReason(assistant({ stopReason: "error" }))).toEqual({
      kind: "error",
      failure: { message: "pi-ai stream error", code: "PI_AI_ERROR" },
    });
  });

  it("maps routable HTTP-ish error messages to stable codes", () => {
    expect(
      mapStopReason(
        assistant({ stopReason: "error", errorMessage: "HTTP 401: bad key" }),
      ),
    ).toMatchObject({ kind: "error", failure: { code: "AUTH" } });
    expect(
      mapStopReason(
        assistant({
          stopReason: "error",
          errorMessage: "HTTP 429: rate limit",
        }),
      ),
    ).toMatchObject({ kind: "error", failure: { code: "RATE_LIMIT" } });
    expect(
      mapStopReason(
        assistant({
          stopReason: "error",
          errorMessage: "HTTP 429: insufficient_quota",
        }),
      ),
    ).toMatchObject({ kind: "error", failure: { code: "QUOTA" } });
    expect(
      mapStopReason(
        assistant({
          stopReason: "error",
          errorMessage:
            "OpenAI API error (429): You exceeded your current quota, please check your plan and billing details.",
        }),
      ),
    ).toMatchObject({ kind: "error", failure: { code: "QUOTA" } });
    expect(
      mapStopReason(
        assistant({
          stopReason: "error",
          errorMessage: "HTTP 500: backend down",
        }),
      ),
    ).toMatchObject({ kind: "error", failure: { code: "SERVER" } });
    expect(
      mapStopReason(
        assistant({ stopReason: "error", errorMessage: "provider timed out" }),
      ),
    ).toMatchObject({ kind: "error", failure: { code: "TIMEOUT" } });
    expect(
      mapStopReason(
        assistant({
          stopReason: "error",
          errorMessage: "ECONNRESET socket closed",
        }),
      ),
    ).toMatchObject({ kind: "error", failure: { code: "TRANSPORT" } });
    expect(
      mapStopReason(
        assistant({
          stopReason: "error",
          errorMessage:
            "HTTP 400: input exceeds the model context window limit",
        }),
      ),
    ).toMatchObject({
      kind: "error",
      failure: { code: CONTEXT_WINDOW_EXCEEDED_CODE },
    });
    expect(
      mapStopReason(
        assistant({
          stopReason: "error",
          errorMessage: "HTTP 400: request too large for model context",
        }),
      ),
    ).toMatchObject({
      kind: "error",
      failure: { code: CONTEXT_WINDOW_EXCEEDED_CODE },
    });
    expect(
      mapStopReason(
        assistant({
          stopReason: "error",
          errorMessage:
            "HTTP 400: invalid input: temperature exceeds maximum allowed value",
        }),
      ),
    ).toMatchObject({ kind: "error", failure: { code: "INVALID_REQUEST" } });
    expect(
      mapStopReason(
        assistant({
          stopReason: "error",
          errorMessage: "HTTP 413: Payload Too Large",
        }),
      ),
    ).toMatchObject({ kind: "error", failure: { code: "INVALID_REQUEST" } });
    expect(
      mapStopReason(
        assistant({
          stopReason: "error",
          errorMessage:
            "Failed to buffer the request body: length limit exceeded",
        }),
      ),
    ).toMatchObject({ kind: "error", failure: { code: "INVALID_REQUEST" } });
    expect(
      mapStopReason(
        assistant({
          stopReason: "error",
          errorMessage: "vector length limit exceeded",
        }),
      ),
    ).toMatchObject({ kind: "error", failure: { code: "PI_AI_ERROR" } });
  });

  it.each([
    "other side closed",
    "HTTP2 request did not get a response",
    "WebSocket closed unexpectedly",
    // undici flattens a mid-stream socket drop to this bare word (its SocketError
    // cause is discarded upstream before it reaches us).
    "terminated",
    "Premature close",
    // pi-ai's per-provider throws when the wire closes before the terminal event.
    "Anthropic stream ended before message_stop",
    "OpenAI Responses stream ended before a terminal response event",
    "openrouter stream ended without a terminal event",
    "Stream ended without finish_reason",
  ])("maps pi-ai transport wording %j", (errorMessage) => {
    expect(
      mapStopReason(assistant({ stopReason: "error", errorMessage })),
    ).toMatchObject({ kind: "error", failure: { code: "TRANSPORT" } });
  });

  it("uses pi-ai provider-specific overflow classification without losing rate-limit exclusions", () => {
    expect(
      mapStopReason(
        assistant({
          stopReason: "error",
          errorMessage: "prompt is too long: 213462 tokens > 200000 maximum",
        }),
      ),
    ).toMatchObject({
      kind: "error",
      failure: { code: CONTEXT_WINDOW_EXCEEDED_CODE },
    });
    expect(
      mapStopReason(
        assistant({
          stopReason: "error",
          errorMessage:
            "ThrottlingException: Too many tokens, rate limit reached",
        }),
      ),
    ).toMatchObject({ kind: "error", failure: { code: "RATE_LIMIT" } });
  });

  it("uses the resolved context window for silent and length-stop overflows", () => {
    // Non-empty content keeps the no-window branch on the successful stop path
    // (an empty stop is EMPTY_RESPONSE, covered above); overflow wins over both.
    const silent = assistant({
      stopReason: "stop",
      usage: usage(101, 0),
      content: [{ type: "text", text: "x" }],
    });
    expect(mapStopReason(silent)).toEqual({ kind: "stop" });
    expect(mapStopReason(silent, 100)).toEqual({
      kind: "error",
      failure: {
        message:
          'pi-ai detected context overflow for model "deepseek-v4-flash"',
        code: CONTEXT_WINDOW_EXCEEDED_CODE,
      },
    });

    const truncated = assistant({
      stopReason: "length",
      usage: usage(80, 0, 19),
    });
    expect(mapStopReason(truncated)).toEqual({ kind: "max-tokens" });
    expect(mapStopReason(truncated, 100)).toMatchObject({
      kind: "error",
      failure: { code: CONTEXT_WINDOW_EXCEEDED_CODE },
    });
  });

  it("maps cache fields only when nonzero", () => {
    expect(mapUsage(usage(10, 5, 8, 2))).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 25,
      cacheReadTokens: 8,
      cacheWriteTokens: 2,
    });
    expect(mapUsage(usage(10, 5))).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
  });
});
