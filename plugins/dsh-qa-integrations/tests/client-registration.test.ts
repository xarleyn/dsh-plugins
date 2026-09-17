// @vitest-environment jsdom

/**
 * The client entry's wiring: the QA page and the feature-owned Host tab mount
 * independently of the loopback-only settings namespace directory.
 */

import type { Context } from "@deepseek-ai/cordis";
import { apply } from "../src/client/index.js";

interface SlotRegistration {
  readonly name: string;
  readonly id?: string;
  readonly order?: number;
  readonly label?: string;
}

interface Stub {
  readonly ctx: Context;
  readonly sections: { id?: string; title?: string; order?: number }[];
  readonly slots: SlotRegistration[];
  readonly effects: string[];
}

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
    slots: {
      inject: (_name: string, factory: () => unknown) => {
        factory();
        return () => {};
      },
      register: (options: {
        name: string;
        id?: string;
        order?: number;
        label?: () => string;
      }) => {
        slots.push({ ...options, label: options.label?.() });
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
  it("mounts both surfaces without settings namespace discovery", async () => {
    const { ctx, sections, slots } = stub(true);
    await apply(ctx);
    await settle();
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({
      id: "integrations",
      title: "Интеграции",
      order: 40,
    });
    expect(slots).toEqual([
      {
        name: "settings.plugins.tab",
        id: "qa-integrations",
        order: 40,
        label: "Интеграции",
      },
    ]);
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
