import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import { expect, it } from "vitest";
import plugin from "../src/index.js";
import { json, normal, server } from "./helpers.js";

it("loads through Cordis and executes canonical output in the Host 0.2.0 tool runtime", async () => {
  const previousHome = process.env["DSH_HOME"];
  const logHome = await mkdtemp(join(tmpdir(), "humanizer-host-"));
  process.env["DSH_HOME"] = logHome;
  const remote = await server((request, response, body) => {
    if (request.url === "/completion")
      json(response, {
        content: "Rewritten draft with 12 units.",
        stop_type: "eos",
      });
    else normal(request, response, body);
  });
  const ctx = new Context();
  // Only the presentation service is a stub. Cordis, injection, registry,
  // dispatch, argument/output schema checks and disposal use the real runtime.
  ctx.provide("systemPrompt", { tools: () => () => {} });
  const runtime = await ctx.plugin(ToolRuntime);
  const fiber = await ctx.plugin(plugin, { endpoint: remote.endpoint });
  try {
    expect(ctx.tools.schemas().map((tool) => tool.name)).toEqual([
      "dsh_humanize_text",
      "dsh_humanizer_status",
    ]);
    const result = await ctx.tools.execute({
      callId: "demo-humanize-call" as Parameters<
        typeof ctx.tools.execute
      >[0]["callId"],
      name: "dsh_humanize_text",
      arguments: { text: "Original draft with 12 units." },
      signal: new AbortController().signal,
    });
    expect(result.isError).toBe(false);
    if (result.isError) throw new Error(JSON.stringify(result));
    expect(result.value).toMatchObject({
      rewrittenText: "Rewritten draft with 12 units.",
      truncated: false,
    });
    expect(result.content).toContainEqual(
      expect.objectContaining({ type: "text" }),
    );
    await fiber.dispose();
    expect(ctx.tools.schemas()).toEqual([]);
  } finally {
    await fiber.dispose();
    await runtime.dispose();
    await remote.close();
    if (previousHome === undefined) delete process.env["DSH_HOME"];
    else process.env["DSH_HOME"] = previousHome;
    await rm(logHome, { recursive: true, force: true });
  }
});
