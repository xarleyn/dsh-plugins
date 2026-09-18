/**
 * The download seam's model-facing tool (SPEC §15.4). `web_fetch` carries text
 * only — its body union has no binary arm — so an image attachment used to be
 * a dead end: the tool refused it as an unsupported content type, and the
 * browser refused the same URL under its own network policy. This tool closes
 * that gap: the bytes travel the SAME authenticated pipeline as `web_fetch`
 * (rule matching, credentials, address policy, redirects), become a durable
 * attachment, and reach the model as an image block it can actually look at.
 *
 * The tool stores raster images only, and only while a durable attachment
 * store is mounted: without one there is nowhere to keep the image and nothing
 * that could render it back.
 * @module tools/fetch-image
 */

import type { Context } from "@deepseek-ai/cordis";
import {
  AttachmentError,
  type AttachmentStore,
  type ImageAttachmentRef,
} from "@deepseek-ai/dsh-attachment";
import type {} from "@deepseek-ai/dsh-llm";
import {
  defineTool,
  type ToolDefinition,
  type ToolRunContext,
} from "@deepseek-ai/dsh-tools";
import type { FetchedImage } from "../provider.js";

/** Stable tool name (the model-facing surface of this module). */
export const FETCH_IMAGE_TOOL_NAME = "web_fetch_image";

/** The provider slice this tool needs; a seam so tests can stand in for it. */
export interface ImageDownloader {
  fetchImage(
    request: { readonly url: string },
    options: { readonly maxBytes: number; readonly signal?: AbortSignal },
  ): Promise<FetchedImage>;
}

export interface FetchImageToolOptions {
  readonly ctx: Context;
  readonly downloader: ImageDownloader;
  readonly attachments: AttachmentStore;
}

/**
 * Register-time factory for `web_fetch_image`.
 * @param options - the provider to download through and the attachment store
 *   the bytes are committed to.
 * @returns the tool definition to register with `ctx.tools.register`.
 */
export function createFetchImageTool(
  options: FetchImageToolOptions,
): ToolDefinition {
  const { ctx, downloader, attachments } = options;
  return defineTool({
    name: FETCH_IMAGE_TOOL_NAME,
    description:
      "Download one PNG/JPEG/WebP/GIF image over the deployment's authenticated fetch rules and return the image itself. " +
      "Use it for image attachments, screenshots and charts whose URL web_fetch refuses as binary content. " +
      "Requires the current model to accept image input.",
    parameters: {
      url: {
        type: "string",
        required: true,
        description:
          "Absolute URL of the image to download, matched against the configured fetch rules like any other request.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          url: { type: "string", required: true },
          mediaType: { type: "string", required: true },
          bytes: { type: "integer", required: true },
          name: { type: "string", required: true },
          attachment: {
            type: "object",
            required: true,
            additionalProperties: true,
          },
        },
      },
      render: (_args, value) => [
        {
          type: "text",
          text: `Downloaded ${value.mediaType} (${value.bytes} bytes) from ${value.url} as "${value.name}".`,
        },
        {
          type: "image",
          attachment: value.attachment as unknown as ImageAttachmentRef,
        },
      ],
    },
    isConcurrencySafe: () => true,
    async execute(args: { url: string }, exec: ToolRunContext) {
      const url = args.url.trim();
      if (url.length === 0) throw new Error("url must be a non-empty string");
      await assertImageCapableRoute(ctx, exec);

      const limits = attachments.imageLimits;
      // One result carries one image, so the per-message aggregate bound
      // applies beside the per-image bound.
      const maxBytes = Math.min(
        limits.maxImageBytes,
        limits.maxMessageImageBytes,
      );
      const image = await downloader.fetchImage(
        { url },
        {
          maxBytes,
          ...(exec.signal === undefined ? {} : { signal: exec.signal }),
        },
      );
      if (!limits.mediaTypes.includes(image.mediaType)) {
        throw new Error(
          `${image.mediaType} images are not accepted by this deployment`,
        );
      }
      const attachment = await saveImage(attachments, image);
      return {
        url: image.url,
        mediaType: image.mediaType,
        bytes: image.bytes.byteLength,
        name: image.name,
        attachment: attachment as unknown as Record<string, never>,
      };
    },
  });
}

/** Commit the bytes, translating storage refusals into recoverable tool errors. */
async function saveImage(
  attachments: AttachmentStore,
  image: FetchedImage,
): Promise<ImageAttachmentRef> {
  try {
    return await attachments.saveImage({
      data: image.bytes,
      mediaType: image.mediaType,
      name: image.name,
    });
  } catch (error: unknown) {
    if (error instanceof AttachmentError) {
      const limits = attachments.imageLimits;
      if (error.code === "IMAGE_DIMENSION_TOO_LARGE") {
        throw new Error(
          `the image exceeds the ${limits.maxImageDimension}px side limit of this deployment`,
          { cause: error },
        );
      }
      if (error.code === "IMAGE_TOO_MANY_PIXELS") {
        throw new Error(
          `the image exceeds the ${limits.maxImagePixels}-pixel decoded-size limit of this deployment`,
          { cause: error },
        );
      }
      if (error.code === "IMAGE_TOO_LARGE") {
        throw new Error(
          "the image cannot be stored within the deployment's byte limits",
          { cause: error },
        );
      }
      if (error.code === "UNSUPPORTED_IMAGE_TYPE") {
        throw new Error(
          `${image.mediaType} images are not accepted by this deployment`,
          { cause: error },
        );
      }
    }
    throw error;
  }
}

/**
 * Refuse the call when the calling route's model does not accept image input.
 * A refusal here keeps an unusable image block out of durable history; a route
 * this deployment cannot resolve is left to the save path rather than being
 * refused on a guess.
 */
async function assertImageCapableRoute(
  ctx: Context,
  exec: ToolRunContext,
): Promise<void> {
  const llm = ctx.get("llm");
  const provider = exec.agent?.options.provider;
  const model = exec.agent?.options.model;
  if (llm === undefined || provider === undefined || model === undefined)
    return;
  const active = await llm.resolveModelInfo(
    provider,
    model,
    exec.signal === undefined ? undefined : exec.signal,
  );
  if (
    active.inputModalities !== undefined &&
    !active.inputModalities.includes("image")
  ) {
    throw new Error(
      `model "${model}" does not declare image input; switch to an image-capable model to download images`,
    );
  }
}
