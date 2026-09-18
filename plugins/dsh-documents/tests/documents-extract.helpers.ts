import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";

import { resolveDocumentsConfig } from "../src/documents/config.js";
import { DocumentRuntime } from "../src/documents/runtime.js";
import { createProviders } from "../src/documents/providers/registry.js";

export let workspace: string;
export const FIXED_NOW = new Date("2026-09-14T10:00:00Z");

beforeEach(async () => {
  workspace = path.join(
    tmpdir(),
    `qa-docs-extract-${process.pid}-${Date.now()}`,
  );
  await mkdir(workspace, { recursive: true });
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

export interface FetchCall {
  readonly url: string;
  readonly method: string | undefined;
  readonly body: FormData | undefined;
}

/** A docling-serve stand-in: one JSON answer, recorded request. */
export function fakeDocling(options: {
  readonly payload?: unknown;
  readonly status?: number;
  readonly fail?: boolean;
  readonly health?: "ok" | "down";
}): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method,
      body: init?.body instanceof FormData ? init.body : undefined,
    });
    if (url.endsWith("/health") || url.endsWith("/v1/health")) {
      return new Response("{}", {
        status: options.health === "down" ? 503 : 200,
      });
    }
    if (options.fail === true)
      throw new Error("connect ECONNREFUSED 10.0.0.5:5001");
    return new Response(
      options.payload === undefined ? "{}" : JSON.stringify(options.payload),
      {
        status: options.status ?? 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

export function runtimeWithDocling(options: {
  readonly payload?: unknown;
  readonly status?: number;
  readonly fail?: boolean;
  readonly config?: Parameters<typeof resolveDocumentsConfig>[0];
  readonly health?: "ok" | "down";
}): { runtime: DocumentRuntime; calls: FetchCall[] } {
  const config = resolveDocumentsConfig({
    docling: { baseUrl: "http://docling.test" },
    ...options.config,
  });
  const fake = fakeDocling(options);
  const runtime = new DocumentRuntime({
    config,
    providers: createProviders(config, { fetchImpl: fake.fetchImpl }),
    now: () => FIXED_NOW,
  });
  return { runtime, calls: fake.calls };
}

export const scope = (): { workspaceRoot: string; sessionId: string } => ({
  workspaceRoot: workspace,
  sessionId: "session-1",
});

export async function writeInput(name: string, bytes: Buffer): Promise<string> {
  const target = path.join(workspace, name);
  await writeFile(target, bytes);
  return target;
}
