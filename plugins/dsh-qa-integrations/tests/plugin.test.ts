/**
 * The plugin entry: the settings namespace it serves and what it registers.
 *
 * The card of the host's "Plugin configuration" tab only appears where the Host
 * serves the namespace the card keys on, so the install path is pinned here
 * against a real settings provider rather than asserted by string.
 */

import { Context } from "@deepseek-ai/cordis";
import SettingsProvider, {
  type SettingsNamespace,
} from "@deepseek-ai/dsh-settings";
import { describe, expect, it } from "vitest";
import QaIntegrations, {
  name as pluginName,
  QA_INTEGRATIONS_SETTINGS_NAMESPACE,
} from "../src/index.js";

/** In-memory settings provider: the smallest host the install path needs. */
class MemorySettings extends SettingsProvider {
  private readonly storageDocument: Record<string, unknown>;
  override readonly writable = true;

  constructor(ctx: Context, document: Record<string, unknown> = {}) {
    super(ctx);
    this.storageDocument = structuredClone(document);
  }

  protected override load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.storageDocument));
  }

  protected override persist(
    ns: SettingsNamespace,
    section: Record<string, unknown>,
  ): Promise<void> {
    this.storageDocument[ns] = structuredClone(section);
    return Promise.resolve();
  }
}

/** The host services the plugin waits for, with the namespace provider. */
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
  await ctx.plugin(MemorySettings, {});
  await ctx.plugin(QaIntegrations, { enabled: false, ...config });
  return { ctx, tools };
}

describe("integrations plugin entry", () => {
  it("identifies itself by id and serves the namespace the card keys on", async () => {
    const { ctx } = await host();
    expect(pluginName).toBe("dsh-qa-integrations");
    expect(QA_INTEGRATIONS_SETTINGS_NAMESPACE).toBe("qa-integrations");
    const descriptor = ctx.settings
      .describe()
      .find((item) => item.ns === QA_INTEGRATIONS_SETTINGS_NAMESPACE);
    expect(descriptor).toBeDefined();
  });

  it("registers no tool while the deployment disabled the plugin", async () => {
    const { tools } = await host({ enabled: false });
    expect(tools).toEqual([]);
  });
});
