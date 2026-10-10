import { describe, expect, it, vi } from "vitest";

import { AttachmentId, ImageVariantId } from "@deepseek-ai/dsh-attachment";

import type {
  AttachmentStore,
  ImageAttachmentRef,
  ImageRequestTarget,
  RequestImageAttachment,
} from "@deepseek-ai/dsh-attachment";

import {
  createDeveloperMessage,
  ToolCallId,
  createMessage,
  createToolResultMessage,
  createUserMessage,
} from "@deepseek-ai/dsh-llm";

import type {
  ContentBlock,
  GenerateOptions,
  Message,
  RequestUserInput,
} from "@deepseek-ai/dsh-llm";

import type { ContextFormed } from "@deepseek-ai/dsh-llm";

import { toPiContext } from "../../src/upstream/context.js";

import type { PiImageRequestContext } from "../../src/upstream/context.js";

declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    test: { kind: "test" } & ContextFormed;
  }
}

const ref: ImageAttachmentRef = {
  attachmentId: AttachmentId(`sha256:${"a".repeat(64)}`),
  mediaType: "image/png",
  bytes: 1,
  width: 1,
  height: 1,
};

function requestImage(
  value: ImageAttachmentRef,
  data: Uint8Array,
): RequestImageAttachment {
  return {
    variantId: ImageVariantId(`sha256:${"b".repeat(64)}`),
    attachment: value,
    data,
    mediaType: value.mediaType,
    bytes: data.byteLength,
    width: value.width,
    height: value.height,
    depth: "uchar",
    space: "srgb",
    hasAlpha: value.mediaType === "image/png",
  };
}

function projectionStore(
  readImageRequest: (
    value: ImageAttachmentRef,
    target: ImageRequestTarget,
    signal?: AbortSignal,
  ) => Promise<RequestImageAttachment> = vi.fn((value: ImageAttachmentRef) =>
    Promise.resolve(requestImage(value, Uint8Array.of(1))),
  ),
): AttachmentStore {
  return {
    readImageRequest,
    imageHostPath: () => undefined,
  } as unknown as AttachmentStore;
}

const attachments = projectionStore();

function imageContext(
  store: AttachmentStore,
  overrides: Partial<Omit<PiImageRequestContext, "attachments">> = {},
): PiImageRequestContext {
  return {
    attachments: store,
    resolveImageAccess: () => undefined,
    ...overrides,
  };
}

function request(messages: GenerateOptions["messages"]): GenerateOptions {
  return {
    provider: "openai",
    model: "gpt-4.1",
    system: "system prompt",
    tools: [
      {
        name: "lookup",
        description: "look up",
        parameters: { type: "object" },
      },
    ],
    messages,
  };
}

function user(content: ContentBlock[]): Message {
  return createUserMessage({ content, source: { kind: "test" } });
}

function history(
  role: "system" | "assistant",
  content: ContentBlock[],
): Message {
  return role === "system"
    ? createMessage({ role, content, source: { kind: "system-prompt" } })
    : createMessage({
        role,
        content,
        source: { kind: "model", provider: "openai", model: "gpt-4.1" },
      });
}
describe("pi-ai request context conversion", () => {
  it.each(["user", "system", "assistant", "tool"] as const)(
    "rejects tool-change blocks in %s history",
    (role) => {
      for (const type of ["tool-addition", "tool-removal"] as const) {
        const message = {
          id: "invalid",
          role,
          source: { kind: "test" },
          content: [{ type, toolName: "search" }],
        } as unknown as Message;
        expect(() => toPiContext(request([message]))).toThrow(
          expect.objectContaining({ code: "UNSUPPORTED_CONTENT" }),
        );
      }
    },
  );

  it("rejects deferred tool definitions until provider loading is implemented", () => {
    expect(() =>
      toPiContext({
        ...request([]),
        tools: [
          {
            name: "search",
            description: "",
            parameters: {},
            deferLoading: true,
          },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: "UNSUPPORTED_CONTENT" }));
  });

  it("preserves the exact context for request-only input after durable tool history", async () => {
    const prefix = [
      history("assistant", [
        {
          type: "tool-call",
          id: ToolCallId("lookup"),
          name: "lookup",
          arguments: "{}",
        },
      ]),
      createToolResultMessage({
        callId: ToolCallId("lookup"),
        content: [{ type: "text", text: "result" }],
        isError: false,
      }),
    ];
    const input: RequestUserInput = {
      role: "user",
      content: [{ type: "text", text: "review or summarize this input" }],
    };
    const durable = createUserMessage({
      content: input.content,
      source: { kind: "test" },
    });
    expect(toPiContext(request([...prefix, input]))).toEqual(
      toPiContext(request([...prefix, durable])),
    );
    const withImage: RequestUserInput = {
      role: "user",
      content: [
        { type: "text", text: "before" },
        { type: "image", attachment: ref },
        { type: "text", text: "after" },
      ],
    };
    const durableImage = createUserMessage({
      content: withImage.content,
      source: { kind: "test" },
    });
    expect(
      await toPiContext(
        request([...prefix, withImage]),
        imageContext(attachments),
      ),
    ).toEqual(
      await toPiContext(
        request([...prefix, durableImage]),
        imageContext(attachments),
      ),
    );
    expect(withImage).not.toHaveProperty("id");
    expect(withImage).not.toHaveProperty("source");
  });

  it("rejects developer history before reading image attachments", async () => {
    const read = vi.fn((value: ImageAttachmentRef) =>
      Promise.resolve(requestImage(value, Uint8Array.of(1))),
    );
    const message = createDeveloperMessage({
      content: [{ type: "tool-addition", toolName: "search" }],
      source: { kind: "test" },
    });
    const failure = {
      code: "UNSUPPORTED_CONTENT",
      message: "Developer messages are not supported yet",
    };
    expect(() => toPiContext(request([message]))).toThrow(
      expect.objectContaining(failure),
    );
    await expect(
      toPiContext(request([message]), imageContext(projectionStore(read))),
    ).rejects.toMatchObject(failure);
    expect(read).not.toHaveBeenCalled();
  });

  it("omits absent and empty request-level optional fields", () => {
    const base = { provider: "openai", model: "gpt-4.1", messages: [] };
    expect(toPiContext(base)).toEqual({ messages: [] });
    expect(toPiContext({ ...base, tools: [] })).toEqual({ messages: [] });
  });

  it("converts complete text-only history and rejects tool images without storage", () => {
    const callId = ToolCallId("call-1");
    expect(
      toPiContext(
        request([
          history("system", [{ type: "text", text: "history system" }]),
          history("assistant", [
            { type: "tool-call", id: callId, name: "lookup", arguments: "{}" },
          ]),
          user([{ type: "text", text: "after tool" }]),
          createToolResultMessage({
            callId,
            content: [{ type: "text", text: "" }],
            isError: false,
          }),
        ]),
      ),
    ).toMatchObject({
      systemPrompt: "system prompt",
      tools: [{ name: "lookup" }],
      messages: [
        { role: "user", content: "history system" },
        { role: "assistant" },
        { role: "user", content: "after tool" },
        {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "lookup",
          content: [{ type: "text", text: "(no output)" }],
          isError: false,
        },
      ],
    });

    expect(() =>
      toPiContext(
        request([
          createToolResultMessage({
            callId,
            content: [{ type: "image", attachment: ref }],
            isError: false,
          }),
        ]),
      ),
    ).toThrow(/durable attachment service/);
  });

  it("resolves user and tool-result images while preserving explicit fallbacks", async () => {
    const callId = ToolCallId("missing-call");
    const knownCallId = ToolCallId("known-call");
    const context = await toPiContext(
      request([
        user([{ type: "text", text: "" }]),
        history("assistant", [
          { type: "text", text: "calling" },
          {
            type: "tool-call",
            id: knownCallId,
            name: "lookup",
            arguments: "{}",
          },
        ]),
        user([
          { type: "image", attachment: ref },
          { type: "text", text: "caption" },
          { type: "reasoning", text: "ignored" },
        ]),
        createToolResultMessage({
          callId: knownCallId,
          content: [{ type: "text", text: "" }],
          isError: false,
        }),
        createToolResultMessage({
          callId,
          content: [{ type: "image", attachment: ref }],
          isError: true,
        }),
      ]),
      imageContext(attachments),
    );

    expect(context.messages).toEqual([
      { role: "user", content: "", timestamp: 0 },
      expect.objectContaining({ role: "assistant" }),
      {
        role: "user",
        content: [
          {
            type: "text",
            text: expect.stringContaining(
              `Image ${ref.attachmentId}`,
            ) as string,
          },
          { type: "image", data: "AQ==", mimeType: "image/png" },
          { type: "text", text: "caption" },
        ],
        timestamp: 0,
      },
      {
        role: "toolResult",
        toolCallId: "known-call",
        toolName: "lookup",
        content: [{ type: "text", text: "(no output)" }],
        isError: false,
        timestamp: 0,
      },
      {
        role: "toolResult",
        toolCallId: "missing-call",
        toolName: "unknown",
        content: [
          {
            type: "text",
            text: expect.stringContaining(
              `Image ${ref.attachmentId}`,
            ) as string,
          },
          { type: "image", data: "AQ==", mimeType: "image/png" },
        ],
        isError: true,
        timestamp: 0,
      },
    ]);
  });

  it("uses the shared normalized-path description for retained images", async () => {
    const named = { ...ref, name: "chart.png", width: 2048, height: 1024 };
    const store = projectionStore((value) =>
      Promise.resolve({
        ...requestImage(value, Uint8Array.of(1)),
        width: 1130,
        height: 565,
      }),
    );
    const context = await toPiContext(
      request([user([{ type: "image", attachment: named }])]),
      imageContext(store, {
        resolveImageAccess: () => ({
          readonlyPath: "/tmp/dsh/objects/aa/object",
        }),
      }),
    );
    expect(context.messages[0]).toMatchObject({
      role: "user",
      content: [
        {
          type: "text",
          text: expect.stringContaining('Image "chart.png"') as string,
        },
        { type: "image" },
      ],
    });
    expect(JSON.stringify(context.messages[0])).toContain(
      "/tmp/dsh/objects/aa/object",
    );
    expect(JSON.stringify(context.messages[0])).toContain(
      "request preview 1130x565px",
    );
  });

  it("treats a tool message without isError as a successful result", () => {
    const callId = ToolCallId("default-success");
    const message = createMessage({
      role: "tool",
      source: { kind: "tool", callId },
      toolCallId: callId,
      content: [{ type: "text", text: "result" }],
    });
    expect(toPiContext(request([message])).messages).toEqual([
      {
        role: "toolResult",
        toolCallId: callId,
        toolName: "unknown",
        content: [{ type: "text", text: "result" }],
        isError: false,
        timestamp: 0,
      },
    ]);
  });

  it("converts tool text and images on the image path", async () => {
    const callId = ToolCallId("nested-call");
    const context = await toPiContext(
      request([
        createToolResultMessage({
          callId,
          content: [
            { type: "text", text: "nested text" },
            { type: "image", attachment: ref },
          ],
          isError: false,
        }),
      ]),
      imageContext(attachments),
    );

    expect(context.messages).toEqual([
      {
        role: "toolResult",
        toolCallId: "nested-call",
        toolName: "unknown",
        content: [
          { type: "text", text: "nested text" },
          {
            type: "text",
            text: expect.stringContaining(
              `Image ${ref.attachmentId}`,
            ) as string,
          },
          { type: "image", data: "AQ==", mimeType: "image/png" },
        ],
        isError: false,
        timestamp: 0,
      },
    ]);
  });

  it("flattens tool text and ignores other block types without storage", () => {
    const callId = ToolCallId("nested-text");
    expect(
      toPiContext(
        request([
          createToolResultMessage({
            callId,
            content: [
              { type: "chart", data: "ignored" } as unknown as ContentBlock,
              { type: "text", text: "nested" },
            ],
            isError: false,
          }),
        ]),
      ),
    ).toMatchObject({
      messages: [
        {
          role: "toolResult",
          content: [{ type: "text", text: "nested" }],
        },
      ],
    });
  });
});
