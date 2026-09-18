/**
 * Client activation: the entry mounts the generated Remote contribution and
 * registers the page into the settings shell's section list through the
 * injected `remote.presetPersonaEditor` namespace.
 *
 * The namespace is deliberately poisoned before the inject: reading it without
 * the injection must throw, which is what the 0.1.5 client runtime does and
 * what the wiring here has to survive.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { apply } from "../src/client/index.js";

describe("client activation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mounts the Remote and registers the page against the injected namespace", async () => {
    const list = vi.fn(async () => ({
      ok: true as const,
      value: { presets: [], authorable: true },
    }));
    const presetPersonaEditor = {
      list,
      read: vi.fn(),
      save: vi.fn(),
      reset: vi.fn(),
      copy: vi.fn(),
    };
    let pageFace: (() => unknown) | undefined;
    let registered: Record<string, unknown> | undefined;

    const disposeSlot = vi.fn();
    const readyCtx = {
      remote: { presetPersonaEditor },
      slots: {
        inject: vi.fn((_name: string, callback: () => unknown) => callback()),
        register: vi.fn((options: Record<string, unknown>) => {
          registered = options;
          pageFace = options.inject as () => unknown;
          return disposeSlot;
        }),
      },
    };
    const inject = vi.fn(
      async (
        dependencies: string[],
        callback: (ctx: typeof readyCtx) => unknown,
      ) => {
        expect(dependencies).toEqual(["remote.presetPersonaEditor"]);
        callback(readyCtx);
      },
    );
    const disposeRemote = vi.fn(async () => undefined);
    const mount = vi.fn(async () => disposeRemote);
    const remote = { $mount: mount } as Record<string, unknown>;
    Object.defineProperty(remote, "presetPersonaEditor", {
      get() {
        throw new Error(
          'cannot get property "remote.presetPersonaEditor" without inject',
        );
      },
    });

    const style = {
      dataset: {} as Record<string, string>,
      textContent: "",
      remove: vi.fn(),
    };
    vi.stubGlobal("document", {
      createElement: vi.fn(() => style),
      head: { appendChild: vi.fn() },
      querySelector: vi.fn(() => null),
    });

    const dispose = await apply({ remote, inject } as never);

    // The page is registered as a settings section, right after the
    // deployment's own Agent Presets page, and the face it receives drives the
    // injected namespace rather than the context's own.
    expect(registered).toMatchObject({
      name: "settings.section",
      id: "preset-persona",
      order: 21,
      label: "Persona",
    });
    const face = pageFace?.() as {
      controller: { load(): Promise<void>; snapshot(): { status: string } };
    };
    await face.controller.load();
    expect(list).toHaveBeenCalledOnce();
    expect(face.controller.snapshot().status).toBe("ready");
    expect(style.textContent).toContain(".dsh-plugin-card{");
    expect(style.dataset.plugin).toBe("@yadsh/dsh-preset-persona-editor");

    await dispose();
    // The slot registration's own disposer is owned by the injected fiber
    // (cordis disposes a plugin body's return value), so unloading the plugin
    // is what unregisters the page; this disposer owns the Remote mount and
    // the stylesheet.
    expect(disposeRemote).toHaveBeenCalledOnce();
    expect(style.remove).toHaveBeenCalledOnce();
  });

  it("disposes the Remote when the slot registration fails", async () => {
    const readyCtx = {
      remote: { presetPersonaEditor: {} },
      slots: {
        inject: vi.fn(() => {
          throw new Error('slot "settings.section" is not declared');
        }),
        register: vi.fn(),
      },
    };
    const inject = vi.fn(
      async (_deps: string[], callback: (ctx: typeof readyCtx) => unknown) => {
        callback(readyCtx);
      },
    );
    const disposeRemote = vi.fn(async () => undefined);
    const remote = { $mount: vi.fn(async () => disposeRemote) };
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({
        dataset: {},
        textContent: "",
        remove: vi.fn(),
      })),
      head: { appendChild: vi.fn() },
      querySelector: vi.fn(() => null),
    });

    await expect(apply({ remote, inject } as never)).rejects.toThrow(
      /is not declared/u,
    );
    expect(disposeRemote).toHaveBeenCalledOnce();
  });
});
