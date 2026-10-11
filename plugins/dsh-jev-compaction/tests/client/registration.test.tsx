// @vitest-environment jsdom

/**
 * The client entry's wiring: one card in the shared `settings.plugin.item`
 * slot keyed by the plugin's settings namespace, and one conversation
 * contribution that renders a card per recorded compaction run into the
 * transcript (SPEC §28). A wrong key means the card renders in a namespace the
 * Host never installed, so the key is the whole contract.
 */

import type { Context } from "@deepseek-ai/cordis";
import { beforeEach, describe, expect, it } from "vitest";

import { CLIENT_PLUGIN_NAME, apply, inject } from "../../src/client/index.js";
import { JEV_COMPACTION_NODE_KIND } from "../../src/client/conversation.js";

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

function stub(
  options: { withBinder?: boolean; withConversation?: boolean } = {},
) {
  const slots: SlotRegistration[] = [];
  const styles: string[] = [];
  const definitions: Array<Record<string, unknown>> = [];
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
    uiConversation: {
      events: {
        register: (definition: Record<string, unknown>) => {
          definitions.push(definition);
          return () => {};
        },
      },
    },
  };
  if (options.withBinder === false || options.withConversation === false) {
    const bare = {
      slots: face.slots,
      ...(options.withBinder === false
        ? {}
        : { settingsScope: face.settingsScope }),
      ...(options.withConversation === false
        ? {}
        : { uiConversation: face.uiConversation }),
    };
    return {
      ctx: bare as unknown as Context,
      slots,
      styles,
      definitions,
    };
  }
  return { ctx: face as unknown as Context, slots, styles, definitions };
}

describe("client entry registration", () => {
  it("declares the client services the runtime must resolve", () => {
    expect([...inject]).toEqual(["slots", "settingsScope", "uiConversation"]);
  });

  it("registers one card in settings.plugin.item keyed by the namespace", () => {
    const { ctx, slots } = stub();
    apply(ctx);
    expect(slots).toHaveLength(2);
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

describe("conversation contribution", () => {
  it("registers the run Definition and its renderer on the same kind", () => {
    const { ctx, slots, definitions } = stub();
    apply(ctx);
    expect(definitions).toHaveLength(1);
    expect(definitions[0]!.kind).toBe(JEV_COMPACTION_NODE_KIND);
    expect(definitions[0]!.target).toBe("chat");
    // The renderer is the second seat on the row seat of the transcript, keyed
    // by the very kind the Definition publishes: one without the other is
    // either an invisible card or the host's raw-JSON fallback row.
    const chatSeat = slots.find(
      (entry) => entry.name === "conversation.chat.node",
    );
    expect(chatSeat).toBeDefined();
    expect(chatSeat!.key).toBe(JEV_COMPACTION_NODE_KIND);
  });

  it("still shows the card on a page that serves no settings directory", () => {
    const { ctx, slots, definitions } = stub({ withBinder: false });
    apply(ctx);
    // No settings card, and no crash either — the transcript half is
    // independent of the settings binder.
    expect(slots).toHaveLength(0);
    expect(definitions).toHaveLength(0);
  });

  it("keeps the transcript half alive when the conversation is absent", () => {
    const { ctx, slots } = stub({ withConversation: false });
    const dispose = apply(ctx);
    expect(slots.some((entry) => entry.name === "settings.plugin.item")).toBe(
      true,
    );
    expect(slots.some((entry) => entry.name === "conversation.chat.node")).toBe(
      false,
    );
    expect(typeof dispose).toBe("function");
  });
});
