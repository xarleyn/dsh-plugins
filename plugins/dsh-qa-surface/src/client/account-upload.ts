import type { QaFileUpload } from "./types.js";

export interface QaUploadCarrier {
  post(request: { path: string; body: Blob; headers: Record<string, string>; signal?: AbortSignal }): Promise<{ status: number; body: string }>;
}

/** Use the native background carrier, addressed to the authenticated QA route. */
export function createQaAccountUpload(carrier: () => QaUploadCarrier | undefined,
  token: () => string | null): QaFileUpload {
  return { upload: async (sessionId, data, name, signal) => {
    const runtime = carrier(); const identity = token();
    if (runtime === undefined || identity === null) throw new Error("File upload is unavailable.");
    const query = new URLSearchParams({ sessionId }); if (name !== undefined) query.set("name", name);
    const body = data instanceof Uint8Array ? new Blob([Uint8Array.from(data).buffer]) : data;
    const response = await runtime.post({ path: `api/qa-chat-upload?${query}`, body,
      headers: { authorization: `Bearer ${identity}`, "content-type": "application/octet-stream" },
      ...(signal === undefined ? {} : { signal }) });
    if (response.status !== 200 || token() !== identity) throw new Error("File upload access was refused.");
    return JSON.parse(response.body) as Awaited<ReturnType<QaFileUpload["upload"]>>;
  } };
}
