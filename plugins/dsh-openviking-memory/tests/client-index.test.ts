/**
 * Client activation: the entry binds the plugin's settings namespace and
 * registers the card into the shared settings-plugins slot with the canonical
 * stylesheet.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { apply } from "../src/client/index.js";

describe("client activation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("binds the namespace and registers the card", async () => {
    const scope = {};
    let cardFace: (() => unknown) | undefined;

    const disposeSlot = vi.fn();
    const ctx = {
      settingsScope: { bind: vi.fn(() => scope) },
      slots: {
        inject: vi.fn((_name: string, callback: () => unknown) => callback()),
        register: vi.fn((options: { inject: () => unknown }) => {
          cardFace = options.inject;
          return disposeSlot;
        }),
      },
    };

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

    const dispose = apply(ctx as never);
    const face = cardFace?.() as { scope: unknown };

    expect(ctx.settingsScope.bind).toHaveBeenCalledWith({
      namespace: "dsh-openviking-memory",
    });
    expect(face.scope).toBe(scope);
    expect(ctx.slots.register).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "settings.plugin.item",
        key: "dsh-openviking-memory",
      }),
      expect.anything(),
    );
    // Canonical shell travels with the card.
    expect(style.textContent).toContain(".dsh-plugin-card{");
    expect(style.dataset.plugin).toBe("@yadsh/dsh-openviking-memory");

    dispose();
    expect(disposeSlot).toHaveBeenCalledOnce();
    expect(style.remove).toHaveBeenCalledOnce();
  });

  it("renders no card when the settings binder is unavailable", () => {
    const dispose = apply({ slots: {} } as never);
    expect(dispose).toBeTypeOf("function");
    expect(() => dispose()).not.toThrow();
  });

  it("registers the account-scoped page once QA Surface is up", async () => {
    const scope = {};
    const registered: { id: string; title: string }[] = [];
    const effects: (() => void)[] = [];
    const style = {
      dataset: {} as Record<string, string>,
      textContent: "",
      remove: vi.fn(),
    };
    vi.stubGlobal("document", {
      createElement: vi.fn(() => style),
      head: { append: vi.fn(), appendChild: vi.fn() },
      querySelector: vi.fn(() => null),
    });

    const ctx = {
      settingsScope: { bind: vi.fn(() => scope) },
      slots: {
        inject: vi.fn((_name: string, callback: () => unknown) => callback()),
        register: vi.fn(() => vi.fn()),
      },
      remote: { $mount: vi.fn(async () => async () => undefined) },
      qaUserSettingsSections: {
        register: vi.fn((section: { id: string; title: string }) => {
          registered.push(section);
          return vi.fn();
        }),
      },
      inject: vi.fn(
        (_names: string[], callback: (injected: unknown) => void) => {
          callback({
            effect: (execute: () => () => void) => {
              effects.push(execute());
              return () => undefined;
            },
            qaUserSettingsSections: ctx.qaUserSettingsSections,
            remote: { openvikingMemory: {} },
          });
          return () => undefined;
        },
      ),
    };

    apply(ctx as never);
    await vi.waitFor(() => {
      expect(registered).toHaveLength(1);
    });

    expect(registered[0]?.id).toBe("openviking-memory");
    expect(registered[0]?.title).toBe("Память");
    expect(ctx.remote.$mount).toHaveBeenCalledOnce();
    expect(style.textContent).toContain(".ovm-qa__toggle");
    for (const disposeEffect of effects) disposeEffect();
  });
});
