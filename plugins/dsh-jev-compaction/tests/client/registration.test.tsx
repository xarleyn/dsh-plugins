// @vitest-environment jsdom

/**
 * The client entry's wiring: one card, in a Plugins tab of its own, bound to
 * the Host settings section keyed by the plugin's profile entry id. A wrong key
 * means the card edits a section the Host never serves, so the key is the whole
 * contract.
 */

import type { Context } from "@deepseek-ai/cordis";
import { beforeEach, describe, expect, it } from "vitest";

import {
  CLIENT_PLUGIN_NAME,
  SETTINGS_CARD_SLOT,
  apply,
  inject,
} from "../../src/client/index.js";
import { JEV_COMPACTION_SETTINGS_NAMESPACE } from "../../src/shared/settings.js";

interface SlotRegistration {
  readonly name: string;
  readonly id?: string;
  readonly order?: number;
  readonly inject?: () => unknown;
}

const resolvedNamespaces: string[] = [];

beforeEach(() => {
  resolvedNamespaces.length = 0;
});

function stub(options: { withForms?: boolean } = {}) {
  const slots: SlotRegistration[] = [];
  const face = {
    configForms: {
      get: (entryId: string) => {
        resolvedNamespaces.push(entryId);
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
  if (options.withForms === false) {
    return { ctx: { slots: face.slots } as unknown as Context, slots };
  }
  return { ctx: face as unknown as Context, slots };
}

describe("client entry registration", () => {
  it("declares the client services the runtime must resolve", () => {
    expect([...inject]).toEqual(["slots", "configForms"]);
  });

  it("registers one card as a Plugins tab", () => {
    const { ctx, slots } = stub();
    apply(ctx);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.name).toBe("settings.plugins.tab");
    expect(SETTINGS_CARD_SLOT).toBe("settings.plugins.tab");
    expect(typeof slots[0]!.inject).toBe("function");
  });

  it("keys the tab by the entry id whose section it edits", () => {
    const { ctx, slots } = stub();
    apply(ctx);
    expect(slots[0]!.id).toBe(JEV_COMPACTION_SETTINGS_NAMESPACE);
    expect(resolvedNamespaces).toEqual([JEV_COMPACTION_SETTINGS_NAMESPACE]);
  });

  it("hands the card the resolved form", () => {
    const { ctx, slots } = stub();
    apply(ctx);
    expect(slots[0]!.inject?.()).toEqual({
      form: expect.objectContaining({ getSnapshot: expect.any(Function) }),
    });
  });

  it("renders no card when the page exposes no settings forms", () => {
    const { ctx, slots } = stub({ withForms: false });
    const dispose = apply(ctx);
    expect(slots).toHaveLength(0);
    expect(typeof dispose).toBe("function");
  });

  it("identifies itself by the full package name", () => {
    expect(CLIENT_PLUGIN_NAME).toBe("@yadsh/dsh-jev-compaction");
  });
});
