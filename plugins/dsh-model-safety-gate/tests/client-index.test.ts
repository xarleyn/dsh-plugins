/**
 * Client activation: the entry mounts the generated Remote contribution and
 * registers the card as the configuration of this bundle's own row on the
 * Plugins page, bound to the configuration form the settings domain serves for
 * this profile entry.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { apply, inject } from "../src/client/index.js";

describe("client activation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("declares the services the browser runtime has to resolve", () => {
    // `configForms` replaced the deleted `settingsScope`; the manifest in
    // package.json mirrors this list, so a drift here is a drift there.
    expect(inject).toEqual(["slots", "configForms", "remote"]);
  });

  it("mounts the Remote and registers the card against the injected namespace", async () => {
    const inspect = vi.fn(async () => ({ ok: true as const, value: {} }));
    const safetyGate = { inspect };
    const form = {};
    let cardFace: (() => unknown) | undefined;

    const disposeSlot = vi.fn();
    const readyCtx = {
      remote: { safetyGate },
      configForms: { get: vi.fn(() => form) },
      slots: {
        inject: vi.fn((_name: string, callback: () => unknown) => callback()),
        register: vi.fn((options: { inject: () => unknown }) => {
          cardFace = options.inject;
          return disposeSlot;
        }),
      },
    };
    const injectServices = vi.fn(
      async (
        dependencies: string[],
        callback: (ctx: typeof readyCtx) => unknown,
      ) => {
        expect(dependencies).toEqual(["remote.safetyGate"]);
        callback(readyCtx);
      },
    );
    const disposeRemote = vi.fn(async () => undefined);
    const mount = vi.fn(async () => disposeRemote);
    const remote = { $mount: mount } as Record<string, unknown>;
    Object.defineProperty(remote, "safetyGate", {
      get() {
        throw new Error(
          'cannot get property "remote.safetyGate" without inject',
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

    // Only `remote` and `inject` are read on the entry context: the slot
    // registry and the form arrive on the injected one.
    const dispose = await apply({ remote, inject: injectServices } as never);
    const face = cardFace?.() as { settingsForm: unknown };

    await expect(inspect()).resolves.toEqual({ ok: true, value: {} });
    expect(inspect).toHaveBeenCalledOnce();
    // The seat hands the page's own `ConfigPageForm`, which can neither be
    // subscribed to nor written field by field, so the card's live form arrives
    // through the injected face, under a name that owner prop cannot shadow.
    expect(face).toMatchObject({ settingsForm: form });
    expect(mount).toHaveBeenCalledOnce();
    expect(injectServices).toHaveBeenCalledOnce();
    // The settings namespace of a plugin is its profile entry id.
    expect(readyCtx.configForms.get).toHaveBeenCalledWith(
      "dsh-model-safety-gate",
    );
    expect(readyCtx.slots.inject).toHaveBeenCalledWith(
      "plugins.row.config",
      expect.any(Function),
    );
    // The key is the package name joined to that same row id, which is what
    // keeps a value saved before the seat moved readable after it.
    expect(readyCtx.slots.register).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "plugins.row.config",
        key: "@yadsh/dsh-model-safety-gate#dsh-model-safety-gate",
      }),
      expect.anything(),
    );
    expect(style.textContent).toContain(".dsh-plugin-card{");
    expect(style.dataset.plugin).toBe("@yadsh/dsh-model-safety-gate");

    await dispose();
    expect(disposeSlot).toHaveBeenCalledOnce();
    expect(style.remove).toHaveBeenCalledOnce();
    expect(disposeRemote).toHaveBeenCalledOnce();
  });
});
