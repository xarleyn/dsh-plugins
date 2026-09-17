/**
 * The vendored stdio -> streamable-HTTP MCP proxy core, driven directly.
 *
 * Nothing here starts the proxy: `start()` would attach to the real stdio and
 * its callbacks call `process.exit`. `handleMessage` is the same protocol path
 * without either, and the stdio streams, the config reader, the logger and the
 * transport are all injected, which is exactly how upstream expects the factory
 * to be used.
 */

import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "../src/openviking/debug-log.js";
import {
  buildMcpProxyConfig,
  DEFAULT_PROXY_TIMEOUT_MS,
  defaultCredentialPaths,
  normalizeConfigPath,
  trimSlash,
  type McpProxyConfig,
} from "../src/openviking/mcp-proxy-config.js";
import {
  createOpenVikingMcpProxy,
  type LocalTool,
  type OpenVikingMcpProxy,
  type RequestGuard,
} from "../src/openviking/mcp-proxy-core.js";
import {
  guardEmptySearchParams,
  readProxyConfig,
  requireSearchParamsInSchema,
} from "../src/servers/mcp-proxy.js";

/** One request the proxy made upstream. */
interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
  /** The abort signal the proxy armed its own timeout on. */
  readonly signal: AbortSignal | undefined;
}

/** The local-tool surface the factory accepts. */
type LocalToolProvider = {
  listTools(): unknown[];
  callTool(
    params: unknown,
    context: { readonly config: McpProxyConfig },
  ): Promise<unknown>;
};

/** The four injection points the factory accepts, plus the fake stdio sink. */
interface ProxyHarness {
  readonly proxy: OpenVikingMcpProxy;
  readonly calls: RecordedCall[];
  /** Every chunk written to stdout, in write order. */
  readonly writes: string[];
  /** `start:<index>` / `end:<index>` per write, to observe serialization. */
  readonly events: string[];
}

const BASE_CONFIG: McpProxyConfig = {
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

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function rpcResult(id: unknown, result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id, result };
}

function createProxy(options: {
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
function writtenMessages(writes: readonly string[]): Record<string, unknown>[] {
  return writes.map((chunk) => {
    expect(chunk.endsWith("\n")).toBe(true);
    return JSON.parse(chunk) as Record<string, unknown>;
  });
}

function errorOf(message: Record<string, unknown>): {
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

describe("parseSseMessages", () => {
  it("collects every JSON-RPC message of a multi-event SSE body", () => {
    const { proxy } = createProxy({ respond: () => jsonResponse({}) });

    const body = [
      ": keep-alive comment",
      "",
      'data: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}',
      "",
      'data: {"jsonrpc":"2.0","id":2,',
      'data: "result":{"split":"across-lines"}}',
      "",
      ": another comment",
      "data: [DONE]",
      "",
    ].join("\r\n");

    expect(proxy.parseSseMessages(body)).toEqual([
      { jsonrpc: "2.0", id: 1, result: { ok: true } },
      { jsonrpc: "2.0", id: 2, result: { split: "across-lines" } },
    ]);
  });

  it("returns nothing for a data-only terminator", () => {
    const { proxy } = createProxy({ respond: () => jsonResponse({}) });

    expect(proxy.parseSseMessages("data: [DONE]\n\n")).toEqual([]);
    expect(proxy.parseSseMessages("")).toEqual([]);
  });
});

describe("request forwarding", () => {
  it("posts the request to the configured MCP URL and returns the upstream result", async () => {
    const upstream = rpcResult(7, { tools: [{ name: "find" }] });
    const { proxy, calls, writes } = createProxy({
      respond: () => jsonResponse(upstream),
    });

    await proxy.handleMessage({ jsonrpc: "2.0", id: 7, method: "tools/list" });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://ov.local/mcp");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body).toEqual({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/list",
    });
    expect(calls[0]!.headers["Content-Type"]).toBe("application/json");
    expect(calls[0]!.headers.Authorization).toBe("Bearer api-key");

    expect(writes).toHaveLength(1);
    expect(writtenMessages(writes)).toEqual([upstream]);
  });

  it("writes every message of a streamed SSE response", async () => {
    const events = [
      'data: {"jsonrpc":"2.0","id":9,"result":{"progress":1}}',
      "",
      'data: {"jsonrpc":"2.0","id":9,"result":{"progress":2}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const { proxy, writes } = createProxy({
      respond: () =>
        new Response(events, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
    });

    await proxy.handleMessage({ jsonrpc: "2.0", id: 9, method: "tools/call" });

    expect(writtenMessages(writes)).toEqual([
      { jsonrpc: "2.0", id: 9, result: { progress: 1 } },
      { jsonrpc: "2.0", id: 9, result: { progress: 2 } },
    ]);
  });

  it("rejects a non-JSON-RPC payload on the invalid-request code", async () => {
    const { proxy, calls, writes } = createProxy({
      respond: () => jsonResponse({}),
    });

    await proxy.handleMessage({ method: "tools/list" });

    expect(calls).toEqual([]);
    expect(errorOf(writtenMessages(writes)[0]!).code).toBe(-32600);
  });
});

describe("protocol headers", () => {
  it("sends the proxy's own protocol version, then the server-negotiated one", async () => {
    const { proxy, calls } = createProxy({
      respond: (call) =>
        call.body.method === "initialize"
          ? jsonResponse(
              rpcResult(call.body.id, { protocolVersion: "2025-03-26" }),
              200,
              {
                "mcp-session-id": "session-abc",
              },
            )
          : jsonResponse(rpcResult(call.body.id, { tools: [] })),
    });

    await proxy.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05" },
    });

    // The client's un-negotiated ask is never forwarded: a strict upstream
    // answers HTTP 400 before initialize negotiation can run.
    expect(calls[0]!.headers["MCP-Protocol-Version"]).toBe("2025-06-18");
    // No session exists yet, so the initialize call cannot carry one.
    expect(calls[0]!.headers["Mcp-Session-Id"]).toBeUndefined();

    await proxy.handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" });

    expect(calls[1]!.headers["MCP-Protocol-Version"]).toBe("2025-03-26");
    expect(calls[1]!.headers["Mcp-Session-Id"]).toBe("session-abc");
    expect(
      calls.some(
        (call) => call.headers["MCP-Protocol-Version"] === "2024-11-05",
      ),
    ).toBe(false);
  });
});

describe("upstream failures", () => {
  it("reports a 401 as -32001 with the credential sources the operator must check", async () => {
    const { proxy, writes } = createProxy({
      respond: () => jsonResponse({ error: { message: "invalid token" } }, 401),
    });

    await proxy.handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/list" });

    const error = errorOf(writtenMessages(writes)[0]!);
    expect(error.code).toBe(-32001);
    expect(error.message).toContain("ovcli.conf");
    expect(error.message).toContain("OPENVIKING_API_KEY");
    expect(error.data?.status).toBe(401);
  });

  it("reports a 403 as -32001 as well", async () => {
    const { proxy, writes } = createProxy({
      respond: () => jsonResponse({}, 403),
    });

    await proxy.handleMessage({ jsonrpc: "2.0", id: 4, method: "tools/list" });

    const error = errorOf(writtenMessages(writes)[0]!);
    expect(error.code).toBe(-32001);
    expect(error.data?.status).toBe(403);
  });

  it("reports any other non-2xx as -32002 with the status and server message", async () => {
    const { proxy, writes } = createProxy({
      respond: () => jsonResponse({ error: { message: "boom" } }, 500),
    });

    await proxy.handleMessage({ jsonrpc: "2.0", id: 5, method: "tools/list" });

    const error = errorOf(writtenMessages(writes)[0]!);
    expect(error.code).toBe(-32002);
    expect(error.message).toContain("HTTP 500");
    expect(error.data?.status).toBe(500);
    expect(error.data?.serverMessage).toBe("boom");
  });

  it("reports an empty upstream response as -32003", async () => {
    const { proxy, writes } = createProxy({
      respond: () =>
        new Response("", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    await proxy.handleMessage({ jsonrpc: "2.0", id: 6, method: "tools/list" });

    expect(errorOf(writtenMessages(writes)[0]!).code).toBe(-32003);
  });

  it("reports an aborted request as -32004 naming the timeout and the URL", async () => {
    const { proxy, writes } = createProxy({
      config: { timeoutMs: 25 },
      // Never answers: the proxy's own deadline is what ends the request.
      respond: (call) =>
        new Promise<Response>((_resolve, reject) => {
          call.signal?.addEventListener("abort", () => {
            const abort = new Error("The operation was aborted");
            abort.name = "AbortError";
            reject(abort);
          });
        }),
    });

    await proxy.handleMessage({ jsonrpc: "2.0", id: 8, method: "tools/list" });

    const error = errorOf(writtenMessages(writes)[0]!);
    expect(error.code).toBe(-32004);
    expect(error.message).toContain("25ms");
    expect(error.message).toContain("http://ov.local/mcp");
    expect(error.data?.timeoutMs).toBe(25);
    expect(error.data?.mcpUrl).toBe("http://ov.local/mcp");
  });

  it("reports an unreachable server as -32001 naming the URL", async () => {
    const { proxy, writes } = createProxy({
      respond: () => {
        throw new TypeError("fetch failed");
      },
    });

    await proxy.handleMessage({ jsonrpc: "2.0", id: 10, method: "tools/list" });

    const error = errorOf(writtenMessages(writes)[0]!);
    expect(error.code).toBe(-32001);
    expect(error.message).toContain("http://ov.local/mcp");
    expect(error.data?.cause).toBe("fetch failed");
  });
});

describe("session recovery", () => {
  /** A server whose session expires on the first non-initialize request. */
  function expiringServer(status: 400 | 404): {
    respond: (call: RecordedCall) => Response;
  } {
    let initializeCount = 0;
    let listCount = 0;
    return {
      respond: (call) => {
        if (call.body.method === "initialize") {
          initializeCount += 1;
          return jsonResponse(
            rpcResult(call.body.id, { protocolVersion: "2025-06-18" }),
            200,
            {
              "mcp-session-id": `session-${initializeCount}`,
            },
          );
        }
        listCount += 1;
        if (listCount > 1)
          return jsonResponse(rpcResult(call.body.id, { tools: [] }));
        return jsonResponse({ error: { message: "session gone" } }, status);
      },
    };
  }

  for (const status of [400, 404] as const) {
    it(`recovers from a ${status} by re-initializing once and retrying once`, async () => {
      const server = expiringServer(status);
      const { proxy, calls, writes } = createProxy({ respond: server.respond });

      await proxy.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18" },
      });
      await proxy.handleMessage({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      });

      expect(
        calls.filter((call) => call.body.method === "initialize"),
      ).toHaveLength(2);
      expect(
        calls.filter((call) => call.body.method === "tools/list"),
      ).toHaveLength(2);
      expect(writtenMessages(writes).at(-1)).toEqual(
        rpcResult(2, { tools: [] }),
      );
    });
  }

  it("does not re-initialize when the failing method is initialize itself", async () => {
    const { proxy, calls } = createProxy({
      respond: () => jsonResponse({ error: { message: "bad request" } }, 400),
    });

    await proxy.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    });

    expect(
      calls.filter((call) => call.body.method === "initialize"),
    ).toHaveLength(1);
  });
});

describe("stdout serialization", () => {
  it("never interleaves two concurrent responses", async () => {
    const { proxy, writes, events } = createProxy({
      respond: async (call) => {
        // Uneven latencies, so the two requests are genuinely in flight at once
        // and would interleave if each wrote without waiting for the other.
        await new Promise((resolve) =>
          setTimeout(resolve, call.body.id === 1 ? 10 : 2),
        );
        return jsonResponse(rpcResult(call.body.id, { echoed: call.body.id }));
      },
    });

    await Promise.all([
      proxy.handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      proxy.handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    ]);

    // Each write completes before the next one starts.
    expect(events).toEqual(["start:0", "end:0", "start:1", "end:1"]);
    expect(writes).toHaveLength(2);
    const messages = writtenMessages(writes);
    expect(messages.every((message) => message.jsonrpc === "2.0")).toBe(true);
    expect(new Set(messages.map((message) => message.id))).toEqual(
      new Set([1, 2]),
    );
  });
});

describe("localToolProvider", () => {
  const localTools = [
    {
      name: "openviking_find",
      description: "local find",
      inputSchema: { type: "object" },
    },
  ];

  function provider(
    callTool: LocalToolProvider["callTool"],
  ): LocalToolProvider {
    return { listTools: () => localTools, callTool };
  }

  it("appends the local tools to tools/list and drops colliding upstream ones", async () => {
    const { proxy, writes } = createProxy({
      respond: () =>
        jsonResponse(
          rpcResult(1, {
            tools: [
              { name: "upstream_only", description: "upstream" },
              {
                name: "openviking_find",
                description: "shadowed upstream copy",
              },
            ],
          }),
        ),
      localToolProvider: provider(vi.fn<LocalToolProvider["callTool"]>()),
    });

    await proxy.handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    const result = writtenMessages(writes)[0]!.result as {
      tools: { name: string }[];
    };
    expect(result.tools.map((tool) => tool.name)).toEqual([
      "upstream_only",
      "openviking_find",
    ]);
    expect(result.tools[1]).toEqual(localTools[0]);
  });

  it("answers a local tools/call without any upstream request", async () => {
    const callTool = vi.fn<LocalToolProvider["callTool"]>(async () => ({
      content: [{ type: "text", text: "local answer" }],
    }));
    const { proxy, calls, writes } = createProxy({
      respond: () => jsonResponse({}),
      localToolProvider: provider(callTool),
    });

    await proxy.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "openviking_find", arguments: { query: "budget" } },
    });

    expect(calls).toEqual([]);
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool.mock.calls[0]![0]).toEqual({
      name: "openviking_find",
      arguments: { query: "budget" },
    });
    expect(callTool.mock.calls[0]![1].config.mcpUrl).toBe(
      "http://ov.local/mcp",
    );
    expect(writtenMessages(writes)).toEqual([
      rpcResult(3, { content: [{ type: "text", text: "local answer" }] }),
    ]);
  });

  it("forwards an unknown tool name upstream", async () => {
    const callTool = vi.fn<LocalToolProvider["callTool"]>();
    const { proxy, calls } = createProxy({
      respond: () => jsonResponse(rpcResult(4, { content: [] })),
      localToolProvider: provider(callTool),
    });

    await proxy.handleMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "some_upstream_tool", arguments: {} },
    });

    expect(callTool).not.toHaveBeenCalled();
    expect(calls.map((call) => call.body.method)).toEqual(["tools/call"]);
  });
});

describe("request guard", () => {
  function proxyWithGuard(options?: {
    respond?: (call: RecordedCall) => Response;
  }) {
    return createProxy({
      respond: options?.respond ?? (() => jsonResponse(rpcResult(1, {}))),
      requestGuard: { guardRequest: guardEmptySearchParams },
    });
  }

  it("answers an empty grep pattern as invalid parameters without an upstream request", async () => {
    // The audited failure shape: the model read the empty-pattern "no matches"
    // answer as a real result and kept resending the empty call.
    const { proxy, calls, writes } = proxyWithGuard();

    await proxy.handleMessage({
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: {
        name: "grep",
        arguments: { pattern: [], uri: "viking://resources/" },
      },
    });

    expect(calls).toEqual([]);
    expect(writtenMessages(writes)).toEqual([
      {
        jsonrpc: "2.0",
        id: 11,
        error: {
          code: -32602,
          message: "pattern must be a non-empty string",
          data: { tool: "grep", param: "pattern" },
        },
      },
    ]);
  });

  it("rejects every empty shape of the guarded parameters", async () => {
    const cases = [
      { name: "grep", arguments: {} },
      { name: "grep", arguments: { pattern: "" } },
      { name: "grep", arguments: { pattern: "   " } },
      { name: "grep", arguments: { pattern: ["", "  "] } },
      { name: "grep", arguments: { pattern: [7] } },
      { name: "search", arguments: { query: "" } },
      { name: "find", arguments: {} },
    ];

    for (const [index, params] of cases.entries()) {
      const { proxy, calls, writes } = proxyWithGuard();

      await proxy.handleMessage({
        jsonrpc: "2.0",
        id: index,
        method: "tools/call",
        params,
      });

      expect(calls, JSON.stringify(params)).toEqual([]);
      const [write] = writtenMessages(writes);
      expect(write?.error, JSON.stringify(params)).toMatchObject({
        code: -32602,
      });
    }
  });

  it("forwards a well-formed guarded call upstream", async () => {
    const upstream = rpcResult(12, {
      content: [{ type: "text", text: "matches" }],
    });
    const { proxy, calls, writes } = proxyWithGuard({
      respond: () => jsonResponse(upstream),
    });

    await proxy.handleMessage({
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: {
        name: "grep",
        arguments: { pattern: ["budget", ""], uri: "viking://resources/" },
      },
    });

    expect(calls).toHaveLength(1);
    expect(writtenMessages(writes)).toEqual([upstream]);
  });

  it("leaves unguarded tools and notifications alone", async () => {
    const { proxy, calls, writes } = proxyWithGuard({
      // Echo the request id: the proxy writes the upstream answer verbatim.
      respond: (call) =>
        jsonResponse(rpcResult((call.body as { id?: unknown }).id, {})),
    });

    await proxy.handleMessage({
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: { name: "read", arguments: { uris: "" } },
    });
    await proxy.handleMessage({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { name: "grep" },
    });

    // Both messages forward; the notification writes nothing back.
    expect(calls.map((call) => call.body.method)).toEqual([
      "tools/call",
      "notifications/cancelled",
    ]);
    expect(writtenMessages(writes)).toEqual([rpcResult(13, {})]);
  });
});

describe("upstream tool schema adjustment", () => {
  const upstreamTools = [
    {
      name: "grep",
      inputSchema: {
        type: "object",
        properties: {
          uri: { type: "string" },
          pattern: { type: ["string", "array"], description: "text to find" },
        },
      },
    },
    {
      name: "search",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
      },
    },
    {
      name: "read",
      inputSchema: {
        type: "object",
        properties: { uris: {} },
        required: ["uris"],
      },
    },
  ];

  function proxyWithAdjuster() {
    return createProxy({
      respond: () =>
        jsonResponse(rpcResult(1, { tools: structuredClone(upstreamTools) })),
      adjustUpstreamTool: requireSearchParamsInSchema,
    });
  }

  it("marks the guarded parameters required in tools/list answers", async () => {
    const { proxy, writes } = proxyWithAdjuster();

    await proxy.handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    const tools = (writtenMessages(writes)[0]!.result as {
      tools: {
        name: string;
        inputSchema: {
          properties?: Record<string, Record<string, unknown>>;
          required?: string[];
        };
      }[];
    }).tools;

    expect(tools.map((tool) => tool.name)).toEqual(["grep", "search", "read"]);
    const grep = tools[0]!;
    expect(grep.inputSchema.required).toEqual(["pattern"]);
    // `pattern` accepts a string or a list, so the array shape gets `minItems`.
    expect(grep.inputSchema.properties?.["pattern"]).toMatchObject({
      minItems: 1,
    });
    expect(grep.inputSchema.properties?.["uri"]).toEqual({ type: "string" });
    expect(tools[1]!.inputSchema.required).toEqual(["query"]);
    expect(tools[1]!.inputSchema.properties?.["query"]).toMatchObject({
      minLength: 1,
    });
    // An unguarded tool is re-cloned but not otherwise touched.
    expect(tools[2]!.inputSchema).toEqual(upstreamTools[2]!.inputSchema);
  });

  it("does not mutate the upstream answer objects", async () => {
    const { proxy, writes } = proxyWithAdjuster();

    await proxy.handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    void writtenMessages(writes);
    expect(upstreamTools[0]!.inputSchema.required).toBeUndefined();
    expect(upstreamTools[1]!.inputSchema.required).toBeUndefined();
  });

  it("drops a tool the adjuster returns null for", async () => {
    const { proxy, writes } = createProxy({
      respond: () =>
        jsonResponse(
          rpcResult(1, {
            tools: [{ name: "secret" }, { name: "kept" }],
          }),
        ),
      adjustUpstreamTool: (tool) => (tool.name === "secret" ? null : tool),
    });

    await proxy.handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    const tools = (writtenMessages(writes)[0]!.result as {
      tools: { name: string }[];
    }).tools;
    expect(tools.map((tool) => tool.name)).toEqual(["kept"]);
  });
});

describe("debug-log createLogger", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "ov-debug-log-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("is a no-op that never touches the filesystem when debug is off", async () => {
    const path = join(directory, "nested", "debug.ndjson");
    const logger = createLogger("mcp-proxy", {
      debug: false,
      debugLogPath: path,
    });

    logger.log("start", { mcpUrl: "http://ov.local/mcp" });
    logger.logError("start", new Error("nope"));

    expect(existsSync(path)).toBe(false);
    expect(existsSync(join(directory, "nested"))).toBe(false);

    // Debug on but no destination is the same no-op, not a crash on an
    // undefined path.
    const pathless = createLogger("mcp-proxy", { debug: true });
    const unset = createLogger("mcp-proxy", null);
    expect(() => {
      pathless.log("start");
      pathless.logError("start", "boom");
      unset.log("start");
      unset.logError("start", "boom");
    }).not.toThrow();
    expect(existsSync(join(directory, "nested"))).toBe(false);
  });

  it("appends one NDJSON object per call when debug is on", async () => {
    const path = join(directory, "debug.ndjson");
    const logger = createLogger("mcp-proxy", {
      debug: true,
      debugLogPath: path,
    });

    logger.log("start", { mcpUrl: "http://ov.local/mcp" });
    logger.log("credentials_reloaded", { reason: "auth_failure" });
    logger.logError("request_failed", new Error("kaboom"));

    const lines = (await readFile(path, "utf8")).trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    const entries = lines.map(
      (line) => JSON.parse(line) as Record<string, unknown>,
    );

    for (const entry of entries) {
      expect(entry.hook).toBe("mcp-proxy");
      expect(typeof entry.ts).toBe("string");
      expect(Number.isNaN(Date.parse(entry.ts as string))).toBe(false);
    }

    expect(entries[0]).toMatchObject({
      stage: "start",
      data: { mcpUrl: "http://ov.local/mcp" },
    });
    expect(entries[1]).toMatchObject({
      stage: "credentials_reloaded",
      data: { reason: "auth_failure" },
    });
    expect(entries[2]!.stage).toBe("request_failed");
    expect(entries[2]!.data).toBeUndefined();
    expect(entries[2]!.error).toMatchObject({ message: "kaboom" });
    expect(typeof (entries[2]!.error as { stack?: unknown }).stack).toBe(
      "string",
    );
  });

  it("records a thrown non-Error as a string", async () => {
    const path = join(directory, "debug.ndjson");
    const logger = createLogger("mcp-proxy", {
      debug: true,
      debugLogPath: path,
    });

    logger.logError("request_failed", "plain string");

    const entry = JSON.parse((await readFile(path, "utf8")).trim()) as Record<
      string,
      unknown
    >;
    expect(entry.error).toBe("plain string");
  });
});

describe("buildMcpProxyConfig", () => {
  it("derives the MCP URL from the base URL and trims its trailing slashes", () => {
    expect(
      buildMcpProxyConfig({ baseUrl: "http://ov.local/", env: {} }).mcpUrl,
    ).toBe("http://ov.local/mcp");
    expect(trimSlash("http://ov.local///")).toBe("http://ov.local");
  });

  it("clamps the timeout to at least one second", () => {
    expect(
      buildMcpProxyConfig({ baseUrl: "http://ov.local", env: {} }).timeoutMs,
    ).toBe(DEFAULT_PROXY_TIMEOUT_MS);
    expect(
      buildMcpProxyConfig({ baseUrl: "http://ov.local", timeoutMs: 5, env: {} })
        .timeoutMs,
    ).toBe(1000);
    expect(
      buildMcpProxyConfig({
        baseUrl: "http://ov.local",
        timeoutMs: 45000,
        env: {},
      }).timeoutMs,
    ).toBe(45000);
  });

  it("deduplicates the watched paths and always includes the two default ones", () => {
    const config = buildMcpProxyConfig({
      baseUrl: "http://ov.local",
      watchedPaths: ["/tmp/custom.conf", "/tmp/custom.conf", ""],
      env: {},
    });

    expect(config.watchedPaths).toContain(
      join(homedir(), ".openviking", "ovcli.conf"),
    );
    expect(config.watchedPaths).toContain(
      join(homedir(), ".openviking", "ov.conf"),
    );
    expect(
      config.watchedPaths.filter((path) => path === "/tmp/custom.conf"),
    ).toHaveLength(1);
    expect(new Set(config.watchedPaths).size).toBe(config.watchedPaths.length);
    expect(config.watchedPaths).not.toContain("");
  });

  it("lets an explicit mcpUrl win over the base URL", () => {
    const config = buildMcpProxyConfig({
      baseUrl: "http://ov.local",
      mcpUrl: "http://elsewhere.local/custom",
      env: {},
    });

    expect(config.mcpUrl).toBe("http://elsewhere.local/custom");
  });

  it("expands `~` and lists the environment overrides before the defaults", () => {
    expect(normalizeConfigPath("~")).toBe(homedir());
    expect(normalizeConfigPath("~/ov/ovcli.conf")).toBe(
      join(homedir(), "ov", "ovcli.conf"),
    );
    expect(normalizeConfigPath("")).toBe("");

    const paths = defaultCredentialPaths({
      OPENVIKING_CLI_CONFIG_FILE: "~/cli.conf",
      OPENVIKING_CONFIG_FILE: "",
    });
    expect(paths[0]).toBe(join(homedir(), "cli.conf"));
    expect(paths).toEqual([
      join(homedir(), "cli.conf"),
      join(homedir(), ".openviking", "ovcli.conf"),
      join(homedir(), ".openviking", "ov.conf"),
    ]);
  });
});

describe("readProxyConfig", () => {
  const env: NodeJS.ProcessEnv = {
    OPENVIKING_URL: "http://ov.local/",
    OPENVIKING_API_KEY: "env-key",
    OPENVIKING_ACCOUNT: "acme",
    OPENVIKING_USER: "casey",
    OPENVIKING_PEER_ID: "peer-7",
    // Point the credential chain at files that do not exist, so a developer's
    // own ~/.openviking cannot decide the outcome.
    OPENVIKING_CLI_CONFIG_FILE: join(tmpdir(), "ov-absent-ovcli.conf"),
    OPENVIKING_CONFIG_FILE: join(tmpdir(), "ov-absent-ov.conf"),
  };

  it("resolves the child env into the proxy's credentials", () => {
    const config = readProxyConfig(env, "/workspace");

    expect(config.mcpUrl).toBe("http://ov.local/mcp");
    expect(config.apiKey).toBe("env-key");
    expect(config.account).toBe("acme");
    expect(config.user).toBe("casey");
    expect(config.peerId).toBe("peer-7");
    expect(config.userAgent).toMatch(/^openviking-memory-dsh\//);
  });

  it("keeps debug logging off while OV_DEBUG_LOG is unset", () => {
    const config = readProxyConfig(env, "/workspace");

    expect(config.debug).toBe(false);
    expect(config.debugLogPath).toBe("");
  });

  it("uses OV_DEBUG_LOG as the debug log path", () => {
    const config = readProxyConfig(
      { ...env, OV_DEBUG_LOG: "C:/tmp/ov.ndjson" },
      "/workspace",
    );

    expect(config.debug).toBe(true);
    expect(config.debugLogPath).toBe("C:/tmp/ov.ndjson");
  });
});
