import type {
  AttachmentStore,
  FileAttachmentRef,
} from "@deepseek-ai/dsh-attachment";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import { describe, expect, it, vi } from "vitest";
import {
  createFetchFileTool,
  FETCH_FILE_TOOL_NAME,
  type FileDownloader,
} from "../src/tools/fetch-file.js";

const FILE_URL = "https://jira.example.corp/secure/attachment/42/report.pdf";
const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

function execution(): ToolRunContext {
  return {
    name: FETCH_FILE_TOOL_NAME,
    arguments: {},
    signal: new AbortController().signal,
    callId: "call_file" as never,
    rootCallId: "call_file" as never,
    token: "token_file" as never,
    deferContext: () => undefined,
    concludeTurn: () => undefined,
  };
}

function file() {
  return {
    url: FILE_URL,
    statusCode: 200,
    mediaType: "application/pdf",
    bytes: BYTES,
    name: "report.pdf",
  };
}

describe("web_fetch_file tool", () => {
  it("stores exact downloaded bytes and renders a durable file block", async () => {
    const saveFile = vi.fn(
      async (input: { data: Uint8Array; name?: string }) =>
        ({
          attachmentId: "sha256:file",
          name: input.name ?? "download",
          bytes: input.data.byteLength,
        }) as FileAttachmentRef,
    );
    const downloader: FileDownloader = { fetchFile: vi.fn(async () => file()) };
    const tool = createFetchFileTool({
      downloader,
      attachments: { saveFile } as unknown as AttachmentStore,
    });

    const value = (await tool.execute({ url: FILE_URL }, execution())) as {
      attachment: FileAttachmentRef;
      mediaType: string;
      bytes: number;
      name: string;
    };
    expect(saveFile).toHaveBeenCalledWith({ data: BYTES, name: "report.pdf" });
    expect(value).toMatchObject({
      mediaType: "application/pdf",
      bytes: 4,
      name: "report.pdf",
    });
    const rendered = tool.output.render({ url: FILE_URL }, value as never);
    expect(rendered[0]).toMatchObject({ type: "text" });
    expect(rendered[1]).toMatchObject({
      type: "file",
      attachment: value.attachment,
    });
  });

  it("passes cancellation into the authenticated downloader", async () => {
    const fetchFile = vi.fn(async () => file());
    const tool = createFetchFileTool({
      downloader: { fetchFile },
      attachments: {
        saveFile: async () =>
          ({
            attachmentId: "sha256:file",
            name: "report.pdf",
            bytes: 4,
          }) as FileAttachmentRef,
      } as unknown as AttachmentStore,
    });
    const exec = execution();
    await tool.execute({ url: FILE_URL }, exec);
    expect(fetchFile).toHaveBeenCalledWith(
      { url: FILE_URL },
      { signal: exec.signal },
    );
  });

  it("refuses an empty url before downloading", async () => {
    const fetchFile = vi.fn(async () => file());
    const tool = createFetchFileTool({
      downloader: { fetchFile },
      attachments: {} as AttachmentStore,
    });
    await expect(tool.execute({ url: "  " }, execution())).rejects.toThrow(
      /url must be a non-empty string/u,
    );
    expect(fetchFile).not.toHaveBeenCalled();
  });
});
