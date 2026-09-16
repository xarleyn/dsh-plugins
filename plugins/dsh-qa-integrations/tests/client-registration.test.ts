// @vitest-environment jsdom

/**
 * The client entry's wiring: which surfaces this bundle mounts, under which
 * namespace. The card only appears in "Plugin configuration" when the Host
 * serves the namespace the card keys on, so the two halves are pinned here.
 */

import type { Context } from "@deepseek-ai/cordis";
import { apply } from "../src/client/index.js";
import { QA_INTEGRATIONS_SETTINGS_NAMESPACE } from "../src/shared/settings.js";

interface Stub {
  readonly ctx: Context;
  readonly sections: { id?: string; title?: string; order?: number }[];
  readonly slots: { name: string; key?: string }[];
  readonly effects: string[];
}

function stub(enabled: boolean): Stub {
  const sections: { id?: string; title?: string; order?: number }[] = [];
  const slots: { name: string; key?: string }[] = [];
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
    slots: {
      inject: (_name: string, factory: () => unknown) => {
        factory();
        return () => {};
      },
      register: (options: { name: string; key?: string }) => {
        slots.push(options);
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
  } as unknown as Context;
  return { ctx, sections, slots, effects };
}

/** The registrations happen once `describe()` has answered. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("integrations client entry", () => {
  it("mounts both surfaces under the served namespace", async () => {
    const { ctx, sections, slots } = stub(true);
    await apply(ctx);
    await settle();
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({
      id: "integrations",
      title: "Интеграции",
      order: 40,
    });
    // The key must be the namespace the Host serves, or the Host's tab never
    // dispatches the card.
    expect(slots).toEqual([
      { name: "settings.plugin.item", key: QA_INTEGRATIONS_SETTINGS_NAMESPACE },
    ]);
    expect(QA_INTEGRATIONS_SETTINGS_NAMESPACE).toBe("qa-integrations");
  });

  it("registers nothing while the deployment disabled the plugin", async () => {
    const { ctx, sections, slots, effects } = stub(false);
    await apply(ctx);
    await settle();
    expect(sections).toEqual([]);
    expect(slots).toEqual([]);
    // The stylesheet is mounted with the injection, not with the answer.
    expect(effects).toEqual(["dsh-qa-integrations: styles"]);
  });
});
