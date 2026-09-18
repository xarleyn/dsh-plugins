/**
 * The vendored stdio -> streamable-HTTP MCP proxy core, driven directly.
 *
 * Nothing here starts the proxy: `start()` would attach to the real stdio and
 * its callbacks call `process.exit`. `handleMessage` is the same protocol path
 * without either, and the stdio streams, the config reader, the logger and the
 * transport are all injected, which is exactly how upstream expects the factory
 * to be used.
 */

import { describe, expect, it, vi } from "vitest";

import {
  guardEmptySearchParams,
  requireSearchParamsInSchema,
} from "../src/servers/mcp-proxy.js";
import {
  createProxy,
  jsonResponse,
  rpcResult,
  writtenMessages,
  type LocalToolProvider,
  type RecordedCall,
} from "./mcp-proxy.helpers.js";

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

    const tools = (
      writtenMessages(writes)[0]!.result as {
        tools: {
          name: string;
          inputSchema: {
            properties?: Record<string, Record<string, unknown>>;
            required?: string[];
          };
        }[];
      }
    ).tools;

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

    const tools = (
      writtenMessages(writes)[0]!.result as {
        tools: { name: string }[];
      }
    ).tools;
    expect(tools.map((tool) => tool.name)).toEqual(["kept"]);
  });
});
