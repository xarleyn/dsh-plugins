// @vitest-environment jsdom

/**
 * The client entry's wiring: one card, in the shared `settings.plugin.item`
 * slot, keyed by the plugin's settings namespace. A wrong key means the card
 * renders in a namespace the Host never installed, so the key is the whole
 * contract.
 */

import type { Context } from "@deepseek-ai/cordis";
import { beforeEach, describe, expect, it } from "vitest";

import { CLIENT_PLUGIN_NAME, apply, inject } from "../../src/client/index.js";

interface SlotRegistration {
  readonly name: string;
  readonly key?: string;
  readonly locale?: string;
  readonly inject?: () => unknown;
}

const boundNamespaces: string[] = [];

beforeEach(() => {
  boundNamespaces.length = 0;
});

function stub(options: { withBinder?: boolean } = {}) {
  const slots: SlotRegistration[] = [];
  const styles: string[] = [];
  const face = {
    settingsScope: {
      bind: (spec: { namespace: string }) => {
        boundNamespaces.push(spec.namespace);
        return {
          getSnapshot: () => ({ status: "ready", value: {}, writable: true }),
          subscribe: () => () => {},
          mutate: async () => {},
          set: async () => {},
          unset: async () => {},
        };
      },
    },
    slots: {
      inject: (_name: string, factory: () => unknown) => {
        factory();
        return () => {};
      },
      register: (registration: SlotRegistration) => {
        slots.push(registration);
        return () => {};
      },
    },
  };
  if (options.withBinder === false) {
    return { ctx: { slots: face.slots } as unknown as Context, slots, styles };
  }
  return { ctx: face as unknown as Context, slots, styles };
}

describe("client entry registration", () => {
  it("declares the client services the runtime must resolve", () => {
    expect([...inject]).toEqual(["slots", "settingsScope"]);
  });

  it("registers one card in settings.plugin.item keyed by the namespace", () => {
    const { ctx, slots } = stub();
    apply(ctx);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.name).toBe("settings.plugin.item");
    expect(slots[0]!.key).toBe("jev-compaction");
    expect(typeof slots[0]!.inject).toBe("function");
  });

  it("binds the same namespace the Host section installs", () => {
    const { ctx } = stub();
    apply(ctx);
    expect(boundNamespaces).toEqual(["jev-compaction"]);
  });

  it("hands the card the bound scope", () => {
    const { ctx, slots } = stub();
    apply(ctx);
    expect(slots[0]!.inject?.()).toEqual({
      scope: expect.objectContaining({ getSnapshot: expect.any(Function) }),
    });
  });

  it("renders no card when the page exposes no settings binder", () => {
    const { ctx, slots } = stub({ withBinder: false });
    const dispose = apply(ctx);
    expect(slots).toHaveLength(0);
    expect(typeof dispose).toBe("function");
  });

  it("identifies itself by the full package name", () => {
    expect(CLIENT_PLUGIN_NAME).toBe("@yadsh/dsh-jev-compaction");
  });
});
