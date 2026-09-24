/**
 * Authenticated arbitrary-file download. The bytes follow the same rule,
 * credential, DNS and redirect pipeline as `web_fetch`, then land in the
 * Host's immutable attachment store. The model receives a durable file block,
 * never a bearer URL or a caller-selected host path.
 * @module tools/fetch-file
 */

import type {
  AttachmentStore,
  FileAttachmentRef,
} from "@deepseek-ai/dsh-attachment";
import type {} from "@deepseek-ai/dsh-llm";
import {
  defineTool,
  type ToolDefinition,
  type ToolRunContext,
} from "@deepseek-ai/dsh-tools";
import type { FetchedFile } from "../provider.js";

export const FETCH_FILE_TOOL_NAME = "web_fetch_file";

export interface FileDownloader {
  fetchFile(
    request: { readonly url: string },
    options: { readonly signal?: AbortSignal },
  ): Promise<FetchedFile>;
}

export interface FetchFileToolOptions {
  readonly downloader: FileDownloader;
  readonly attachments: AttachmentStore;
}

export function createFetchFileTool(
  options: FetchFileToolOptions,
): ToolDefinition {
  return defineTool({
    name: FETCH_FILE_TOOL_NAME,
    description:
      "Download almost any successful response through the deployment's authenticated web rules and store its exact bytes as a durable file. " +
      "Use it for Jira/Confluence attachments, PDF and Office files, spreadsheets, presentations, archives, logs, JSON/XML/HTML pages, and other binary content. " +
      "Prefer web_fetch when readable page text is enough, and web_fetch_image when the model must inspect a PNG/JPEG/WebP/GIF visually.",
    parameters: {
      url: {
        type: "string",
        required: true,
        description:
          "Absolute URL to download. It must match an enabled authenticated-fetch rule and remains subject to that rule's network, redirect and response-size limits.",
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
          text: `Downloaded ${value.mediaType} (${value.bytes} bytes) from ${value.url} as "${value.name}". The attached file is immutable and available through its read-only projected path.`,
        },
        {
          type: "file",
          attachment: value.attachment as unknown as FileAttachmentRef,
        },
      ],
    },
    isConcurrencySafe: () => true,
    async execute(args: { url: string }, exec: ToolRunContext) {
      const url = args.url.trim();
      if (url.length === 0) throw new Error("url must be a non-empty string");
      const file = await options.downloader.fetchFile(
        { url },
        exec.signal === undefined ? {} : { signal: exec.signal },
      );
      const attachment = await options.attachments.saveFile({
        data: file.bytes,
        name: file.name,
      });
      return {
        url: file.url,
        mediaType: file.mediaType,
        bytes: file.bytes.byteLength,
        name: file.name,
        attachment: attachment as unknown as Record<string, never>,
      };
    },
  });
}
