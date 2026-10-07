import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROMPT_FIREWALL_ROW_SUMMARY,
  PromptFirewallEntry,
  apply,
} from "../src/client/index.js";

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
      settingsForm: unknown;
      inspect(): Promise<unknown>;
      setSectionPolicy(
        name: string,
        policy: string,
        revision?: number,
      ): Promise<unknown>;
    };

    // The seat is this bundle's own row on the Plugins page, keyed by the package
    // name joined to the row id `cordis.patch.yml` declares — and that row id is the
    // namespace the Host serves this form under, so the move orphans no saved value.
    expect(cardOptions).toMatchObject({
      name: "plugins.row.config",
      key: "@yadsh/dsh-prompt-firewall#dsh-prompt-firewall",
    });
    // The form travels under a name the seat's own `form` owner prop cannot shadow.
    expect(face.settingsForm).toBe(form);
    expect(cardOptions).not.toHaveProperty("label");
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

  it("names and describes the row from this package's exported meta", () => {
    /*
     * The Plugins page titles this bundle's row and fills its description from the
     * package's exported `locale/en.json`, which it resolves through the exports map
     * without activating the plugin — the seat hands its registrant no label, so a
     * bundle without the file is named by its full package specifier. The row's
     * fallback line is this entry's own `summary` answer, so the file and the answer
     * are one sentence: two of them would let one row describe two pages.
     */
    const meta = (
      JSON.parse(
        readFileSync(new URL("../locale/en.json", import.meta.url), "utf8"),
      ) as { meta: { description: string; title: string } }
    ).meta;
    expect(meta.title).toBe("Prompt Firewall");
    expect(meta.description).toBe(PROMPT_FIREWALL_ROW_SUMMARY);
    expect(
      PromptFirewallEntry({
        view: "summary",
        settingsForm: {},
      } as never),
    ).toBe(PROMPT_FIREWALL_ROW_SUMMARY);
  });
});
