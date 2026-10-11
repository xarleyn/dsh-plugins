import { describe, expect, it } from "vitest";
import {
  HOST_CHROME_SEATS,
  OWN_SHELL_SEATS,
} from "@yadsh/dsh-plugin-scripts/verify-plugin-card-contract";
import { PLUGIN_CARD_SHELL_CSS } from "../src/client/plugin-card-css.js";
import {
  PLUGIN_ROW_CONFIG_SLOT,
  registerSettingsCard,
  registerSettingsSlot,
  type SettingsCardHost,
  type SettingsCardSlotOptions,
} from "../src/client/register-settings-card.js";

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
const BODY_STYLES = ".demo-body{display:flex;gap:12px}";
const SHELL_IN_STYLES = `${PLUGIN_CARD_SHELL_CSS}\n${BODY_STYLES}`;

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

  it("keeps the plugin's own body rules on the row seat, where the card styles its controls", () => {
    const { host, injected, registrations } = createHost();
    registerSettingsCard(host, {
      key: ROW_KEY,
      component: CARD,
      styles: BODY_STYLES,
      pluginName: "@yadsh/dsh-demo",
    });

    expect(injected).toEqual([PLUGIN_ROW_CONFIG_SLOT]);
    expect(registrations[0]?.options.name).toBe(PLUGIN_ROW_CONFIG_SLOT);
  });
});

/*
 * The seat chose the card's surface, and a card that reaches nowhere draws no
 * error: these are the two remaining ways the helper could be handed a
 * registration that silently fails, refused at the call instead.
 */
describe("a row registration that cannot draw", () => {
  it("refuses a key that is not the composite the row is looked up by", () => {
    const { host, registrations } = createHost();
    expect(() =>
      registerSettingsSlot(host, { key: "dsh-demo", component: CARD }),
    ).toThrow(/keyed "<package name>#<row id>"/u);
    expect(registrations).toEqual([]);
  });

  it("refuses a composite with an empty half", () => {
    const { host } = createHost();
    expect(() =>
      registerSettingsSlot(host, { key: "@yadsh/dsh-demo#", component: CARD }),
    ).toThrow(/keyed "<package name>#<row id>"/u);
  });

  it("fails the full bootstrap before the Host sees the seat", () => {
    const { host, injected } = createHost();
    expect(() =>
      registerSettingsCard(host, { key: "dsh-demo", component: CARD }),
    ).toThrow(/drawn nowhere/u);
    expect(injected).toEqual([]);
  });

  it("refuses our shell in the styles of a card the Host frames", () => {
    const { host, injected } = createHost();
    expect(() =>
      registerSettingsCard(host, {
        key: ROW_KEY,
        component: CARD,
        styles: SHELL_IN_STYLES,
        pluginName: "@yadsh/dsh-demo",
      }),
    ).toThrow(/second card inside the Host's/u);
    expect(injected).toEqual([]);
  });

  it("leaves a seat that frames itself alone, shell and all", () => {
    const { host, registrations } = createHost();
    registerSettingsCard(host, {
      key: "dsh-demo",
      component: CARD,
      styles: SHELL_IN_STYLES,
      pluginName: "@yadsh/dsh-demo",
      slotName: "settings.section",
    });

    expect(registrations[0]?.options.name).toBe("settings.section");
  });
});

describe("the helper's default seat", () => {
  /*
   * Read off the lists the package gate checks the built bundle against, so the
   * assertion fails when the Host moves the seat and the kit's default does not
   * follow — a copy of the list in this file could not.
   */
  it("is a seat the Host still ships", () => {
    expect([...HOST_CHROME_SEATS, ...OWN_SHELL_SEATS]).toContain(
      PLUGIN_ROW_CONFIG_SLOT,
    );
  });

  it("is the Host's own row, so the card seated there draws no frame of ours", () => {
    expect(HOST_CHROME_SEATS).toContain(PLUGIN_ROW_CONFIG_SLOT);
  });
});
