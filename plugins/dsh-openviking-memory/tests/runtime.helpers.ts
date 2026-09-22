import { readdir } from "node:fs/promises";

import { userMessage } from "./helpers/harness.js";

/** The OpenViking session id the runtime derives from a DSH session id. */
export function ovId(dshSessionId: string): string {
  return `dsh-${dshSessionId}`;
}

/** One OpenViking session path, e.g. `/api/v1/sessions/dsh-x/commit`. */
export function ovPath(ovSessionId: string, suffix = ""): string {
  return `/api/v1/sessions/${ovSessionId}${suffix}`;
}

export type FetchHandler = (
  init: RequestInit | undefined,
  url?: URL,
) => Response | Promise<Response>;

/** The same well-formed answers the shared harness stubs by default. */
export const SUCCESS_BODIES: Record<string, unknown> = {
  "/health": {},
  "/api/v1/sessions": {},
  "/api/v1/system/status": { user: "default" },
  "/api/v1/fs/ls": [],
  "/api/v1/content/read": "",
  "/api/v1/search/search": { rendered: "", entries: [], digest: "", stats: {} },
  "/api/v1/search/find": { memories: [], resources: [], skills: [] },
  "/api/v1/search/recall": { rendered: "" },
};

export function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function ok(result: unknown = {}): Response {
  return json({ status: "ok", result }, 200);
}

/** The envelope the client turns into `{ ok: false, status }`. */
export function failure(status: number, code = "FAILED"): Response {
  return json(
    { status: "error", error: { code, message: `HTTP ${status}` } },
    status,
  );
}

/**
 * A transport that answers the plugin's ordinary endpoints and lets one test
 * replace individual pathnames with a failure or with a gated response.
 */
export function transport(
  overrides: Record<string, FetchHandler> = {},
): (
  path: string,
  init: RequestInit | undefined,
  url?: URL,
) => Promise<Response> {
  return async (path, init, url) => {
    const override = overrides[path];
    if (override) return await override(init, url);
    if (Object.hasOwn(SUCCESS_BODIES, path)) return ok(SUCCESS_BODIES[path]);
    return failure(404, "NOT_FOUND");
  };
}

/** The `.json` entries currently queued under `OPENVIKING_PENDING_DIR`. */
export async function pendingFiles(): Promise<string[]> {
  const dir = process.env.OPENVIKING_PENDING_DIR;
  if (!dir) throw new Error("OPENVIKING_PENDING_DIR is not set");
  return (await readdir(dir)).filter((name) => name.endsWith(".json"));
}

export function captureEvent(text: string): {
  type: string;
  time: number;
  data: unknown;
} {
  return { type: "user/message", time: Date.now(), data: userMessage(text) };
}
