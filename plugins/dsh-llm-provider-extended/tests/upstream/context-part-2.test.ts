import { describe, expect, it, vi } from "vitest";

import { AttachmentId, ImageVariantId } from "@deepseek-ai/dsh-attachment";

import type {
  AttachmentStore,
  ImageAttachmentRef,
  ImageRequestTarget,
  RequestImageAttachment,
} from "@deepseek-ai/dsh-attachment";

import {
  ToolCallId,
  createAssistantMessage,
  createMessage,
  createToolResultMessage,
  createUserMessage,
  offloadedImageText,
} from "@deepseek-ai/dsh-llm";

import type {
  ContentBlock,
  GenerateOptions,
  Message,
} from "@deepseek-ai/dsh-llm";

import type { ContextFormed } from "@deepseek-ai/dsh-llm";

import { toPiContext } from "../../src/upstream/context.js";

import type { PiImageRequestContext } from "../../src/upstream/context.js";

import { toPiAssistant } from "../../src/upstream/replay.js";

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
  it("projects surface-offloaded occurrences to placeholders and prepares only retained ones", async () => {
    const readImageRequest = vi.fn((value: ImageAttachmentRef) =>
      Promise.resolve(requestImage(value, Uint8Array.of(1, 2, 3))),
    );
    const store = projectionStore(readImageRequest);
    const sized: ImageAttachmentRef = { ...ref, bytes: 3 };
    const callId = ToolCallId("shot-call");
    // The tool-result occurrence is offloaded on the surface; the two retained 3-byte images cost
    // 4 base64 characters each and fit the 8-byte bound exactly.
    const context = await toPiContext(
      request([
        createToolResultMessage({
          callId,
          content: [{ type: "image", attachment: sized, offloaded: true }],
          isError: false,
        }),
        user([
          { type: "image", attachment: sized },
          { type: "text", text: "newer" },
        ]),
        user([{ type: "image", attachment: sized }]),
      ]),
      imageContext(store, { maxRequestImageBytes: 8 }),
    );

    expect(context.messages).toEqual([
      {
        role: "toolResult",
        toolCallId: "shot-call",
        toolName: "unknown",
        content: [{ type: "text", text: offloadedImageText(sized) }],
        isError: false,
        timestamp: 0,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: expect.stringContaining(
              `Image ${sized.attachmentId}`,
            ) as string,
          },
          { type: "image", data: "AQID", mimeType: "image/png" },
          { type: "text", text: "newer" },
        ],
        timestamp: 0,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: expect.stringContaining(
              `Image ${sized.attachmentId}`,
            ) as string,
          },
          { type: "image", data: "AQID", mimeType: "image/png" },
        ],
        timestamp: 0,
      },
    ]);
    expect(readImageRequest).toHaveBeenCalledTimes(1);
  });

  it("does not prepare a surface-offloaded image", async () => {
    const old = {
      ...ref,
      attachmentId: AttachmentId(`sha256:${"c".repeat(64)}`),
      bytes: 3,
    };
    const recent = {
      ...ref,
      attachmentId: AttachmentId(`sha256:${"d".repeat(64)}`),
      bytes: 3,
    };
    const readImageRequest = vi.fn((value: ImageAttachmentRef) => {
      if (value.attachmentId === old.attachmentId)
        throw new Error("old image must not be read");
      return Promise.resolve(requestImage(value, Uint8Array.of(1, 2, 3)));
    });

    const context = await toPiContext(
      request([
        user([
          { type: "image", attachment: old, offloaded: true },
          { type: "image", attachment: recent },
        ]),
      ]),
      imageContext(projectionStore(readImageRequest), {
        maxRequestImageBytes: 4,
      }),
    );

    expect(context.messages[0]).toMatchObject({
      role: "user",
      content: [
        { type: "text", text: offloadedImageText(old) },
        {
          type: "text",
          text: expect.stringContaining(String(recent.attachmentId)) as string,
        },
        { type: "image" },
      ],
    });
    expect(readImageRequest).toHaveBeenCalledTimes(1);
    expect(readImageRequest.mock.calls[0]?.[0]).toEqual(recent);
  });

  it("fails with the count to offload when exact encoded bytes exceed the bound", async () => {
    const sized: ImageAttachmentRef = { ...ref, bytes: 3 };
    const readImageRequest = vi.fn((value: ImageAttachmentRef) =>
      Promise.resolve({
        ...requestImage(value, Uint8Array.of(1, 2, 3, 4)),
      }),
    );

    await expect(
      toPiContext(
        request([user([{ type: "image", attachment: sized }])]),
        imageContext(projectionStore(readImageRequest), {
          maxRequestImageBytes: 4,
        }),
      ),
    ).rejects.toMatchObject({
      code: "IMAGE_OFFLOAD_REQUIRED",
      failure: { offloadImages: 1 },
    });
    expect(readImageRequest).toHaveBeenCalledTimes(1);
  });

  it("renders an offloaded occurrence with independently resolved access", async () => {
    const sized: ImageAttachmentRef = { ...ref, bytes: 3 };
    const access = { readonlyPath: "/tmp/dsh-normalized-image" };
    const readImageRequest = vi.fn();

    const context = await toPiContext(
      request([user([{ type: "image", attachment: sized, offloaded: true }])]),
      imageContext(projectionStore(readImageRequest), {
        maxRequestImageBytes: 4,
        resolveImageAccess: () => access,
      }),
    );

    expect(context.messages).toEqual([
      {
        role: "user",
        content: offloadedImageText(sized, access),
        timestamp: 0,
      },
    ]);
    expect(readImageRequest).not.toHaveBeenCalled();
  });

  it("keeps every image at exactly the payload bound and rejects a single image that cannot fit", async () => {
    const sized: ImageAttachmentRef = { ...ref, bytes: 3 };
    const exact = await toPiContext(
      request([
        user([{ type: "image", attachment: sized }]),
        user([{ type: "image", attachment: sized }]),
      ]),
      imageContext(attachments, { maxRequestImageBytes: 8 }),
    );
    expect(exact.messages).toEqual([
      {
        role: "user",
        content: [
          expect.objectContaining({ type: "text" }),
          expect.objectContaining({ type: "image" }),
        ],
        timestamp: 0,
      },
      {
        role: "user",
        content: [
          expect.objectContaining({ type: "text" }),
          expect.objectContaining({ type: "image" }),
        ],
        timestamp: 0,
      },
    ]);

    const readImageRequest = vi.fn((value: ImageAttachmentRef) =>
      Promise.resolve(requestImage(value, new Uint8Array(300))),
    );
    const store = projectionStore(readImageRequest);
    await expect(
      toPiContext(
        request([
          user([{ type: "image", attachment: { ...ref, bytes: 300 } }]),
        ]),
        imageContext(store, { maxRequestImageBytes: 8 }),
      ),
    ).rejects.toMatchObject({
      code: "IMAGE_OFFLOAD_REQUIRED",
      failure: { offloadImages: 1 },
    });
  });

  it("projects repeated image-block occurrences by their own surface mark", async () => {
    const sized: ImageAttachmentRef = { ...ref, bytes: 3 };
    const shared: ContentBlock = { type: "image", attachment: sized };
    const readImageRequest = vi.fn((value: ImageAttachmentRef) =>
      Promise.resolve(requestImage(value, Uint8Array.of(1, 2, 3))),
    );
    const store = projectionStore(readImageRequest);
    const aliased = await toPiContext(
      request([user([{ ...shared, offloaded: true }, shared])]),
      imageContext(store, { maxRequestImageBytes: 4 }),
    );
    const replayed = await toPiContext(
      request([
        user([
          { type: "image", attachment: { ...sized }, offloaded: true },
          { type: "image", attachment: { ...sized } },
        ]),
      ]),
      imageContext(store, { maxRequestImageBytes: 4 }),
    );

    const expected = [
      {
        role: "user",
        content: [
          { type: "text", text: offloadedImageText(sized) },
          {
            type: "text",
            text: expect.stringContaining(
              `Image ${sized.attachmentId}`,
            ) as string,
          },
          { type: "image", data: "AQID", mimeType: "image/png" },
        ],
        timestamp: 0,
      },
    ];
    expect(aliased.messages).toEqual(expected);
    expect(replayed.messages).toEqual(expected);
    expect(readImageRequest).toHaveBeenCalledTimes(2);
  });

  it("keeps empty text-only users while separating result-only messages", () => {
    const callId = ToolCallId("unknown-call");
    expect(
      toPiContext(
        request([
          user([]),
          history("assistant", [
            { type: "text", text: "answer" },
            {
              type: "tool-call",
              id: ToolCallId("other-call"),
              name: "lookup",
              arguments: "{}",
            },
          ]),
          createToolResultMessage({
            callId,
            content: [{ type: "text", text: "result" }],
            isError: false,
          }),
        ]),
      ),
    ).toMatchObject({
      messages: [
        { role: "user", content: "" },
        { role: "assistant" },
        { role: "toolResult", toolName: "unknown" },
      ],
    });
  });

  it("handles in-history system and assistant messages explicitly on the image path", async () => {
    for (const role of ["system", "assistant"] as const) {
      const readImageRequest = vi.fn();
      const store = projectionStore(readImageRequest);
      await expect(
        toPiContext(
          request([history(role, [{ type: "image", attachment: ref }])]),
          imageContext(store, { maxRequestImageBytes: 1 }),
        ),
      ).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT" });
      expect(readImageRequest).not.toHaveBeenCalled();
    }

    await expect(
      toPiContext(
        request([
          history("system", [{ type: "text", text: "history system" }]),
          history("assistant", [{ type: "text", text: "answer" }]),
          user([{ type: "text", text: "plain" }]),
        ]),
        imageContext(attachments),
      ),
    ).resolves.toMatchObject({
      messages: [
        { role: "user", content: "history system" },
        { role: "assistant" },
        { role: "user", content: "plain" },
      ],
    });

    expect(() =>
      toPiAssistant(
        createAssistantMessage({
          content: [{ type: "image", attachment: ref }],
          source: { provider: "openai", model: "gpt-4.1" },
        }),
      ),
    ).toThrow(/assistant image output/);
  });
});
