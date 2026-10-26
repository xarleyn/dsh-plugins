import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import { installQaChatUploads } from "../../src/chat-sharing/uploads.js";
import {
  QaFormAttachmentAdapter,
  type QaFormHostAttachments,
} from "../../src/forms/attachments.js";
import { sharingFixture } from "../session/chat-sharing.helpers.js";
import { fixture, intake } from "./fixture.js";
const closes: (() => void)[] = [];
afterEach(() => {
  for (const close of closes.splice(0)) close();
});
function setup() {
  const auth = sharingFixture(),
    f = fixture();
  closes.push(() => {
    f.close();
    auth.store.storage.close();
    auth.accounts.close();
  });
  const root = process.platform === "win32" ? "C:/attachments" : "/attachments";
  let bytes = Buffer.alloc(0);
  const host: QaFormHostAttachments = {
    root,
    saveFile: vi.fn(),
    fileHostPath: () => `${root}/demo.txt`,
    readFileStream: async function* () {
      yield bytes;
    },
  };
  const adapter = new QaFormAttachmentAdapter(
    () => f.service,
    () => host,
  );
  const r = f.service.create("chat-a", "intake", intake);
  const u = f
    .command(r.id, {
      action: "begin_upload",
      item_id: "task",
      name: "demo.txt",
      size_bytes: 4,
    })
    .uploads.at(-1)!;
  let handle: (r: Request) => Promise<Response> = async () => new Response();
  const upload = vi.fn(
    async ({ data }: { data: AsyncIterable<Uint8Array> }) => {
      const chunks = [];
      for await (const c of data) chunks.push(Buffer.from(c));
      bytes = Buffer.concat(chunks);
      return {
        receiptId: "demo-receipt",
        file: {
          attachmentId: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
          name: "demo.txt",
          bytes: bytes.length,
        },
      };
    },
  );
  type GuardRequest = {
    method?: string;
    url?: string;
    headers: { authorization?: string };
  };
  type GuardResponse = {
    writeHead: (status: number, headers?: Record<string, unknown>) => unknown;
    end: (body?: string) => unknown;
  };
  let guard:
    | ((
        request: GuardRequest,
        response: GuardResponse,
        next: () => Promise<void>,
      ) => unknown)
    | undefined;
  const ctx = {
    get: (name: string) =>
      name === "connection"
        ? {
            fetch: {
              register: (route: { fetch: typeof handle }) => {
                handle = route.fetch;
                return async () => {};
              },
            },
          }
        : { uploadStream: upload },
    on: (event: string, handler: NonNullable<typeof guard>) => {
      guard = handler;
      return () => {};
    },
  } as unknown as Context;
  installQaChatUploads(
    ctx,
    () => auth.store,
    async () => {},
    adapter,
  );
  // The Host answers through the connection/request guard before the streaming
  // bridge; only a request the guard lets through reaches the fetch handler.
  const request = async (token: string, body = "data") => {
    const url = `/api/qa-chat-upload?sessionId=chat-a&formUploadId=${u.id}`;
    let status = 0;
    let payload: string | undefined;
    const proceed = guard?.(
      { method: "POST", url, headers: { authorization: `Bearer ${token}` } },
      {
        writeHead: (code) => {
          status = code;
          return undefined;
        },
        end: (text?: string) => {
          if (!status) status = 200;
          payload = text;
          return undefined;
        },
      },
      async () => {},
    );
    if (proceed) await proceed;
    if (payload !== undefined)
      return new Response(payload, {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    return handle(
      new Request(`http://localhost${url}`, {
        method: "POST",
        body,
        headers: { authorization: `Bearer ${token}` },
      }),
    );
  };
  return { auth, f, r, u, upload, request };
}
describe("protected form upload route", () => {
  it("binds owner uploads without returning Host receipts", async () => {
    const t = setup(),
      response = await t.request(t.auth.owner.token);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.value.attachments.task).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("receiptId");
    expect(t.f.service.get("chat-a", t.r.id).uploads[0]!.state).toBe("ready");
  });
  it.each(["reader", "collaborator", "outsider"] as const)(
    "refuses %s before consuming the stream",
    async (actor) => {
      const t = setup(),
        response = await t.request(t.auth[actor].token);
      expect(response.status).toBe(403);
      expect(t.upload).not.toHaveBeenCalled();
      expect(
        t.f.service.get("chat-a", t.r.id).attachments.task,
      ).toBeUndefined();
    },
  );
  it("enforces actual chunk sizes without trusting Content-Length", async () => {
    const t = setup(),
      response = await t.request(t.auth.owner.token, "too large");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "FILE_TOO_LARGE" },
    });
    expect(t.f.service.get("chat-a", t.r.id).attachments.task).toBeUndefined();
    expect(t.f.service.get("chat-a", t.r.id).uploads[0]!.state).toBe("failed");
  });
});
