import type { Context } from "@deepseek-ai/cordis";
import type {
  ConfigForm,
  ConfigFormSnapshot,
} from "@deepseek-ai/dsh-client-ui-settings/client";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  SleevRowConfig,
  SleevSettingsCard,
  apply,
  inject,
  type SleevSettings,
  type SleevSettingsCardState,
} from "../src/client/index.js";

const SNAPSHOT: ConfigFormSnapshot<SleevSettings> = {
  status: "ready",
  value: { routePrefixes: ["sleev-"], maxRecentCalls: 100, logLevel: "info" },
  base: { routePrefixes: ["sleev-"], maxRecentCalls: 100, logLevel: "info" },
  user: {},
  revision: 0,
  writable: true,
  mode: "host",
};

// The card's controller builds its store on the Host snapshot-store package,
// which the browser bundle carries and this Node suite does not resolve.
vi.mock("@deepseek-ai/dsh-client-store", () => ({
  createSnapshotStore: <T>(initial: T) => {
    let value = initial;
    const listeners = new Set<() => void>();
    return {
      getSnapshot: () => value,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      set: (next: T) => {
        value = next;
        for (const listener of listeners) listener();
      },
      update: () => {},
    };
  },
}));

/** One `slots.register` call, narrowed to what the card claims. */
interface Registration {
  readonly options: {
    readonly name: string;
    readonly key?: string;
    readonly locale?: string;
  };
  readonly component: unknown;
}

function fakeForm(unsubscribe: () => void): ConfigForm<SleevSettings> {
  return {
    getSnapshot: () => SNAPSHOT,
    subscribe: vi.fn(() => unsubscribe),
    set: vi.fn(async () => true),
    unset: vi.fn(async () => true),
    mutate: vi.fn(async () => true),
  } as unknown as ConfigForm<SleevSettings>;
}

/**
 * The host machinery the client entry uses: effects are recorded rather than
 * run (the style and dictionary effects touch the DOM), while a slot
 * contribution is applied immediately and its disposer handed back.
 */
function fakeHost() {
  const registrations: Registration[] = [];
  const disposers: (() => void)[] = [];
  const unsubscribeForm = vi.fn();
  const ctx = {
    effect: vi.fn(),
    locale: { register: vi.fn() },
    configForms: { get: vi.fn(() => fakeForm(unsubscribeForm)) },
    slots: {
      inject: vi.fn((_name: string, factory: () => () => void) => {
        disposers.push(factory());
        return () => {};
      }),
      register: vi.fn(
        (options: Registration["options"], component: unknown) => {
          registrations.push({ options, component });
          return () => registrations.pop();
        },
      ),
    },
  };
  return { ctx, registrations, disposers, unsubscribeForm };
}

describe("client registration", () => {
  it("seats the card on the bundle row of the Host Plugins page", () => {
    const { ctx, registrations } = fakeHost();

    apply(ctx as unknown as Context);

    expect(inject).toEqual(["slots", "configForms", "locale"]);
    // The settings namespace stays the profile entry id, so a value stored
    // while the card sat in the Settings Plugins section is the value the
    // Plugins page reads after the move.
    expect(ctx.configForms.get).toHaveBeenCalledWith("dsh-sleev");
    expect(ctx.slots.inject).toHaveBeenCalledWith(
      "plugins.row.config",
      expect.any(Function),
    );
    expect(registrations).toHaveLength(1);
    expect(registrations[0]?.options).toMatchObject({
      name: "plugins.row.config",
      key: "@yadsh/dsh-sleev#dsh-sleev",
      locale: "dsh-sleev",
    });
    expect(registrations[0]?.component).toBe(SleevRowConfig);
  });

  it("disposes the form subscription with the registration", () => {
    const { ctx, registrations, disposers, unsubscribeForm } = fakeHost();
    apply(ctx as unknown as Context);
    const dispose = disposers[0];
    expect(dispose).toBeTypeOf("function");

    dispose?.();

    expect(registrations).toHaveLength(0);
    expect(unsubscribeForm).toHaveBeenCalledTimes(1);
  });

  it("answers the summary seat with the one-liner and the page seat with the card", () => {
    // The contract of `@deepseek-ai/dsh-client-ui-plugin-manager` asks this seat
    // for one of two views: `summary` as the row's description fallback, plain
    // text inside the page's own `<p>`, and `page` as the configuration section
    // that carries the form.
    const t = vi.fn((key: string) => `t:${key}`);
    const props = { view: "summary", t } as unknown as Parameters<
      typeof SleevRowConfig
    >[0];

    expect(SleevRowConfig(props)).toBe("t:description");
    expect(t).toHaveBeenCalledWith("description");

    const page = SleevRowConfig({ ...props, view: "page" }) as ReactElement<{
      "data-testid": string;
      className: string;
      children: ReactElement;
    }>;
    expect(page.props["data-testid"]).toBe("sleev-row-config");
    // The class the card's own styles key off: a rename here would leave the
    // plugin-owned list, which the shell contract requires, unstyled and unfixed.
    expect(page.props.className).toBe("dsh-sleev-config");
    expect(page.props.children.type).toBe(SleevSettingsCard);
  });

  it("says so when the row's namespace has not been served", () => {
    /*
     * The seat moved a silence into a page. On the Settings tab a namespace that
     * does not answer simply left the tab shut; here the row's Configure control
     * comes from the inventory, so the same `status !== "ready"` snapshot used to
     * open an empty section. The card contract still forbids a card while the
     * namespace is not ready, so this is a stated line, not the shell.
     */
    const notReady = {
      available: false,
      writable: false,
      dirty: false,
      invalid: false,
      saving: false,
      failed: false,
    } as unknown as SleevSettingsCardState;
    const props = {
      view: "page",
      t: (key: string) => `t:${key}`,
      useSleevSettings: () => notReady,
    } as unknown as Parameters<typeof SleevSettingsCard>[0];

    const notice = SleevSettingsCard(props) as ReactElement<{
      className: string;
      children: ReactElement<{
        role: string;
        "data-testid": string;
        children: string;
      }>;
    }>;

    expect(notice.props.className).toBe("dsh-sleev-no-settings");
    expect(notice.props.className).not.toContain("dsh-plugin-card");
    expect(notice.props.children.props).toMatchObject({
      role: "status",
      "data-testid": "sleev-no-settings",
    });
    expect(notice.props.children.props.children).toBe("t:noSettings");
  });
});
