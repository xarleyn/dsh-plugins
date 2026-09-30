import { Context } from "@deepseek-ai/cordis";
import type { PluginConfigViewProps } from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type { ReactNode } from "react";
import type { PluginLogTail } from "../../src/types.js";

/**
 * The cordis stand both client suites drive the real `apply()` through.
 *
 * `client-panel.test.ts` uses it to check the wiring `apply()` produces;
 * `client-card.test.tsx` renders the component this stand captures, so the card is
 * exercised as the Plugins page mounts it rather than as a copy of it.
 */

export const EMPTY_TAIL: PluginLogTail = {
  records: [],
  cursor: 0,
  dropped: 0,
  buffered: 0,
  capacity: 10,
};

interface TabType {
  readonly id: string;
  readonly kind: string;
  readonly priority: string | undefined;
  readonly patterns: readonly string[] | undefined;
  /** Read at open time: the chip's text is the registry's capture, not a prop. */
  readonly title: (address: string) => string;
  readonly guide: readonly {
    readonly id: string;
    readonly order: number;
    readonly title: () => string;
  }[];
}

/**
 * Props the host's Plugins page renders a `plugins.row.config` entry with, read
 * off the page's own contract instead of restated here: `view` is the host's
 * `'summary' | 'page'` union, so a seat that stops being called with `summary`
 * breaks this suite's typecheck rather than leaving the branch quietly dead.
 */
export type SeatProps = PluginConfigViewProps & Record<string, unknown>;

/** A registered entry, as the host's page calls it. */
export type SeatComponent = (props: SeatProps) => ReactNode;

export interface Registration {
  readonly name: string;
  readonly key: string | undefined;
  readonly id: string | undefined;
  readonly locale: string | undefined;
  readonly props: Record<string, unknown>;
  /** The component handed to `slots.register` beside its declaration. */
  readonly component: SeatComponent;
}

export interface Harness {
  readonly ctx: Context;
  readonly types: TabType[];
  readonly registrations: Registration[];
  /** The settings namespaces `apply()` resolved a live form under. */
  readonly configNamespaces: string[];
  /** Each namespace mapped to the form the stand handed for it. */
  readonly forms: Map<string, unknown>;
  readonly mounted: { readonly count: number };
  readonly disposed: {
    readonly remote: number;
    readonly tabs: number;
    readonly slots: number;
  };
}

export interface HarnessOptions {
  /**
   * The `ConfigForm` the stand hands `configForms.get`. The default snapshot is
   * `unavailable`, which is what the wiring suite needs; a suite that renders the
   * card passes a ready form so the values it reads are the test's own.
   */
  readonly settingsForm?: unknown;
}

/** The inspector answers the plugin's Remote calls with. */
const NAMESPACE = {
  inspect: () =>
    Promise.resolve({
      ok: true as const,
      value: {
        consumers: [
          {
            pluginId: "dsh-sample",
            level: "info" as const,
            format: "text" as const,
            instances: 1,
          },
        ],
      },
    }),
  tail: () => Promise.resolve({ ok: true as const, value: EMPTY_TAIL }),
};

export function harnessOf(options: HarnessOptions = {}): Harness {
  const ctx = new Context();
  const types: TabType[] = [];
  const registrations: Registration[] = [];
  const configNamespaces: string[] = [];
  const forms = new Map<string, unknown>();
  const mounted = { count: 0 };
  const disposed = { remote: 0, tabs: 0, slots: 0 };

  const settingsForm =
    options.settingsForm ??
    ({
      set: () => Promise.resolve(true),
      subscribe: () => () => undefined,
      getSnapshot: () => ({
        status: "unavailable",
        value: undefined,
        writable: false,
        mode: "host",
      }),
    } as unknown);

  // The namespace is a service of its own: `ctx.inject(['remote.pluginLogUi'])`
  // resolves the key, the code under test reads the property beside it.
  ctx.provide("remote", {
    pluginLogUi: NAMESPACE,
    $mount: () => {
      mounted.count += 1;
      return Promise.resolve(() => {
        disposed.remote += 1;
        return Promise.resolve();
      });
    },
  });
  ctx.provide("remote.pluginLogUi", NAMESPACE);
  ctx.provide("configForms", {
    get: (namespace: string) => {
      configNamespaces.push(namespace);
      forms.set(namespace, settingsForm);
      return settingsForm;
    },
  });
  ctx.provide("sidebarRightTabs", {
    register: (definition: TabType) => {
      types.push(definition);
      return () => {
        disposed.tabs += 1;
      };
    },
  });
  ctx.provide("slots", {
    inject: (name: string, callback: () => (() => void) | void) => {
      registrations.push({
        name,
        key: undefined,
        id: undefined,
        locale: undefined,
        props: {},
        component: () => null,
      });
      const dispose = callback();
      return () => {
        disposed.slots += 1;
        if (typeof dispose === "function") dispose();
      };
    },
    register: (
      options: {
        name: string;
        key?: string;
        id?: string;
        locale?: string;
        inject?: () => Record<string, unknown>;
      },
      component: SeatComponent,
    ) => {
      registrations.push({
        name: options.name,
        key: options.key,
        id: options.id,
        locale: options.locale,
        props: options.inject?.() ?? {},
        component,
      });
      return () => undefined;
    },
  });

  return {
    ctx,
    types,
    registrations,
    configNamespaces,
    forms,
    mounted,
    disposed,
  };
}

/** The card's seat registration, or `undefined` when the plugin lost it. */
export function rowConfigRegistration(
  harness: Harness,
): Registration | undefined {
  return harness.registrations.find(
    (registration) =>
      registration.name === "plugins.row.config" &&
      registration.key !== undefined,
  );
}
