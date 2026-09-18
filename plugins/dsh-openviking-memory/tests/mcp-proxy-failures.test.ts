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
  type RecordedCall,
} from "./mcp-proxy.helpers.js";

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
