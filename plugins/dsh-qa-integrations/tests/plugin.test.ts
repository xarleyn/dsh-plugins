/**
 * The plugin entry: its identity and server-side registration behavior. The
 * browser UI is feature-owned, so the Host half must not require a settings
 * provider merely to make that UI discoverable.
 */

import { Context } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";
import QaIntegrations, { name as pluginName } from "../src/index.js";

/** The host services the plugin waits for; no settings provider is installed. */
async function host(
  config: Record<string, unknown> = {},
): Promise<{ ctx: Context; tools: string[] }> {
  const tools: string[] = [];
  const ctx = new Context();
  ctx.provide("qaSurface", {
    registerPrincipalScopedTools: () => () => {},
    principalForSession: () => undefined,
    principalForToken: () => undefined,
  } as never);
  ctx.provide("tools", {
    register: (definition: { name: string }) => {
      tools.push(definition.name);
      return () => {};
    },
  } as never);
  await ctx.plugin(QaIntegrations, { enabled: false, ...config });
  return { ctx, tools };
}

describe("integrations plugin entry", () => {
  it("identifies itself and loads without a settings provider", async () => {
    await host();
    expect(pluginName).toBe("dsh-qa-integrations");
  });

  it("registers no tool while the deployment disabled the plugin", async () => {
    const { tools } = await host({ enabled: false });
    expect(tools).toEqual([]);
  });
});
