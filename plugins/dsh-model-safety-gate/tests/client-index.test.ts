/**
 * Client activation: the entry mounts the generated Remote contribution and
 * registers the card into the shared settings-plugins slot through the
 * injected `remote.safetyGate` namespace.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { apply } from "../src/client/index.js";

describe("client activation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mounts the Remote and registers the card against the injected namespace", async () => {
    const inspect = vi.fn(async () => ({ ok: true as const, value: {} }));
    const safetyGate = { inspect };
    const scope = {};
    let cardFace: (() => unknown) | undefined;

    const disposeSlot = vi.fn();
    const readyCtx = {
      remote: { safetyGate },
      settingsScope: { bind: vi.fn(() => scope) },
      slots: {
        inject: vi.fn((_name: string, callback: () => unknown) => callback()),
        register: vi.fn((options: { inject: () => unknown }) => {
          cardFace = options.inject;
          return disposeSlot;
        }),
      },
    };
    const inject = vi.fn(
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

    const dispose = await apply({ remote, inject } as never);
    const face = cardFace?.() as {
      scope: unknown;
      inspect(): Promise<unknown>;
    };

    await expect(face.inspect()).resolves.toEqual({ ok: true, value: {} });
    expect(inspect).toHaveBeenCalledOnce();
    expect(face.scope).toBe(scope);
    expect(mount).toHaveBeenCalledOnce();
    expect(inject).toHaveBeenCalledOnce();
    expect(readyCtx.settingsScope.bind).toHaveBeenCalledWith({
      namespace: "model-safety-gate",
    });
    expect(readyCtx.slots.register).toHaveBeenCalledWith(
      expect.objectContaining({ key: "model-safety-gate" }),
      expect.anything(),
    );
    expect(style.textContent).toContain(".dsh-plugin-card{");

    await dispose();
    expect(disposeRemote).toHaveBeenCalledOnce();
  });
});
