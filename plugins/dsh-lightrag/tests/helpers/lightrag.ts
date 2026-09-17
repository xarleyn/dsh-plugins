/**
 * Test doubles for the LightRAG client: a fetch stub that records the requests
 * it was given and answers from a handler, plus the response builders the
 * suites read against. No suite reaches the network.
 */

import type { ToolRunContext } from "@deepseek-ai/dsh-tools";

import {
  createLightRagClient,
  type LightRagClient,
  type LightRagClientOptions,
} from "../../src/client.js";
import {
  resolveLightRagConfig,
  type LightRagConfig,
  type ResolvedLightRagConfig,
} from "../../src/config.js";

/** One request the client made, decoded for assertions. */
export interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
  readonly signal: AbortSignal | null | undefined;
}

export interface FetchStub {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: RecordedCall[];
}

/** A fetch replacement that records every call and answers via `handler`. */
export function createFetchStub(
  handler: (call: RecordedCall) => Response | Promise<Response>,
): FetchStub {
  const calls: RecordedCall[] = [];
  const stub = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const rawBody = typeof init?.body === "string" ? init.body : undefined;
    const call: RecordedCall = {
      url,
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body:
        rawBody === undefined ? undefined : (JSON.parse(rawBody) as unknown),
      signal: init?.signal,
    };
    calls.push(call);
    return handler(call);
  };
  return { fetch: stub as unknown as typeof globalThis.fetch, calls };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function textResponse(text: string, status = 200): Response {
  return new Response(text, {
    status,
    headers: { "content-type": "text/plain" },
  });
}

/** Resolved configuration, with an explicit empty environment by default. */
export function testConfig(
  overrides: LightRagConfig = {},
  env: Record<string, string | undefined> = {},
): ResolvedLightRagConfig {
  return resolveLightRagConfig(overrides, env);
}

export interface TestClient {
  readonly client: LightRagClient;
  readonly calls: RecordedCall[];
  readonly config: ResolvedLightRagConfig;
}

/** A client bound to the stub, plus the recorded calls it produced. */
export function testClient(
  handler: (call: RecordedCall) => Response | Promise<Response>,
  config: ResolvedLightRagConfig = testConfig(),
  options: Omit<LightRagClientOptions, "fetch"> = {},
): TestClient {
  const stub = createFetchStub(handler);
  return {
    client: createLightRagClient(config, { ...options, fetch: stub.fetch }),
    calls: stub.calls,
    config,
  };
}

/** Minimal execution context for a tool call. */
export function makeExec(signal?: AbortSignal): ToolRunContext {
  return {
    signal: signal ?? new AbortController().signal,
    callId: "call-1",
    name: "test",
    arguments: {},
  } as unknown as ToolRunContext;
}
