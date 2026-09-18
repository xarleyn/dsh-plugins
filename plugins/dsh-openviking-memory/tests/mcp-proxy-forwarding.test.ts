/**
 * The vendored stdio -> streamable-HTTP MCP proxy core, driven directly.
 *
 * Nothing here starts the proxy: `start()` would attach to the real stdio and
 * its callbacks call `process.exit`. `handleMessage` is the same protocol path
 * without either, and the stdio streams, the config reader, the logger and the
 * transport are all injected, which is exactly how upstream expects the factory
 * to be used.
 */

import { describe, expect, it } from "vitest";

import {
  createProxy,
  errorOf,
  jsonResponse,
  rpcResult,
  writtenMessages,
} from "./mcp-proxy.helpers.js";

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
