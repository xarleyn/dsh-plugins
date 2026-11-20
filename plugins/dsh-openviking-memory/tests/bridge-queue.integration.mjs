import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { join } from "node:path";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import * as bridge from "@deepseek-ai/dsh-mcp-client";
import { buildMcpConfig } from "../lib/mcp.js";

const { AbortController, AbortSignal } = globalThis;

test(
  "the DSH bridge cancels a queued tool before HTTP dispatch",
  { timeout: 15000 },
  async (t) => {
    const tmp = await mkdtemp(join(tmpdir(), "ov-bridge-"));
    const tools = new Map();
    const held = [];
    const until = (event) =>
      once(peer, event, { signal: AbortSignal.timeout(5000) });
    let timedCallId;
    const trace = [];
    const started = performance.now();
    const record = (event) =>
      trace.push([event, Math.round(performance.now() - started)]);
    const peer = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      if (req.method === "DELETE") {
        res.writeHead(204).end();
        return;
      }
      const { id, method, params } = JSON.parse(
        Buffer.concat(chunks).toString(),
      );
      const reply = (result) =>
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ jsonrpc: "2.0", id, result }));
      if (method === "initialize") {
        reply({
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "fixture", version: "1" },
        });
      } else if (method === "tools/list") {
        reply({
          tools: ["hold", "search"].map((name) => ({
            name,
            inputSchema: {
              type: "object",
              properties: { label: { type: "string" } },
            },
          })),
        });
      } else if (method === "tools/call") {
        const label = params.arguments.label;
        const finish = () => reply({ content: [{ type: "text", text: "ok" }] });
        if (label === "held") {
          held.push(finish);
          if (held.length === 16) {
            record("16 dispatched");
            peer.emit("full");
          }
        } else if (label === "outer-timeout") {
          timedCallId = id;
          record("timed call dispatched");
        } else {
          record(label + " dispatched");
          finish();
        }
      } else {
        if (method === "notifications/cancelled") {
          record("upstream cancel");
          if (params.requestId === timedCallId)
            peer.emit("timed-call-cancelled");
        }
        res.writeHead(202).end();
      }
    });
    peer.listen(0, "127.0.0.1");
    await once(peer, "listening");
    const ctx = new Context();
    ctx.provide("tools", {
      register(definition) {
        tools.set(definition.name, definition);
        return () => tools.delete(definition.name);
      },
    });
    const config = buildMcpConfig({
      endpoint: `http://127.0.0.1:${peer.address().port}`,
      apiKey: "fixture",
      requestTimeoutMs: 5000,
      mcpToolCallTimeoutMs: 1000,
    });
    const missing = join(tmp, "absent.conf");
    Object.assign(config.env, {
      OPENVIKING_CLI_CONFIG_FILE: missing,
      OPENVIKING_CONFIG_FILE: missing,
      HOME: tmp,
      USERPROFILE: tmp,
      OV_DEBUG_LOG: "",
    });
    const fiber = ctx.plugin(bridge, { ...config, failOnStartupError: true });
    const call = (name, label, signal = new AbortController().signal) =>
      tools.get("mcp__openviking__" + name).execute({ label }, { signal });
    let holders;
    try {
      await fiber.await();
      assert.ok(
        tools.has("mcp__openviking__hold"),
        "bridge must register the upstream tool",
      );
      const full = until("full");
      holders = Promise.allSettled(
        Array.from({ length: 16 }, () => call("hold", "held")),
      );
      await full;
      const stop = new AbortController();
      record("17 submitted");
      const queued = call("hold", "queued", stop.signal);
      // A locally rejected call fences stdio input while all 16 HTTP permits are held.
      const fence = () =>
        assert.rejects(
          call("search", "fence"),
          /query must be a non-empty string/,
        );
      await fence();
      record("17 queued");
      record("17 cancelled");
      stop.abort(new Error("cancel queued operation"));
      await assert.rejects(queued, /cancel queued operation/);
      record("17 caller settled");
      await fence();
      for (const finish of held) finish();
      const results = await holders;
      assert.ok(results.every((result) => result.status === "fulfilled"));
      await call("hold", "fresh");
      assert.ok(
        !trace.some(([event]) => event === "queued dispatched"),
        "cancelled tool reached HTTP",
      );
      // Exercise the SDK's own toolCallTimeoutMs on a dispatched request as well.
      await Promise.all([
        until("timed-call-cancelled"),
        assert.rejects(call("hold", "outer-timeout"), /timed out/i),
      ]);
      record("outer deadline observed by caller and peer");
    } finally {
      t.diagnostic(JSON.stringify(trace));
      peer.closeAllConnections();
      await fiber.dispose();
      await ctx.fiber.dispose();
      await holders;
      await new Promise((resolve) => peer.close(resolve));
      await rm(tmp, { recursive: true, force: true });
    }
  },
);
