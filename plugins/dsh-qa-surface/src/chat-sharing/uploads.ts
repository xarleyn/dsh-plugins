import type { Context } from "@deepseek-ai/cordis";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import type { QaChatSharingStore } from "./store.js";
import type { QaFormAttachmentAdapter } from "../forms/attachments.js";
import { formFailure, QaFormError } from "../forms/errors.js";

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
  forms?: QaFormAttachmentAdapter,
): () => Promise<void> {
  const connection = ctx.get("connection") as unknown as {
    fetch: FetchRegistry;
  };
  return connection.fetch.register({
    path: "/api/qa-chat-upload",
    methods: ["POST"],
    requestBody: "streaming",
    fetch: async (request) => {
      let formContext:
        { session: string; form: string; upload: string } | undefined;
      try {
        const token =
          request.headers.get("authorization")?.replace(/^Bearer /u, "") ?? "";
        const url = new URL(request.url);
        const id = url.searchParams.get("sessionId") ?? "";
        const access = store().write(token, id);
        await admit(token, id);
        store().revalidate(token, access);
        const formUploadId = url.searchParams.get("formUploadId");
        const formUpload =
          formUploadId && forms
            ? (() => {
                store().owner(token, id);
                const claimed = forms.claim(id, formUploadId);
                formContext = {
                  session: id,
                  form: claimed.record.id,
                  upload: formUploadId,
                };
                return claimed;
              })()
            : undefined;
        if (formUploadId && !formUpload)
          throw new Error("Form upload is unavailable.");
        const uploads = ctx.get("fileUploads") as Uploads | undefined;
        if (uploads === undefined || request.body === null)
          throw new Error("File upload is unavailable.");
        const reader = request.body.getReader();
        let bytes = 0;
        const data = (async function* () {
          try {
            while (true) {
              request.signal.throwIfAborted();
              store().revalidate(token, access);
              const next = await reader.read();
              if (next.done) return;
              store().revalidate(token, access);
              if (formUpload) {
                store().owner(token, id);
                forms!.check(id, formUpload.record.id, formUpload.upload.id);
                bytes += next.value.byteLength;
                if (bytes > formUpload.upload.size_bytes)
                  throw new QaFormError(
                    "FILE_TOO_LARGE",
                    "The uploaded file exceeds its reserved size.",
                  );
              }
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
          ...(formUpload
            ? { name: formUpload.upload.name }
            : url.searchParams.has("name")
              ? { name: url.searchParams.get("name")! }
              : {}),
        });
        store().revalidate(token, access);
        if (formUpload && forms) {
          const record = await forms.complete(
            id,
            formUpload.record.id,
            formUpload.upload.id,
            value,
            request.signal,
            () => {
              store().revalidate(token, access);
              store().owner(token, id);
            },
          );
          return Response.json(
            { ok: true, value: record },
            { headers: { "Cache-Control": "no-store" } },
          );
        }
        return Response.json(
          { ok: true, value },
          { headers: { "Cache-Control": "no-store" } },
        );
      } catch (error) {
        if (formContext && forms) {
          try {
            forms.fail(
              formContext.session,
              formContext.form,
              formContext.upload,
            );
          } catch {
            /* Preserve the original upload refusal. */
          }
          return Response.json(formFailure(error), {
            status: 400,
            headers: { "Cache-Control": "no-store" },
          });
        }
        return Response.json(
          { ok: false, error: { message: "File upload access was refused." } },
          { status: 403, headers: { "Cache-Control": "no-store" } },
        );
      }
    },
  });
}
