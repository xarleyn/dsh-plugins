import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { Readable } from "node:stream";
import type { AddressInfo } from "node:net";
import type { Context } from "@deepseek-ai/cordis";
import { describe, expect, it, vi } from "vitest";
import { installQaChatUploads } from "../../src/chat-sharing/uploads.js";
import { sharingFixture } from "./chat-sharing.helpers.js";

describe("account upload HTTP admission", () => {
  it("delivers JSON refusals without entering streaming intake, while accepting writers", async () => {
    const f = sharingFixture();
    let http: (
      req: IncomingMessage,
      res: ServerResponse,
      next: () => Promise<void>,
    ) => Promise<void> = async (_req, _res, next) => next();
    let handle: (request: Request) => Promise<Response> = async () =>
      new Response();
    const stoppedHttp = vi.fn();
    const stoppedFetch = vi.fn(async () => {});
    const admit = vi.fn(async () => {});
    const upload = vi.fn(
      async ({ data }: { data: AsyncIterable<Uint8Array> }) => {
        const chunks: Uint8Array[] = [];
        for await (const chunk of data) chunks.push(chunk);
        return {
          receiptId: "demo-receipt",
          bytes: Buffer.concat(chunks).length,
        };
      },
    );
    const ctx = {
      on: (_event: string, callback: typeof http) => {
        http = callback;
        return stoppedHttp;
      },
      get: (name: string) =>
        name === "connection"
          ? {
              fetch: {
                register: (route: { fetch: typeof handle }) => {
                  handle = route.fetch;
                  return stoppedFetch;
                },
              },
            }
          : { uploadStream: upload },
    } as unknown as Context;
    const dispose = installQaChatUploads(ctx, () => f.store, admit);
    let bridged = 0;
    const server = createServer((req, res) => {
      void http(req, res, async () => {
        bridged++;
        const response = await handle(
          new Request("http://localhost" + req.url, {
            method: req.method,
            headers: { authorization: req.headers.authorization ?? "" },
            body: Readable.toWeb(req),
            duplex: "half",
          } as RequestInit & { duplex: "half" }),
        );
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(await response.text());
      }).catch(() => res.destroy());
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const origin = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
    try {
      for (const token of ["", "invalid", f.reader.token, f.outsider.token]) {
        const response = await fetch(
          origin + "/api/qa-chat-upload?sessionId=chat-a",
          {
            method: "POST",
            headers: { authorization: `Bearer ${token}` },
            body: "synthetic rejected bytes",
          },
        );
        expect(response.status).toBe(403);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({
          ok: false,
          error: { message: "File upload access was refused." },
        });
      }
      expect(bridged).toBe(0);
      expect(admit).not.toHaveBeenCalled();
      expect(upload).not.toHaveBeenCalled();
      for (const token of [f.owner.token, f.collaborator.token]) {
        const response = await fetch(
          origin + "/api/qa-chat-upload?sessionId=chat-a",
          {
            method: "POST",
            headers: { authorization: `Bearer ${token}` },
            body: "accepted",
          },
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          ok: true,
          value: {
            receiptId: "demo-receipt",
            bytes: 8,
          },
        });
      }
      expect(bridged).toBe(2);
      expect(admit).toHaveBeenCalledTimes(2);
      expect(upload).toHaveBeenCalledTimes(2);
    } finally {
      await dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      f.store.storage.close();
      f.accounts.close();
    }
    expect(stoppedHttp).toHaveBeenCalledOnce();
    expect(stoppedFetch).toHaveBeenCalledOnce();
  });
});
