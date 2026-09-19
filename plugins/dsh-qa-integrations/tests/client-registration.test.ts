// @vitest-environment jsdom

/**
 * The client entry's wiring: the operator card, the QA page and the
 * feature-owned Host tab. The operator card edits the plugin's settings
 * namespace and mounts without waiting for the Remote to describe the
 * deployment — an operator's first act may be enabling the plugin; the two
 * user surfaces mount only for an enabled one, independently of the
 * loopback-only settings namespace directory.
 */

import type { Context } from "@deepseek-ai/cordis";
import { apply } from "../src/client/index.js";

interface SlotRegistration {
  readonly name: string;
  readonly key?: string;
  readonly id?: string;
  readonly order?: number;
  readonly label?: string;
  readonly inject?: unknown;
}

interface Stub {
  readonly ctx: Context;
  readonly sections: { id?: string; title?: string; order?: number }[];
  readonly slots: SlotRegistration[];
  readonly effects: string[];
}

/** The namespace the operator card binds, captured to pin the identity. */
const boundNamespaces: string[] = [];

function stub(enabled: boolean): Stub {
  const sections: { id?: string; title?: string; order?: number }[] = [];
  const slots: SlotRegistration[] = [];
  const effects: string[] = [];
  const remote = {
    $mount: async () => async () => {},
    qaIntegrations: {
      describe: async () => ({
        ok: true as const,
        value: { enabled, providers: ["teamcity"] },
      }),
    },
  };
  const face = {
    remote,
    qaUserSettingsSections: {
      register: (section: { id?: string }) => {
        sections.push(section);
        return () => {};
      },
    },
    qaUserSession: {
      getSnapshot: () => ({ stage: "anonymous", token: null }),
      subscribe: () => () => {},
    },
    settingsScope: {
      bind: (spec: { namespace: string }) => {
        boundNamespaces.push(spec.namespace);
        return {
          getSnapshot: () => ({
            status: "unavailable",
            value: undefined,
            base: undefined,
            user: undefined,
            revision: undefined,
            writable: false,
            mode: "memory",
          }),
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
      register: (options: {
        name: string;
        key?: string;
        id?: string;
        order?: number;
        label?: () => string;
        inject?: () => unknown;
      }) => {
        slots.push({ ...options, label: options.label?.() });
        // The host calls the slot's inject factory when it dispatches a card;
        // calling it here is what binds the settings scope.
        options.inject?.();
        return () => {};
      },
    },
    effect: (factory: () => unknown, label: string) => {
      effects.push(label);
      const remove = factory();
      return () => {
        if (typeof remove === "function") (remove as () => void)();
      };
    },
  };
  const ctx = {
    remote,
    inject: (_deps: unknown, callback: (injected: unknown) => unknown) => {
      callback(face);
    },
    effect: face.effect,
  };
  return { ctx: ctx as unknown as Context, sections, slots, effects };
}

/** The registrations happen once `describe()` has answered. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("integrations client entry", () => {
  it("mounts all three surfaces while the deployment is enabled", async () => {
    const { ctx, sections, slots } = stub(true);
    await apply(ctx);
    await settle();
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({
      id: "integrations",
      title: "Интеграции",
      order: 40,
    });
    // The operator card keyed on the plugin's settings namespace, then the
    // feature-owned tab. The card mounts first: it does not wait for
    // `describe()`.
    expect(slots).toEqual([
      {
        name: "settings.plugin.item",
        key: "qa-integrations",
        inject: expect.any(Function),
      },
      {
        name: "settings.plugins.tab",
        id: "qa-integrations",
        order: 40,
        label: "Интеграции",
      },
    ]);
    expect(boundNamespaces).toEqual(["qa-integrations"]);
  });

  it("keeps only the operator card while the plugin is disabled", async () => {
    const { ctx, sections, slots, effects } = stub(false);
    await apply(ctx);
    await settle();
    expect(sections).toEqual([]);
    // The operator card is the surface that enables the plugin, so it mounts
    // regardless of the deployment's answer; the user surfaces do not.
    expect(slots).toEqual([
      {
        name: "settings.plugin.item",
        key: "qa-integrations",
        inject: expect.any(Function),
      },
    ]);
    // The stylesheet is mounted with the injection, not with the answer.
    expect(effects).toEqual(["dsh-qa-integrations: styles"]);
  });
});
