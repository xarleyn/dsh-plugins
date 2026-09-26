import { afterEach, describe, expect, it, vi } from "vitest";
import { apply } from "../src/client/index.js";

describe("client activation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses a context injected with the mounted Remote namespace", async () => {
    const inspect = vi.fn(async () => ({ ok: true, value: {} }));
    const setSectionPolicy = vi.fn(async () => ({
      ok: true,
      value: undefined,
    }));
    const promptFirewall = { inspect, setSectionPolicy };
    const form = {
      getSnapshot: () => ({ status: "ready", value: {}, revision: 0 }),
      subscribe: () => () => undefined,
    };
    let cardFace: (() => unknown) | undefined;
    let cardOptions: Record<string, unknown> | undefined;

    const disposeSlot = vi.fn();
    const readyCtx = {
      remote: { promptFirewall },
      slots: {
        inject: vi.fn((_name: string, callback: () => unknown) => callback()),
        register: vi.fn((options: Record<string, unknown>) => {
          cardOptions = options;
          cardFace = options["inject"] as () => unknown;
          return disposeSlot;
        }),
      },
    };
    const inject = vi.fn(
      async (
        dependencies: string[],
        callback: (ctx: typeof readyCtx) => unknown,
      ) => {
        expect(dependencies).toEqual(["remote.promptFirewall"]);
        callback(readyCtx);
      },
    );
    const disposeRemote = vi.fn(async () => undefined);
    const mount = vi.fn(async () => disposeRemote);
    const remote = { $mount: mount } as Record<string, unknown>;
    Object.defineProperty(remote, "promptFirewall", {
      get() {
        throw new Error(
          'cannot get property "remote.promptFirewall" without inject',
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
    });

    const dispose = await apply({
      remote,
      inject,
      configForms: { get: vi.fn(() => form) },
      slots: readyCtx.slots,
    } as never);
    const face = cardFace?.() as {
      form: unknown;
      inspect(): Promise<unknown>;
      setSectionPolicy(
        name: string,
        policy: string,
        revision?: number,
      ): Promise<unknown>;
    };

    expect(cardOptions).toMatchObject({
      name: "settings.plugins.tab",
      id: "dsh-prompt-firewall",
    });
    expect(face.form).toBe(form);
    await expect(face.inspect()).resolves.toEqual({ ok: true, value: {} });
    await expect(
      face.setSectionPolicy("plugin:test", "block", 2),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(inspect).toHaveBeenCalledOnce();
    expect(setSectionPolicy).toHaveBeenCalledWith("plugin:test", "block", 2);
    expect(mount).toHaveBeenCalledOnce();
    expect(inject).toHaveBeenCalledOnce();

    await dispose();
    expect(disposeRemote).toHaveBeenCalledOnce();
    expect(style.remove).toHaveBeenCalledOnce();
  });
});
