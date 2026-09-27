/**
 * The plugin entry: its identity, server-side registration behavior, and the
 * live apply of operator card edits. The plugin declines the Host's generated
 * settings page for its own entry only when a settings service is mounted, so
 * the Host half must not require one merely to serve the browser UI.
 */

import { Context } from "@deepseek-ai/cordis";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import QaIntegrations, { name as pluginName } from "../src/index.js";
import { SERVICE_CEILING_NOTICE } from "../src/providers/shared/service-boundary.js";
import { IntegrationRepository } from "../src/repository.js";

/** What the plugin asked the mounted settings service to do for its entry. */
interface ConfigureCapture {
  presentation: { auto?: boolean };
  owner: unknown;
}

/** The Loader's commit signal, dispatched to the owning fiber alone. */
interface VolatileUpdateEmitFace {
  emit(
    name: "loader/volatile-update",
    paths: readonly (readonly string[])[],
  ): void;
}

/** The plugin's own fiber, read the way the Loader reads it. */
interface FiberFace {
  readonly config: unknown;
  readonly ctx: Context;
  dispose(): Promise<void>;
}

/** The host services the plugin waits for; no settings provider by default. */
async function host(
  config: Record<string, unknown> = {},
  options: { withSettings?: boolean } = {},
): Promise<{
  ctx: Context;
  tools: string[];
  removed: string[];
  descriptions: Map<string, string>;
  configured: ConfigureCapture[];
  /**
   * Commit an operator edit the way the Loader does: replace the entry's
   * volatile references, then tell the owning fiber they moved.
   */
  commit(patch: Record<string, unknown>): void;
  fiber: FiberFace;
}> {
  const tools: string[] = [];
  const removed: string[] = [];
  // What each mounted tool says about itself, by name: the ceiling a managed
  // credential meets is part of a description, and a remount has to refresh it.
  const descriptions = new Map<string, string>();
  const configured: ConfigureCapture[] = [];
  const ctx = new Context();
  ctx.provide("qaSurface", {
    registerPrincipalScopedTools: () => () => {},
    principalForSession: () => undefined,
    principalForToken: () => undefined,
  } as never);
  ctx.provide("tools", {
    register: (definition: { name: string; description: string }) => {
      tools.push(definition.name);
      descriptions.set(definition.name, definition.description);
      return () => {
        // The active set shrinks, so live disable assertions see it.
        tools.splice(tools.indexOf(definition.name), 1);
        descriptions.delete(definition.name);
        removed.push(definition.name);
      };
    },
  } as never);
  if (options.withSettings === true) {
    ctx.provide("settings", {
      configure: (presentation: { auto?: boolean }, owner: unknown) => {
        configured.push({ presentation, owner });
        return () => {};
      },
    } as never);
  }
  const fiber = (await ctx.plugin(QaIntegrations, {
    enabled: false,
    ...config,
  })) as unknown as FiberFace;
  return {
    ctx,
    tools,
    removed,
    descriptions,
    configured,
    fiber,
    commit(patch: Record<string, unknown>) {
      const live = fiber.config as Record<string, unknown>;
      for (const [key, value] of Object.entries(patch)) {
        live[key] = { get: () => value };
      }
      (fiber.ctx as unknown as VolatileUpdateEmitFace).emit(
        "loader/volatile-update",
        [Object.keys(patch)],
      );
    },
  };
}

/** The settings attach rides `ctx.inject`, so give it a tick. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
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

  it("declines the generated settings page for its own entry", async () => {
    const { configured, fiber } = await host(
      { enabled: false },
      { withSettings: true },
    );
    await settle();
    // The entry *is* the namespace on a 0.1.7 host, so the only thing the
    // plugin says to the settings service is that it ships its own card.
    expect(configured).toHaveLength(1);
    expect(configured[0]!.presentation).toEqual({ auto: false });
    // …and it says it about its own fiber, not about whoever asked.
    expect(configured[0]!.owner).toBe(fiber.ctx.fiber);
  });

  it("registers no settings presentation without a settings service", async () => {
    const { configured } = await host({ enabled: false });
    await settle();
    expect(configured).toEqual([]);
  });

  it("applies a committed card edit to the running service", async () => {
    const { tools, commit } = await host(
      { enabled: false },
      { withSettings: true },
    );
    await settle();
    expect(tools).toEqual([]);
    // The operator enabled the plugin from the card; the committed reference
    // now carries the edit, and the change applies without a Host restart.
    commit({ enabled: true });
    expect(tools.length).toBeGreaterThan(0);
    // Disabling again unmounts the same set instead of stacking a second one.
    commit({ enabled: false });
    expect(tools).toEqual([]);
  });

  it("takes one provider's tools away without touching the others", async () => {
    const { tools, commit } = await host(
      { enabled: true },
      { withSettings: true },
    );
    await settle();
    const of = (provider: string) =>
      tools.filter((name) => name.startsWith(`${provider}_`));
    expect(of("teamcity").length).toBeGreaterThan(0);
    expect(of("gitlab").length).toBeGreaterThan(0);
    // The operator's switch means the model loses this provider's tools too:
    // a mounted tool whose provider is gone could only ever refuse a call.
    commit({ teamcity: { enabled: false } });
    expect(of("teamcity")).toEqual([]);
    expect(of("gitlab").length).toBeGreaterThan(0);
  });

  it("moves the ceiling warning with the credential that meets it", async () => {
    const { descriptions, commit } = await host(
      { enabled: true },
      { withSettings: true },
    );
    await settle();
    // This stand issues no managed credential, so the ceiling is a condition
    // nobody meets: a build-log tool that warned about it would be talking the
    // model out of a reading the user's own connection answers (#285).
    expect(
      descriptions.get("teamcity_build_log")?.endsWith(SERVICE_CEILING_NOTICE),
    ).toBe(false);
    // Handing out shared credentials re-registers the descriptions, because the
    // mounted set alone did not change.
    commit({ managedServiceCredentials: { enabled: true } });
    expect(
      descriptions.get("teamcity_build_log")?.endsWith(SERVICE_CEILING_NOTICE),
    ).toBe(true);
    commit({ managedServiceCredentials: { enabled: false } });
    expect(
      descriptions.get("teamcity_build_log")?.endsWith(SERVICE_CEILING_NOTICE),
    ).toBe(false);
  });

  it("closes the store when the plugin is disposed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "qa-integrations-dispose-"));
    // The spy keeps calling through, so the handle is really released and the
    // temp directory can go away afterwards.
    const close = vi.spyOn(IntegrationRepository.prototype, "close");
    try {
      const { fiber } = await host({
        enabled: false,
        dataPath: join(directory, "qa-integrations.db"),
      });
      expect(close).not.toHaveBeenCalled();

      await fiber.dispose();

      // The store owns the SQLite handle and its WAL; a reload that does not
      // close it leaves the files held for the next instance.
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      close.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps the running state when a committed value cannot be resolved", async () => {
    const { tools, commit } = await host(
      { enabled: false },
      { withSettings: true },
    );
    await settle();
    expect(tools).toEqual([]);
    // An http-only Confluence site without the escape hatch is a constraint
    // `ConfigSchema` cannot express, so the Host persists it and the resolvers
    // are the last word. Half-applying the edit would mount the providers that
    // did resolve and lose the ones that did not, so the service keeps its
    // state instead, and a later valid commit still reaches it.
    commit({
      enabled: true,
      confluence: {
        instances: [
          {
            id: "corp",
            label: "Corp",
            baseUrl: "http://confluence.example.corp",
          },
        ],
      },
    });
    expect(tools).toEqual([]);

    commit({ confluence: { instances: [] } });
    expect(tools.length).toBeGreaterThan(0);
  });
});
