/**
 * The plugin entry: its identity, server-side registration behavior, and the
 * live apply of operator card edits. The settings namespace is attached when a
 * settings provider is present and skipped without one, so the Host half must
 * not require a settings provider merely to serve the browser UI.
 */

import { Context } from "@deepseek-ai/cordis";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import QaIntegrations, { name as pluginName } from "../src/index.js";
import { IntegrationRepository } from "../src/repository.js";

interface InstallCapture {
  namespace: string;
  entry: unknown;
  hooks: {
    setSource(current: () => unknown): void;
    onChange(): void;
    validate(value: unknown): void;
  };
}

/** The host services the plugin waits for; no settings provider by default. */
async function host(
  config: Record<string, unknown> = {},
  options: { withSettings?: boolean } = {},
): Promise<{
  ctx: Context;
  tools: string[];
  removed: string[];
  install: InstallCapture | undefined;
  setSource(source: unknown): void;
  /** The plugin's own fiber: disposing it is what a reload does. */
  fiber: { dispose(): Promise<void> };
}> {
  const tools: string[] = [];
  const removed: string[] = [];
  let install: InstallCapture | undefined;
  let source: unknown = { enabled: false, ...config };
  const ctx = new Context();
  ctx.provide("qaSurface", {
    registerPrincipalScopedTools: () => () => {},
    principalForSession: () => undefined,
    principalForToken: () => undefined,
  } as never);
  ctx.provide("tools", {
    register: (definition: { name: string }) => {
      tools.push(definition.name);
      return () => {
        // The active set shrinks, so live disable assertions see it.
        tools.splice(tools.indexOf(definition.name), 1);
        removed.push(definition.name);
      };
    },
  } as never);
  if (options.withSettings === true) {
    ctx.provide("settings", {
      installSection: (
        _owner: unknown,
        namespace: string,
        _schema: unknown,
        entry: unknown,
        hooks: InstallCapture["hooks"],
      ) => {
        install = { namespace, entry, hooks };
        hooks.setSource(() => source);
      },
    } as never);
  }
  const fiber = (await ctx.plugin(QaIntegrations, {
    enabled: false,
    ...config,
  })) as unknown as { dispose(): Promise<void> };
  return {
    ctx,
    tools,
    removed,
    install,
    setSource(next: unknown) {
      source = next;
    },
    fiber,
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

  it("attaches the qa-integrations namespace when a settings provider exists", async () => {
    const { install } = await host({ enabled: false }, { withSettings: true });
    await settle();
    expect(install?.namespace).toBe("qa-integrations");
    // The composition row stays the base of the section.
    expect(install?.entry).toMatchObject({ enabled: false });
  });

  it("applies a committed card edit to the running service", async () => {
    const { tools, install, setSource } = await host(
      { enabled: false },
      { withSettings: true },
    );
    await settle();
    expect(install).toBeDefined();
    expect(tools).toEqual([]);
    // The operator enabled the plugin from the card; the namespace source now
    // carries the edit, and the change applies without a Host restart.
    setSource({ enabled: true });
    install?.hooks.onChange();
    expect(tools.length).toBeGreaterThan(0);
    // Disabling again unmounts the same set instead of stacking a second one.
    setSource({ enabled: false });
    install?.hooks.onChange();
    expect(tools).toEqual([]);
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

  it("refuses an invalid write at validation time and keeps the running state", async () => {
    const { tools, install, setSource } = await host(
      { enabled: false },
      { withSettings: true },
    );
    await settle();
    expect(install).toBeDefined();
    // A valid deployment passes validation silently.
    expect(() => install?.hooks.validate({ enabled: true })).not.toThrow();
    // An http-only Confluence site without the escape hatch is refused here,
    // so the card reports it instead of storing a configuration the resolvers
    // would throw away at the next boot.
    const broken = {
      confluence: {
        instances: [
          {
            id: "corp",
            label: "Corp",
            baseUrl: "http://confluence.example.corp",
          },
        ],
      },
    };
    expect(() => install?.hooks.validate(broken)).toThrow();
    // Even if such a value arrived through another path, the running service
    // keeps its state instead of dying on it.
    setSource(broken);
    expect(() => install?.hooks.onChange()).not.toThrow();
    expect(tools).toEqual([]);
  });
});
