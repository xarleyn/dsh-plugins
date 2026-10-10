import { afterEach, describe, expect, it, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import { installQaChatUploads } from "../../src/chat-sharing/uploads.js";
import { sharingFixture } from "./chat-sharing.helpers.js";
const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); });
describe("shared upload boundary", () => {
  it("refuses readers before transferring bytes and stops a revoked collaborator's upload", async () => {
    const f = sharingFixture(); cleanup.push(() => f.store.storage.close());
    let handle: (request: Request) => Promise<Response> = async () => new Response();
    const upload = vi.fn(async ({ data }: { data: AsyncIterable<Uint8Array> }) => {
      for await (const _chunk of data) f.store.set(f.owner.token, "chat-a", f.collaborator.user.email, null);
      return { receiptId: "demo-receipt" };
    });
    const ctx = { get: (name: string) => name === "connection" ? { fetch: { register: (route: { path: string; fetch: typeof handle }) => { expect(route.path).toBe("/api/qa-chat-upload"); handle = route.fetch; return async () => {}; } } }
      : { uploadStream: upload } } as unknown as Context;
    installQaChatUploads(ctx, () => f.store, async () => {});
    const reader = await handle(new Request("http://localhost/api/qa-chat-upload?sessionId=chat-a", { method: "POST", body: "demo", headers: { authorization: `Bearer ${f.reader.token}` } }));
    expect(reader.status).toBe(403); expect(upload).not.toHaveBeenCalled();
    const collaborator = await handle(new Request("http://localhost/api/qa-chat-upload?sessionId=chat-a", { method: "POST", body: "demo", headers: { authorization: `Bearer ${f.collaborator.token}` } }));
    expect(collaborator.status).toBe(403); expect(upload).toHaveBeenCalledOnce();
  });
});
