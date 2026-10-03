import { describe, expect, it } from "vitest";
import {
  PLUGIN_ROW_CONFIG_SLOT,
  registerSettingsCard,
  registerSettingsSlot,
  type SettingsCardHost,
  type SettingsCardSlotOptions,
} from "../src/client/register-settings-card.js";

/**
 * The seats `0.1.7` ships for a plugin's own configuration card. The package gate
 * checks the helper's default against the lists the shared card contract exports,
 * so this copy is a readable pin, not the authority on it.
 */
const LIVE_CARD_SEATS = [
  "plugins.row.config",
  "plugins.bundle.config",
  "settings.section",
  "settings.plugins.tab",
];

interface Registration {
  readonly options: SettingsCardSlotOptions;
  readonly component: unknown;
}

/**
 * A structural stand-in for the Host's slot registry, recording every call. The
 * Host disposes what an injected factory registered when the effect goes away,
 * so the factory's own disposer is run here too.
 */
function createHost(): {
  host: SettingsCardHost;
  injected: string[];
  registrations: Registration[];
  released: string[];
} {
  const injected: string[] = [];
  const registrations: Registration[] = [];
  const released: string[] = [];
  const host: SettingsCardHost = {
    slots: {
      inject: (slotName, factory) => {
        injected.push(slotName);
        const disposeRegistration = factory();
        return () => {
          if (typeof disposeRegistration === "function") {
            (disposeRegistration as () => void)();
          }
          released.push(`effect:${slotName}`);
        };
      },
      register: (options, component) => {
        registrations.push({ options, component });
        return () => {
          released.push(`registration:${options.name}`);
        };
      },
    },
  };
  return { host, injected, registrations, released };
}

const CARD = { displayName: "Card" };
const ROW_KEY = "@yadsh/dsh-demo#dsh-demo";

describe("registerSettingsSlot", () => {
  it("mounts a card that names no seat onto the Plugins panel row", () => {
    const { host, registrations } = createHost();
    registerSettingsSlot(host, { key: ROW_KEY, component: CARD });

    const registration = registrations[0];
    expect(registration?.options.name).toBe(PLUGIN_ROW_CONFIG_SLOT);
    expect(registration?.component).toBe(CARD);
  });

  it("keeps a seat the plugin names itself", () => {
    const { host, registrations } = createHost();
    registerSettingsSlot(host, {
      key: ROW_KEY,
      component: CARD,
      slotName: "settings.section",
    });

    expect(registrations[0]?.options.name).toBe("settings.section");
  });

  it("carries the row key and the optional locale and inject face through", () => {
    const { host, registrations, released } = createHost();
    const inject = () => ({ form: null });
    const dispose = registerSettingsSlot(host, {
      key: ROW_KEY,
      component: CARD,
      locale: "demo",
      inject,
    });

    expect(registrations[0]?.options).toEqual({
      name: PLUGIN_ROW_CONFIG_SLOT,
      key: ROW_KEY,
      locale: "demo",
      inject,
    });
    dispose();
    expect(released).toEqual([`registration:${PLUGIN_ROW_CONFIG_SLOT}`]);
  });

  it("leaves the options it was not given out of the registration", () => {
    const { host, registrations } = createHost();
    registerSettingsSlot(host, { key: ROW_KEY, component: CARD });

    const options = registrations[0]?.options ?? {};
    expect(Object.hasOwn(options, "locale")).toBe(false);
    expect(Object.hasOwn(options, "inject")).toBe(false);
  });
});

describe("registerSettingsCard", () => {
  it("injects the effect and the registration on the same default seat", () => {
    const { host, injected, registrations } = createHost();
    registerSettingsCard(host, { key: ROW_KEY, component: CARD });

    expect(PLUGIN_ROW_CONFIG_SLOT).toBe("plugins.row.config");
    expect(injected).toEqual([PLUGIN_ROW_CONFIG_SLOT]);
    expect(registrations[0]?.options.name).toBe(PLUGIN_ROW_CONFIG_SLOT);
  });

  it("injects and registers on the seat the plugin names", () => {
    const { host, injected, registrations } = createHost();
    registerSettingsCard(host, {
      key: ROW_KEY,
      component: CARD,
      slotName: "settings.plugins.tab",
    });

    expect(injected).toEqual(["settings.plugins.tab"]);
    expect(registrations[0]?.options.name).toBe("settings.plugins.tab");
  });

  it("releases the slot effect and the registration it made", () => {
    const { host, released } = createHost();
    const dispose = registerSettingsCard(host, {
      key: ROW_KEY,
      component: CARD,
    });
    expect(released).toEqual([]);

    dispose();
    expect(released).toEqual([
      `registration:${PLUGIN_ROW_CONFIG_SLOT}`,
      `effect:${PLUGIN_ROW_CONFIG_SLOT}`,
    ]);
  });
});

describe("the helper's default seat", () => {
  it("is a seat the Host still ships, so a card routed without slotName draws", () => {
    expect(LIVE_CARD_SEATS).toContain(PLUGIN_ROW_CONFIG_SLOT);
  });
});
