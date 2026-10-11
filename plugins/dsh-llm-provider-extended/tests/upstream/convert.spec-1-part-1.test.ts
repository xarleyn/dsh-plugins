import { describe, expect, it, vi } from "vitest";

import { AttachmentId, ImageVariantId } from "@deepseek-ai/dsh-attachment";

import type {
  AttachmentStore,
  ImageAttachmentRef,
  ImageRequestTarget,
  RequestImageAttachment,
} from "@deepseek-ai/dsh-attachment";

import {
  createToolResultMessage,
  createUserMessage,
  ToolCallId,
  createMessage,
} from "@deepseek-ai/dsh-llm";

import type { ContentBlock } from "@deepseek-ai/dsh-llm";

import type { AssistantMessage } from "@earendil-works/pi-ai";

import { toPiContext } from "../../src/upstream/context.js";

function requestVersion(ref: ImageAttachmentRef): RequestImageAttachment {
  return {
    variantId: ImageVariantId(`sha256:${"e".repeat(64)}`),
    attachment: ref,
    data: Uint8Array.of(1, 2, 3),
    mediaType: ref.mediaType,
    bytes: 3,
    width: ref.width,
    height: ref.height,
    depth: "uchar",
    space: "srgb",
    hasAlpha: true,
  };
}

function attachmentStore(
  readImageRequest: (
    ref: ImageAttachmentRef,
    policy: ImageRequestTarget,
    signal?: AbortSignal,
  ) => Promise<RequestImageAttachment>,
): AttachmentStore {
  return {
    readImageRequest,
    imageHostPath: () => undefined,
  } as unknown as AttachmentStore;
}

function imageContext(attachments: AttachmentStore) {
  return { attachments, resolveImageAccess: () => undefined };
}
describe("toPiContext", () => {
  /** Convert with the given state and assert the message degraded to foreign with the given reason. */

  it("maps system prompt, user text, and tools", () => {
    const context = toPiContext({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      system: "be helpful",
      messages: [
        createUserMessage({
          content: [{ type: "text", text: "hi" }],
          source: { kind: "test" },
        }),
      ],
      tools: [
        {
          name: "f",
          description: "F",
          parameters: { type: "object", properties: {} },
        },
      ],
    });
    expect(context.systemPrompt).toBe("be helpful");
    expect(context.messages).toEqual([
      { role: "user", content: "hi", timestamp: 0 },
    ]);
    expect(context.tools).toEqual([
      {
        name: "f",
        description: "F",
        parameters: { type: "object", properties: {} },
      },
    ]);
  });

  it("omits empty tools and absent system prompt", () => {
    const context = toPiContext({
      provider: "deepseek",
      model: "m",
      messages: [],
      tools: [],
    });
    expect(context.systemPrompt).toBeUndefined();
    expect(context.tools).toBeUndefined();
  });

  it("resolves durable image references into native pi-ai image content", async () => {
    const attachment = {
      attachmentId: AttachmentId(`sha256:${"a".repeat(64)}`),
      mediaType: "image/png" as const,
      bytes: 3,
      width: 1,
      height: 1,
    };
    const readImageRequest = vi.fn(
      (value: ImageAttachmentRef, _target: ImageRequestTarget) =>
        Promise.resolve(requestVersion(value)),
    );
    const context = await toPiContext(
      {
        provider: "openai",
        model: "gpt-4.1",
        messages: [
          createUserMessage({
            content: [
              { type: "text", text: "describe" },
              { type: "image", attachment },
            ],
            source: { kind: "test" },
          }),
        ],
      },
      imageContext(attachmentStore(readImageRequest)),
    );

    expect(readImageRequest).toHaveBeenCalledWith(
      attachment,
      { width: 1, height: 1, maxBytes: 1024 * 1024 },
      undefined,
    );
    expect(context.messages[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "describe" },
        {
          type: "text",
          text: expect.stringContaining(
            `Image ${attachment.attachmentId}`,
          ) as string,
        },
        { type: "image", data: "AQID", mimeType: "image/png" },
      ],
      timestamp: 0,
    });
  });

  it("converts a tool message with text and images on the image path", async () => {
    const attachment = {
      attachmentId: AttachmentId(`sha256:${"c".repeat(64)}`),
      mediaType: "image/png" as const,
      bytes: 3,
      width: 1,
      height: 1,
    };
    const readImageRequest = vi.fn(
      (value: ImageAttachmentRef, _target: ImageRequestTarget) =>
        Promise.resolve(requestVersion(value)),
    );
    const context = await toPiContext(
      {
        provider: "openai",
        model: "gpt-4.1",
        messages: [
          createToolResultMessage({
            callId: ToolCallId("outer"),
            content: [
              { type: "text", text: "before" },
              { type: "text", text: "middle" },
              { type: "image", attachment },
              { type: "text", text: "after" },
            ],
            isError: false,
          }),
        ],
      },
      imageContext(attachmentStore(readImageRequest)),
    );

    expect(context.messages).toEqual([
      {
        role: "toolResult",
        toolCallId: "outer",
        toolName: "unknown",
        content: [
          { type: "text", text: "before" },
          { type: "text", text: "middle" },
          {
            type: "text",
            text: expect.stringContaining(
              `Image ${attachment.attachmentId}`,
            ) as string,
          },
          { type: "image", data: "AQID", mimeType: "image/png" },
          { type: "text", text: "after" },
        ],
        isError: false,
        timestamp: 0,
      },
    ]);
  });

  it("rejects structured image history when no durable resolver is supplied", () => {
    expect(() =>
      toPiContext({
        provider: "openai",
        model: "gpt-4.1",
        messages: [
          createUserMessage({
            content: [
              {
                type: "image",
                attachment: {
                  attachmentId: AttachmentId(`sha256:${"b".repeat(64)}`),
                  mediaType: "image/png",
                  bytes: 1,
                  width: 1,
                  height: 1,
                },
              },
            ],
            source: { kind: "test" },
          }),
        ],
      }),
    ).toThrow(expect.objectContaining({ code: "UNSUPPORTED_CONTENT" }));
  });

  it("maps assistant text/reasoning/tool-call blocks", () => {
    const context = toPiContext({
      provider: "deepseek",
      model: "m",
      messages: [
        createMessage({
          role: "assistant",
          content: [
            { type: "reasoning", text: "hmm" },
            { type: "text", text: "calling" },
            {
              type: "tool-call",
              id: ToolCallId("c1"),
              name: "f",
              arguments: '{"a":1}',
            },
          ],
          source: { kind: "model", provider: "deepseek", model: "m" },
        }),
      ],
    });
    const message = context.messages[0] as AssistantMessage;
    expect(message.role).toBe("assistant");
    expect(message.stopReason).toBe("toolUse");
    expect(message.content).toEqual([
      { type: "thinking", thinking: "hmm" },
      { type: "text", text: "calling" },
      { type: "toolCall", id: "c1", name: "f", arguments: { a: 1 } },
    ]);
  });

  it("marks tool-call-free assistant messages with stopReason stop", () => {
    const context = toPiContext({
      provider: "deepseek",
      model: "m",
      messages: [
        createMessage({
          role: "assistant",
          content: [{ type: "text", text: "done" }],
          source: { kind: "model", provider: "deepseek", model: "m" },
        }),
      ],
    });
    expect((context.messages[0] as AssistantMessage).stopReason).toBe("stop");
  });

  it("preserves provider and model for foreign assistant messages without replay state", () => {
    const context = toPiContext({
      provider: "openai",
      model: "new-model",
      messages: [
        createMessage({
          role: "assistant",
          content: [{ type: "text", text: "done" }],
          source: { kind: "model", provider: "deepseek", model: "old-model" },
        }),
      ],
    });
    expect(context.messages[0]).toMatchObject({
      role: "assistant",
      api: "dsh-foreign",
      provider: "deepseek",
      model: "old-model",
    });
  });

  it("parses malformed tool-call arguments to {}", () => {
    const context = toPiContext({
      provider: "deepseek",
      model: "m",
      messages: [
        createMessage({
          role: "assistant",
          content: [
            {
              type: "tool-call",
              id: ToolCallId("c1"),
              name: "f",
              arguments: "{broken",
            },
          ],
          source: { kind: "model", provider: "deepseek", model: "m" },
        }),
      ],
    });
    const message = context.messages[0] as AssistantMessage;
    expect(message.content[0]).toEqual({
      type: "toolCall",
      id: "c1",
      name: "f",
      arguments: {},
    });
  });

  it("parses non-object argument JSON (arrays, scalars) to {}", () => {
    const context = toPiContext({
      provider: "deepseek",
      model: "m",
      messages: [
        createMessage({
          role: "assistant",
          content: [
            {
              type: "tool-call",
              id: ToolCallId("c1"),
              name: "f",
              arguments: "[1,2]",
            },
          ],
          source: { kind: "model", provider: "deepseek", model: "m" },
        }),
      ],
    });
    expect((context.messages[0] as AssistantMessage).content[0]).toMatchObject({
      arguments: {},
    });
  });

  it("recovers toolName for tool results from the preceding assistant call", () => {
    const context = toPiContext({
      provider: "deepseek",
      model: "m",
      messages: [
        createMessage({
          role: "assistant",
          content: [
            {
              type: "tool-call",
              id: ToolCallId("c1"),
              name: "get_weather",
              arguments: "{}",
            },
          ],
          source: { kind: "model", provider: "deepseek", model: "m" },
        }),
        createToolResultMessage({
          callId: ToolCallId("c1"),
          content: [
            { type: "text", text: "Sunny" },
            { type: "text", text: "!" },
            { type: "chart", data: "ignored" } as unknown as ContentBlock,
          ],
          isError: false,
        }),
      ],
    });
    expect(context.messages[1]).toEqual({
      role: "toolResult",
      toolCallId: "c1",
      toolName: "get_weather",
      content: [{ type: "text", text: "Sunny!" }],
      isError: false,
      timestamp: 0,
    });
  });

  it("labels unmatched tool results with toolName unknown and keeps isError", () => {
    const context = toPiContext({
      provider: "deepseek",
      model: "m",
      messages: [
        createToolResultMessage({
          callId: ToolCallId("zz"),
          content: [],
          isError: true,
        }),
      ],
    });
    expect(context.messages[0]).toMatchObject({
      role: "toolResult",
      toolName: "unknown",
      isError: true,
      content: [{ type: "text", text: "(no output)" }],
    });
  });

  it("splits mixed user text + tool results and lifts a leading system message into systemPrompt", () => {
    const context = toPiContext({
      provider: "deepseek",
      model: "m",
      messages: [
        createMessage({
          role: "system",
          content: [{ type: "text", text: "rule" }],
          source: { kind: "system-prompt" },
        }),
        createUserMessage({
          content: [{ type: "text", text: "note" }],
          source: { kind: "model", provider: "deepseek", model: "m" },
        }),
        createToolResultMessage({
          callId: ToolCallId("c1"),
          content: [{ type: "text", text: "ok" }],
          isError: false,
        }),
      ],
    });
    expect(context.systemPrompt).toBe("rule");
    expect(context.messages.map((message) => message.role)).toEqual([
      "user",
      "toolResult",
    ]);
  });

  it("skips plugin-added (unknown) blocks in assistant content", () => {
    const context = toPiContext({
      provider: "deepseek",
      model: "m",
      messages: [
        createMessage({
          role: "assistant",
          content: [
            { type: "chart", data: "x" } as unknown as ContentBlock,
            { type: "text", text: "visible" },
          ],
          source: { kind: "model", provider: "deepseek", model: "m" },
        }),
      ],
    });
    expect((context.messages[0] as AssistantMessage).content).toEqual([
      { type: "text", text: "visible" },
    ]);
  });
});
