import type { Context } from "@deepseek-ai/cordis";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apply } from "../src/index.js";
import { createRewriteTool, createStatusTool } from "../src/tools.js";
import { dependencies, execution, json, normal, server } from "./helpers.js";

const cleanup: (() => Promise<void>)[] = [];
let logHome: string;
let previousHome: string | undefined;
beforeEach(async () => {
  logHome = await mkdtemp(join(tmpdir(), "humanizer-lifecycle-"));
  previousHome = process.env["DSH_HOME"];
  process.env["DSH_HOME"] = logHome;
});
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
  if (previousHome === undefined) delete process.env["DSH_HOME"];
  else process.env["DSH_HOME"] = previousHome;
  await rm(logHome, { recursive: true, force: true });
});
async function rig(handler = normal) {
  const result = await server(handler);
  cleanup.push(result.close);
  return result;
}

describe("transport bounds and lifecycle", () => {
  it("never follows redirects with the draft or bearer key", async () => {
    const target = await rig();
    const redirect = await rig((_request, response) => {
      response.writeHead(307, { Location: target.endpoint + "/completion" });
      response.end();
    });
    await expect(
      createRewriteTool(
        dependencies(redirect.endpoint, { apiKey: "demo-bearer-key" }),
      ).execute({ text: "Draft." }, execution()),
    ).rejects.toThrow("UNAVAILABLE");
    expect(target.requests).toHaveLength(0);
  });

  it.each([
    ["bad JSON", "INVALID_RESPONSE"],
    [JSON.stringify({ content: "" }), "EMPTY_RESPONSE"],
    [JSON.stringify({ content: 42 }), "EMPTY_RESPONSE"],
    [JSON.stringify({ content: "x".repeat(300000) }), "RESPONSE_TOO_LARGE"],
  ])(
    "rejects malformed/oversized completion payloads without echoing them: %s",
    async (payload, code) => {
      const remote = await rig((request, response, body) => {
        if (request.url === "/completion") response.end(payload);
        else normal(request, response, body);
      });
      await expect(
        createRewriteTool(
          dependencies(remote.endpoint, { maxOutputBytes: 1024 }),
        ).execute({ text: "Draft." }, execution()),
      ).rejects.toThrow(code);
    },
  );

  it("rejects malformed token and capacity data", async () => {
    for (const path of ["/props", "/tokenize"]) {
      const remote = await rig((request, response, body) => {
        if (request.url === path)
          json(response, {
            tokens: ["bad"],
            default_generation_settings: { n_ctx: "bad" },
          });
        else normal(request, response, body);
      });
      await expect(
        createRewriteTool(dependencies(remote.endpoint)).execute(
          { text: "Draft." },
          execution(),
        ),
      ).rejects.toThrow("INVALID_RESPONSE");
    }
  });

  it("sanitizes errors that contain the submitted text", async () => {
    const remote = await rig((request, response, body) => {
      if (request.url === "/completion")
        json(
          response,
          { error: body["prompt"], key: "private server key" },
          500,
        );
      else normal(request, response, body);
    });
    try {
      await createRewriteTool(dependencies(remote.endpoint)).execute(
        { text: "Sensitive draft." },
        execution(),
      );
      throw new Error("expected an HTTP failure");
    } catch (error) {
      expect(String(error)).toContain("HTTP_500");
      expect(String(error)).not.toContain("Sensitive");
      expect(String(error)).not.toContain("private server key");
    }
  });

  it("honors caller cancellation while inference is active", async () => {
    let started!: () => void;
    const active = new Promise<void>((resolve) => {
      started = resolve;
    });
    const remote = await rig((request, response, body) => {
      if (request.url === "/completion") started();
      else normal(request, response, body);
    });
    const caller = new AbortController();
    const result = createRewriteTool(dependencies(remote.endpoint)).execute(
      { text: "Draft." },
      execution(caller.signal),
    );
    const assertion = expect(result).rejects.toThrow("CANCELLED");
    await active;
    caller.abort();
    await assertion;
  });

  it("times out an unresponsive server within the overall tool budget", async () => {
    const remote = await rig(() => {});
    const result = await createStatusTool(
      dependencies(remote.endpoint, { timeoutMs: 1000 }),
    ).execute({}, execution());
    expect(result).toEqual({
      status: "unavailable",
      contextTokens: 0,
      errorCode: "TIMEOUT",
    });
  });

  it("aborts active calls on plugin disposal and removes tool registrations", async () => {
    let started!: () => void;
    const active = new Promise<void>((resolve) => {
      started = resolve;
    });
    const remote = await rig((request, response, body) => {
      if (request.url === "/completion") started();
      else normal(request, response, body);
    });
    const tools = new Map<string, ToolDefinition>();
    const ctx = {
      tools: {
        register(tool: ToolDefinition) {
          tools.set(tool.name, tool);
          return () => {
            tools.delete(tool.name);
          };
        },
      },
    } as unknown as Context;
    const dispose = apply(ctx, { endpoint: remote.endpoint });
    cleanup.push(dispose);
    const tool = tools.get("dsh_humanize_text")!;
    const assertion = expect(
      tool.execute({ text: "Draft." }, execution()),
    ).rejects.toThrow("CANCELLED");
    await active;
    await dispose();
    await assertion;
    expect(tools.size).toBe(0);
    await expect(
      tool.execute({ text: "Draft." }, execution()),
    ).rejects.toThrow();
  });

  it("preserves caller cancellation for the status tool", async () => {
    const remote = await rig();
    const caller = new AbortController();
    caller.abort();
    await expect(
      createStatusTool(dependencies(remote.endpoint)).execute(
        {},
        execution(caller.signal),
      ),
    ).rejects.toThrow("CANCELLED");
    expect(remote.requests).toHaveLength(0);
  });
});
