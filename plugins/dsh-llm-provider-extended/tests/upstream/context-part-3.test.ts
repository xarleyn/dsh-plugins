import { describe, expect, it, vi } from "vitest";

import { AttachmentId, ImageVariantId } from "@deepseek-ai/dsh-attachment";

import type {
  AttachmentStore,
  ImageAttachmentRef,
  ImageRequestTarget,
  RequestImageAttachment,
} from "@deepseek-ai/dsh-attachment";

import { createMessage, createUserMessage } from "@deepseek-ai/dsh-llm";

import type {
  ContentBlock,
  GenerateOptions,
  Message,
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
describe("pi-ai system prompt source", () => {
  const base = { provider: "openai", model: "gpt-4.1" };

  const leading = history("system", [
    { type: "text", text: "lead " },
    { type: "text", text: "rule" },
  ]);

  const question = user([{ type: "text", text: "hi" }]);

  it.each<{ label: string; content: ContentBlock[] }>([
    { label: "image-only", content: [{ type: "image", attachment: ref }] },
    {
      label: "text and image",
      content: [
        { type: "text", text: "rule" },
        { type: "image", attachment: ref },
      ],
    },
  ])(
    "rejects a leading system $label on both conversion paths",
    async ({ content }) => {
      const options: GenerateOptions = {
        ...base,
        messages: [history("system", content), question],
      };
      const error = {
        code: "UNSUPPORTED_CONTENT",
        message:
          "pi-ai cannot represent an image in an in-history system message",
      };
      expect(() => toPiContext(options)).toThrow(error.message);
      const readImageRequest = vi.fn();
      await expect(
        toPiContext(options, imageContext(projectionStore(readImageRequest))),
      ).rejects.toMatchObject(error);
      expect(readImageRequest).not.toHaveBeenCalled();
    },
  );

  it("maps a leading system message to systemPrompt on both conversion paths", async () => {
    const options: GenerateOptions = { ...base, messages: [leading, question] };
    const expected = {
      systemPrompt: "lead rule",
      messages: [{ role: "user", content: "hi", timestamp: 0 }],
    };
    expect(toPiContext(options)).toEqual(expected);
    await expect(
      toPiContext(options, imageContext(attachments)),
    ).resolves.toEqual(expected);
    const fromOption: GenerateOptions = {
      ...base,
      system: "lead rule",
      messages: [question],
    };
    expect(toPiContext(options)).toEqual(toPiContext(fromOption));
    expect(await toPiContext(options, imageContext(attachments))).toEqual(
      await toPiContext(fromOption, imageContext(attachments)),
    );
  });

  it("sends no systemPrompt for an empty leading system message on both conversion paths", async () => {
    const options: GenerateOptions = {
      ...base,
      messages: [history("system", []), question],
    };
    const expected = {
      messages: [{ role: "user", content: "hi", timestamp: 0 }],
    };
    expect(toPiContext(options)).toEqual(expected);
    await expect(
      toPiContext(options, imageContext(attachments)),
    ).resolves.toEqual(expected);
  });

  it("folds a non-leading system message into a user message on both conversion paths", async () => {
    const options: GenerateOptions = { ...base, messages: [question, leading] };
    const expected = {
      messages: [
        { role: "user", content: "hi", timestamp: 0 },
        { role: "user", content: "lead rule", timestamp: 0 },
      ],
    };
    expect(toPiContext(options)).toEqual(expected);
    await expect(
      toPiContext(options, imageContext(attachments)),
    ).resolves.toEqual(expected);
  });

  it("lets options.system win over a leading system message, which then folds, on both conversion paths", async () => {
    const options: GenerateOptions = {
      ...base,
      system: "direct",
      messages: [leading, question],
    };
    const expected = {
      systemPrompt: "direct",
      messages: [
        { role: "user", content: "lead rule", timestamp: 0 },
        { role: "user", content: "hi", timestamp: 0 },
      ],
    };
    expect(toPiContext(options)).toEqual(expected);
    await expect(
      toPiContext(options, imageContext(attachments)),
    ).resolves.toEqual(expected);
  });
});
