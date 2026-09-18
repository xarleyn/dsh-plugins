import type { Context } from "@deepseek-ai/cordis";
import type {
  AttachmentStore,
  ImageAttachmentRef,
} from "@deepseek-ai/dsh-attachment";
import { AttachmentError } from "@deepseek-ai/dsh-attachment";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import { describe, expect, it, vi } from "vitest";

import {
  createFetchImageTool,
  FETCH_IMAGE_TOOL_NAME,
  type ImageDownloader,
} from "../src/tools/fetch-image.js";
import { PNG_BYTES } from "./images.test.js";

const IMAGE_URL = "https://jira.example.corp/secure/attachment/42/screen.png";

function execution(model?: string): ToolRunContext {
  return {
    name: FETCH_IMAGE_TOOL_NAME,
    arguments: {},
    signal: new AbortController().signal,
    callId: "call_test" as never,
    rootCallId: "call_test" as never,
    token: "token_test" as never,
    agent: {
      session: { id: "session-test" },
      options: {
        provider: "test-provider",
        ...(model === undefined ? {} : { model }),
      },
    } as never,
    deferContext: () => undefined,
    concludeTurn: () => undefined,
  };
}

/** A route whose model declares image input, or does not. */
function context(acceptsImages: boolean): Context {
  return {
    get: (key: string) =>
      key === "llm"
        ? {
            resolveModelInfo: async () => ({
              inputModalities: acceptsImages ? ["text", "image"] : ["text"],
            }),
          }
        : undefined,
  } as unknown as Context;
}

function attachments(options: {
  readonly saveImage?: AttachmentStore["saveImage"];
}): AttachmentStore {
  return {
    imageLimits: {
      maxImageBytes: 4 * 1024 * 1024,
      maxImagesPerMessage: 4,
      maxMessageImageBytes: 8 * 1024 * 1024,
      maxImagePixels: 20_000_000,
      maxImageDimension: 8000,
      mediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
    },
    saveImage:
      options.saveImage ??
      (async (input) =>
        ({
          attachmentId: "sha256:test",
          mediaType: input.mediaType,
          bytes: input.data.byteLength,
          width: 1,
          height: 1,
        }) as ImageAttachmentRef),
  } as unknown as AttachmentStore;
}

function downloader(
  fetchImage: ImageDownloader["fetchImage"],
): ImageDownloader {
  return { fetchImage };
}

function image(bytes = PNG_BYTES) {
  return {
    url: IMAGE_URL,
    statusCode: 200,
    mediaType: "image/png" as const,
    bytes,
    name: "screen.png",
  };
}

describe("web_fetch_image tool", () => {
  it("downloads the image, stores it, and renders it as an image block", async () => {
    const store = attachments({});
    const tool = createFetchImageTool({
      ctx: context(true),
      downloader: downloader(async () => image()),
      attachments: store,
    });
    expect(tool.name).toBe(FETCH_IMAGE_TOOL_NAME);
    expect(tool.description.length).toBeGreaterThan(20);

    const value = (await tool.execute(
      { url: IMAGE_URL },
      execution("vision"),
    )) as {
      url: string;
      mediaType: string;
      bytes: number;
      name: string;
      attachment: unknown;
    };
    expect(value.mediaType).toBe("image/png");
    expect(value.bytes).toBe(PNG_BYTES.byteLength);
    expect(value.name).toBe("screen.png");

    const rendered = tool.output.render({ url: IMAGE_URL }, value as never);
    expect(rendered[0]).toMatchObject({ type: "text" });
    expect(rendered[1]).toMatchObject({ type: "image" });
    // The text names the download; the image block carries the durable reference.
    expect((rendered[0] as { text: string }).text).toContain(IMAGE_URL);
    expect((rendered[1] as { attachment: unknown }).attachment).toBe(
      value.attachment,
    );
  });

  it("passes the deployment's per-message byte budget to the downloader", async () => {
    const fetchImage = vi.fn(async () => image());
    const tool = createFetchImageTool({
      ctx: context(true),
      downloader: downloader(fetchImage),
      attachments: attachments({}),
    });
    await tool.execute({ url: IMAGE_URL }, execution("vision"));
    expect(fetchImage).toHaveBeenCalledWith(
      { url: IMAGE_URL },
      expect.objectContaining({ maxBytes: 4 * 1024 * 1024 }),
    );
  });

  it("refuses a route whose model does not accept image input", async () => {
    const fetchImage = vi.fn(async () => image());
    const tool = createFetchImageTool({
      ctx: context(false),
      downloader: downloader(fetchImage),
      attachments: attachments({}),
    });
    await expect(
      tool.execute({ url: IMAGE_URL }, execution("text-only")),
    ).rejects.toThrow(/does not declare image input/u);
    // The refusal happens before any download, so no bytes are fetched twice.
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it("refuses an empty url", async () => {
    const tool = createFetchImageTool({
      ctx: context(true),
      downloader: downloader(async () => image()),
      attachments: attachments({}),
    });
    await expect(
      tool.execute({ url: "   " }, execution("vision")),
    ).rejects.toThrow(/url must be a non-empty string/u);
  });

  it("explains a storage refusal instead of leaking the raw error", async () => {
    const tool = createFetchImageTool({
      ctx: context(true),
      downloader: downloader(async () => image(new Uint8Array(10))),
      attachments: attachments({
        saveImage: async () => {
          throw new AttachmentError("too big", "IMAGE_TOO_LARGE");
        },
      }),
    });
    await expect(
      tool.execute({ url: IMAGE_URL }, execution("vision")),
    ).rejects.toThrow(/byte limits/u);
  });

  it("refuses a format this deployment does not accept", async () => {
    const tool = createFetchImageTool({
      ctx: context(true),
      downloader: downloader(async () => image()),
      attachments: {
        ...attachments({}),
        imageLimits: {
          maxImageBytes: 1024,
          maxImagesPerMessage: 4,
          maxMessageImageBytes: 1024,
          maxImagePixels: 1000,
          maxImageDimension: 100,
          mediaTypes: ["image/jpeg"],
        },
      } as unknown as AttachmentStore,
    });
    await expect(
      tool.execute({ url: IMAGE_URL }, execution("vision")),
    ).rejects.toThrow(/not accepted by this deployment/u);
  });
});
