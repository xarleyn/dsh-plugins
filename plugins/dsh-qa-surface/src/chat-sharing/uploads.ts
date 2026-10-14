import type { Context } from "@deepseek-ai/cordis";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import type { QaChatSharingStore } from "./store.js";

interface Uploads {
  uploadStream(request: {
    sessionId: ReturnType<typeof SessionId>;
    data: AsyncIterable<Uint8Array>;
    signal: AbortSignal;
    name?: string;
  }): Promise<unknown>;
}
interface FetchRegistry {
  register(route: {
    path: string;
    methods: readonly ["POST"];
    requestBody: "streaming";
    fetch(request: Request): Promise<Response>;
  }): () => Promise<void>;
}

/** Authenticate before transferring the body, and fence every uploaded chunk. */
export function installQaChatUploads(
  ctx: Context,
  store: () => QaChatSharingStore,
  admit: (token: string, id: string) => Promise<unknown>,
): () => Promise<void> {
  const connection = ctx.get("connection") as unknown as {
    fetch: FetchRegistry;
  };
  // An unread streaming Request can close its socket before the Host flushes
  // the refusal. Reject inaccessible uploads before the streaming bridge.
  const stopHttp = ctx.on(
    "connection/request",
    async (request, response, next) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "POST" && url.pathname === "/api/qa-chat-upload") {
        try {
          store().write(
            request.headers.authorization?.replace(/^Bearer /u, "") ?? "",
            url.searchParams.get("sessionId") ?? "",
          );
        } catch {
          response.writeHead(403, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            Connection: "close",
          });
          response.end(
            JSON.stringify({
              ok: false,
              error: { message: "File upload access was refused." },
            }),
          );
          return;
        }
      }
      await next();
    },
  );
  const stopFetch = connection.fetch.register({
    path: "/api/qa-chat-upload",
    methods: ["POST"],
    requestBody: "streaming",
    fetch: async (request) => {
      try {
        const token =
          request.headers.get("authorization")?.replace(/^Bearer /u, "") ?? "";
        const url = new URL(request.url);
        const id = url.searchParams.get("sessionId") ?? "";
        const access = store().write(token, id);
        await admit(token, id);
        store().revalidate(token, access);
        const uploads = ctx.get("fileUploads") as Uploads | undefined;
        if (uploads === undefined || request.body === null)
          throw new Error("File upload is unavailable.");
        const reader = request.body.getReader();
        const data = (async function* () {
          try {
            while (true) {
              request.signal.throwIfAborted();
              store().revalidate(token, access);
              const next = await reader.read();
              if (next.done) return;
              store().revalidate(token, access);
              yield next.value;
            }
          } finally {
            await reader.cancel().catch(() => undefined);
            reader.releaseLock();
          }
        })();
        const value = await uploads.uploadStream({
          sessionId: SessionId(id),
          data,
          signal: request.signal,
          ...(url.searchParams.has("name")
            ? { name: url.searchParams.get("name")! }
            : {}),
        });
        store().revalidate(token, access);
        return Response.json(
          { ok: true, value },
          { headers: { "Cache-Control": "no-store" } },
        );
      } catch {
        return Response.json(
          { ok: false, error: { message: "File upload access was refused." } },
          { status: 403, headers: { "Cache-Control": "no-store" } },
        );
      }
    },
  });
  return async () => {
    stopHttp();
    await stopFetch();
  };
}
