import { Context } from "@deepseek-ai/cordis";
import type SettingsForms from "@deepseek-ai/dsh-settings";
import {
  SettingsConflictError,
  type SettingsNamespace,
} from "@deepseek-ai/dsh-settings";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import { describe, expect, it } from "vitest";
import { readVolatileConfig } from "../src/config.js";
import PromptFirewall, {
  PROMPT_FIREWALL_SETTINGS_NAMESPACE,
} from "../src/index.js";
import type { PromptFirewallVolatileConfig } from "../src/types.js";

interface RecordedWrite {
  ns: string;
  patch: Record<string, unknown>;
  expectedRevision: number | undefined;
}

/**
 * Stands in for the part of `SettingsForms` this plugin writes through: the
 * profile document, its revision fence, and the record of what was sent. The
 * real service keeps its own state behind the Host loader and config editor,
 * so the fake is provided under the `settings` name rather than subclassed.
 */
class MemorySettings {
  private readonly revisions = new Map<string, number>();
  readonly writes: RecordedWrite[] = [];

  async update(
    ns: string,
    patch: object,
    expectedRevision?: number,
  ): Promise<void> {
    const revision = this.revisions.get(ns) ?? 0;
    if (expectedRevision !== undefined && expectedRevision !== revision) {
      throw new SettingsConflictError(
        ns as SettingsNamespace,
        expectedRevision,
        revision,
      );
    }
    this.writes.push({
      ns,
      patch: structuredClone(patch) as Record<string, unknown>,
      expectedRevision,
    });
    this.revisions.set(ns, revision + 1);
  }
}

async function mountedContext(config: Record<string, unknown> = {}) {
  const ctx = new Context();
  const settings = new MemorySettings();
  await ctx.plugin(SystemPrompt);
  await ctx.plugin((host: Context) => {
    host.provide("settings", settings as unknown as SettingsForms);
  });
  await ctx.plugin(PromptFirewall, config);
  return { ctx, settings };
}

describe("entry config as the live settings namespace", () => {
  it("reads every volatile field once per snapshot", () => {
    let enabled = true;
    const config: PromptFirewallVolatileConfig = {
      enabled: { get: () => enabled },
      blockedSections: { get: () => ["plugin:one"] },
    };
    expect(readVolatileConfig(config)).toMatchObject({
      enabled: true,
      blockedSections: ["plugin:one"],
    });

    enabled = false;
    expect(readVolatileConfig(config).enabled).toBe(false);
  });

  it("applies the mounted entry config to prompt assembly", async () => {
    const { ctx } = await mountedContext({
      blockedSections: ["plugin:dynamic"],
    });
    ctx.systemPrompt.section({
      name: "plugin:dynamic",
      order: 10,
      text: "dynamic",
    });
    ctx.systemPrompt.section({
      name: "plugin:kept",
      order: 20,
      text: "kept",
    });

    expect(ctx.promptFirewall.getConfig().blockedSections).toContain(
      "plugin:dynamic",
    );
    const names = (await ctx.systemPrompt.assemble()).sections.map(
      (section) => section.name,
    );
    expect(names).not.toContain("plugin:dynamic");
    expect(names).toContain("plugin:kept");
  });

  it.each([
    {
      action: "block" as const,
      section: "plugin:third",
      patch: {
        blockedSections: ["plugin:first", "plugin:third"],
        allowedSections: ["plugin:second"],
        protectedSections: [],
      },
    },
    {
      action: "protect" as const,
      section: "plugin:first",
      patch: {
        blockedSections: [],
        allowedSections: ["plugin:second"],
        protectedSections: ["plugin:first"],
      },
    },
    {
      action: "allow" as const,
      section: "plugin:first",
      patch: {
        blockedSections: [],
        allowedSections: ["plugin:second", "plugin:first"],
        protectedSections: [],
      },
    },
    {
      action: "clear" as const,
      section: "plugin:first",
      patch: {
        blockedSections: [],
        allowedSections: ["plugin:second"],
        protectedSections: [],
      },
    },
  ])(
    "writes a $action patch into the profile entry namespace",
    async ({ action, section, patch }) => {
      const { ctx, settings } = await mountedContext({
        blockedSections: ["plugin:first"],
        allowedSections: ["plugin:second"],
      });
      await ctx.promptFirewall.setSectionPolicy(section, action);
      expect(settings.writes).toEqual([
        {
          ns: PROMPT_FIREWALL_SETTINGS_NAMESPACE,
          patch,
          expectedRevision: undefined,
        },
      ]);
    },
  );

  it("forwards the revision fence to a conflicting write", async () => {
    const { ctx } = await mountedContext();
    await ctx.promptFirewall.setSectionPolicy("plugin:first", "block", 0);
    await expect(
      ctx.promptFirewall.setSectionPolicy("plugin:second", "block", 0),
    ).rejects.toBeInstanceOf(SettingsConflictError);
  });

  it("fails clearly when no settings provider is mounted", async () => {
    const ctx = new Context();
    await ctx.plugin(SystemPrompt);
    await ctx.plugin(PromptFirewall);
    await expect(
      ctx.promptFirewall.setSectionPolicy("plugin:foo", "block"),
    ).rejects.toThrow("mount a DSH settings provider");
  });
});
