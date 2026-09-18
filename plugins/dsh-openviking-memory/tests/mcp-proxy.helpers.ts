/**
 * The vendored stdio -> streamable-HTTP MCP proxy core, driven directly.
 *
 * Nothing here starts the proxy: `start()` would attach to the real stdio and
 * its callbacks call `process.exit`. `handleMessage` is the same protocol path
 * without either, and the stdio streams, the config reader, the logger and the
 * transport are all injected, which is exactly how upstream expects the factory
 * to be used.
 */

import { expect } from "vitest";

import {
  buildMcpProxyConfig,
  type McpProxyConfig,
} from "../src/openviking/mcp-proxy-config.js";
import {
  createOpenVikingMcpProxy,
  type LocalTool,
  type OpenVikingMcpProxy,
  type RequestGuard,
} from "../src/openviking/mcp-proxy-core.js";

/** One request the proxy made upstream. */
export interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
  /** The abort signal the proxy armed its own timeout on. */
  readonly signal: AbortSignal | undefined;
}

/** The local-tool surface the factory accepts. */
export type LocalToolProvider = {
  listTools(): unknown[];
  callTool(
    params: unknown,
    context: { readonly config: McpProxyConfig },
  ): Promise<unknown>;
};

/** The four injection points the factory accepts, plus the fake stdio sink. */
export interface ProxyHarness {
  readonly proxy: OpenVikingMcpProxy;
  readonly calls: RecordedCall[];
  /** Every chunk written to stdout, in write order. */
  readonly writes: string[];
  /** `start:<index>` / `end:<index>` per write, to observe serialization. */
  readonly events: string[];
}

export const BASE_CONFIG: McpProxyConfig = {
  ...buildMcpProxyConfig({
    baseUrl: "http://ov.local",
    apiKey: "api-key",
    userAgent: "openviking-memory-dsh/0.0.0",
    env: {},
  }),
  // No watched credential files: the proxy re-reads its config when one of them
  // changes, and a developer's real ~/.openviking must not decide a unit test.
  watchedPaths: [],
};

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export function rpcResult(
  id: unknown,
  result: unknown,
): Record<string, unknown> {
  return { jsonrpc: "2.0", id, result };
}

export function createProxy(options: {
  respond: (call: RecordedCall) => Response | Promise<Response>;
  config?: Partial<McpProxyConfig>;
  localToolProvider?: LocalToolProvider | null;
  requestGuard?: RequestGuard | null;
  adjustUpstreamTool?: (tool: LocalTool) => LocalTool | null;
  loggerFactory?: (
    hookName: string,
    config: McpProxyConfig,
  ) => {
    log(stage: string, data?: unknown): void;
    logError(stage: string, err: unknown): void;
  };
}): ProxyHarness {
  const calls: RecordedCall[] = [];
  const writes: string[] = [];
  const events: string[] = [];
  let writeIndex = 0;

  // The callback is deferred, so a chunk is only "written" once the previous
  // write reported completion — that is what makes the ordering observable.
  const stdout = {
    write(chunk: string, callback?: (error?: Error | null) => void): boolean {
      const index = writeIndex++;
      writes.push(String(chunk));
      events.push(`start:${index}`);
      setTimeout(() => {
        events.push(`end:${index}`);
        callback?.(null);
      }, 1);
      return true;
    },
  } as unknown as NodeJS.WritableStream;

  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const call: RecordedCall = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body:
        init?.body === undefined
          ? {}
          : (JSON.parse(String(init.body)) as Record<string, unknown>),
      signal: init?.signal ?? undefined,
    };
    calls.push(call);
    return await options.respond(call);
  }) as typeof fetch;

  const config: McpProxyConfig = { ...BASE_CONFIG, ...options.config };
  const proxy = createOpenVikingMcpProxy({
    stdout,
    readConfig: () => config,
    loggerFactory:
      options.loggerFactory ?? (() => ({ log() {}, logError() {} })),
    fetchImpl,
    localToolProvider: options.localToolProvider ?? null,
    requestGuard: options.requestGuard ?? null,
    adjustUpstreamTool: options.adjustUpstreamTool,
  });

  return { proxy, calls, writes, events };
}

/** The messages the proxy wrote, parsed as the JSON-RPC lines they claim to be. */
export function writtenMessages(
  writes: readonly string[],
): Record<string, unknown>[] {
  return writes.map((chunk) => {
    expect(chunk.endsWith("\n")).toBe(true);
    return JSON.parse(chunk) as Record<string, unknown>;
  });
}

export function errorOf(message: Record<string, unknown>): {
  code: number;
  message: string;
  data?: {
    status?: number;
    serverMessage?: string;
    timeoutMs?: number;
    mcpUrl?: string;
    cause?: string;
  };
} {
  return message.error as { code: number; message: string };
}
