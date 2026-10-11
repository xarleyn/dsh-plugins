// @vitest-environment jsdom

/**
 * The client entry's wiring: the operator card, the QA page and the account
 * card. The operator card edits the plugin's own profile entry through the
 * settings form the Host serves for it, and mounts without waiting for the
 * Remote to describe the deployment — an operator's first act may be enabling
 * the plugin; the two user surfaces mount only for an enabled one. The cards
 * take their seats on the Plugins page — the operator in the configuration
 * section of this bundle's own row, the account in the bundle's own section —
 * and the QA page stays in the signed-in user's settings dialog.
 */

import type { Context } from "@deepseek-ai/cordis";
import { apply } from "../../src/client/index.js";

interface SlotRegistration {
  readonly name: string;
  readonly key?: string;
  readonly id?: string;
  readonly order?: number;
  readonly label?: string;
  readonly inject?: unknown;
  readonly injected?: { readonly settingsForm?: unknown };
}

interface Stub {
  readonly ctx: Context;
  readonly sections: { id?: string; title?: string; order?: number }[];
  readonly slots: SlotRegistration[];
  readonly effects: string[];
}

/** The namespaces the operator card asked a form for, to pin the identity. */
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
  const form = {
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
    configForms: {
      get: (namespace: string) => {
        boundNamespaces.push(namespace);
        return form;
      },
      whileServed: (
        namespaces: readonly string[],
        register: (served: ReadonlySet<string>) => () => void,
      ) => register(new Set(namespaces)),
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
        inject?: () => { readonly settingsForm?: unknown };
      }) => {
        // The host calls the slot's inject factory when it dispatches a card;
        // calling it here is what resolves the entry's settings form, and what
        // the card is handed under which name is part of the seat's contract.
        slots.push({
          ...options,
          label: options.label?.(),
          injected: options.inject?.(),
        });
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
    // The operator card first — it does not wait for `describe()` — then the
    // account card the deployment answer mounts on the bundle's own page. The
    // row key is the package name joined to the row id the patch declares, and
    // that id is the settings namespace, so the values a stand saved under the
    // old seat are the values this seat reads.
    expect(slots).toEqual([
      {
        name: "plugins.row.config",
        key: "@yadsh/dsh-qa-integrations#qa-integrations",
        inject: expect.any(Function),
        injected: { settingsForm: expect.anything() },
      },
      {
        name: "plugins.bundle.config",
        key: "@yadsh/dsh-qa-integrations",
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
        name: "plugins.row.config",
        key: "@yadsh/dsh-qa-integrations#qa-integrations",
        inject: expect.any(Function),
        injected: { settingsForm: expect.anything() },
      },
    ]);
    // The stylesheet is mounted with the injection, not with the answer.
    expect(effects).toEqual(["dsh-qa-integrations: styles"]);
  });
});
