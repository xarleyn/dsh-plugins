import { Context } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it } from "vitest";
import type { PluginLogTail } from "../src/types.js";
import * as clientModule from "../src/client/index.js";
import {
  logPanelDefinition,
  LOG_PANEL_ID,
  LOG_PANEL_KIND,
} from "../src/client/panel/definition.js";

const { apply } = clientModule;

/**
 * Wiring guard for the client entry point.
 *
 * The panel is a page tab on the host's right Sidebar: a type in
 * `ctx.sidebarRightTabs` plus a body in the keyed `sidebar.right.pane.tab` seat
 * under that type's own id. Both halves are easy to get individually right and
 * wrong together — a body registered under the wrong key is never dispatched
 * and the tab draws the "nothing can view this" notice — so this drives the
 * real `apply()` against a bare cordis context and checks the pair.
 */

/** One injected `<style>` tag, as `injectCardStyles` creates it. */
interface StyleTag {
  readonly dataset: Record<string, string>;
  textContent: string;
  remove(): void;
}

/**
 * The least DOM `injectCardStyles` needs, so a test can see which sheets a
 * plugin actually injects. Without it the helper is a no-op and a plugin that
 * loses a whole stylesheet to a key collision still passes every test.
 */
function installDom(): { readonly tags: StyleTag[] } {
  const tags: StyleTag[] = [];
  const scope = globalThis as unknown as { document?: unknown };
  scope.document = {
    querySelector: (selector: string) => {
      const plugin = /^style\[data-plugin="(.*)"\]$/u.exec(selector)?.[1];
      return tags.find((tag) => tag.dataset["plugin"] === plugin) ?? null;
    },
    createElement: (): StyleTag => {
      const tag: StyleTag = {
        dataset: {},
        textContent: "",
        remove: () => {
          const index = tags.indexOf(tag);
          if (index >= 0) tags.splice(index, 1);
        },
      };
      return tag;
    },
    head: {
      appendChild: (tag: StyleTag) => {
        tags.push(tag);
      },
    },
  };
  return { tags };
}

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
});

const EMPTY_TAIL: PluginLogTail = {
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
    readonly order: number;
    readonly title: () => string;
  }[];
}

interface Registration {
  readonly name: string;
  readonly key: string | undefined;
  readonly locale: string | undefined;
  readonly props: Record<string, unknown>;
}

interface Harness {
  readonly ctx: Context;
  readonly types: TabType[];
  readonly registrations: Registration[];
  readonly mounted: { readonly count: number };
  readonly disposed: {
    readonly remote: number;
    readonly tabs: number;
    readonly slots: number;
  };
}

function harnessOf(): Harness {
  const ctx = new Context();
  const types: TabType[] = [];
  const registrations: Registration[] = [];
  const mounted = { count: 0 };
  const disposed = { remote: 0, tabs: 0, slots: 0 };

  const namespace = {
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

  // The namespace is a service of its own: `ctx.inject(['remote.pluginLogUi'])`
  // resolves the key, the code under test reads the property beside it.
  ctx.provide("remote", {
    pluginLogUi: namespace,
    $mount: () => {
      mounted.count += 1;
      return Promise.resolve(() => {
        disposed.remote += 1;
        return Promise.resolve();
      });
    },
  });
  ctx.provide("remote.pluginLogUi", namespace);
  ctx.provide("settingsScope", {
    bind: () => ({
      set: () => Promise.resolve(),
      subscribe: () => () => undefined,
      getSnapshot: () => ({
        status: "unavailable",
        value: undefined,
        writable: false,
      }),
    }),
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
        locale: undefined,
        props: {},
      });
      const dispose = callback();
      return () => {
        disposed.slots += 1;
        if (typeof dispose === "function") dispose();
      };
    },
    register: (options: {
      name: string;
      key?: string;
      locale?: string;
      inject?: () => Record<string, unknown>;
    }) => {
      registrations.push({
        name: options.name,
        key: options.key,
        locale: options.locale,
        props: options.inject?.() ?? {},
      });
      return () => undefined;
    },
  });

  return { ctx, types, registrations, mounted, disposed };
}

describe("client apply()", () => {
  it("registers the panel type and its body under the same id", async () => {
    const harness = harnessOf();
    const dispose = await apply(harness.ctx);

    expect(harness.mounted.count).toBe(1);
    const [type] = harness.types;
    expect(type).toMatchObject({
      id: LOG_PANEL_ID,
      kind: LOG_PANEL_KIND,
      priority: "extension",
    });
    expect(type?.title("sidebar://plugin-log")).toBe("Plugin logs");
    // A page type: it claims no resource address, so it opens by kind alone.
    expect(type?.patterns).toBeUndefined();
    expect(type?.guide?.map((entry) => [entry.order, entry.title()])).toEqual([
      [20, "Plugin logs"],
    ]);

    const body = harness.registrations.find(
      (registration) =>
        registration.name === "sidebar.right.pane.tab" &&
        registration.key !== undefined,
    );
    expect(body?.key).toBe(LOG_PANEL_ID);
    // No locale namespace: the panel's copy ships with the plugin, so the
    // registration must not ask the renderer for a dictionary it never installed.
    expect(body?.locale).toBeUndefined();
    expect(typeof body?.props["read"]).toBe("function");
    expect(typeof body?.props["sources"]).toBe("function");

    // The settings card still mounts beside the panel.
    expect(
      harness.registrations.some(
        (registration) => registration.name === "settings.plugin.item",
      ),
    ).toBe(true);

    await dispose();
    expect(harness.disposed.remote).toBe(1);
  });

  it("carries the injected read face's settled Remote result through", async () => {
    const harness = harnessOf();
    await apply(harness.ctx);
    const body = harness.registrations.find(
      (registration) => registration.key === LOG_PANEL_ID,
    );
    const read = body?.props["read"] as (
      cursor: number,
      limit: number,
    ) => Promise<unknown>;
    expect(await read(0, 10)).toEqual({ ok: true, value: EMPTY_TAIL });
  });

  it("names the registered consumers for the source filter", async () => {
    const harness = harnessOf();
    await apply(harness.ctx);
    const body = harness.registrations.find(
      (registration) => registration.key === LOG_PANEL_ID,
    );
    const sources = body?.props["sources"] as () => Promise<readonly string[]>;
    expect(await sources()).toEqual(["dsh-sample"]);
  });

  it("injects the card sheet and the panel sheet, each under its own key", async () => {
    const dom = installDom();
    const harness = harnessOf();
    await apply(harness.ctx);

    // `injectCardStyles` is idempotent per key, so one key for two sheets means
    // the second is treated as already injected and never reaches the document —
    // which is exactly how the settings card lost its own rules to the panel's.
    expect(dom.tags.map((tag) => tag.dataset["plugin"])).toEqual([
      "dsh-plugin-log-ui/panel",
      "dsh-plugin-log-ui",
    ]);
    const [panel, card] = dom.tags;
    expect(panel?.textContent).toContain(".plu-log{");
    expect(card?.textContent).toContain(".plu-grid{");
  });
});

describe("log panel definition", () => {
  it("offers one guide entry, ordered after the workspace files capsule", () => {
    const definition = logPanelDefinition();
    expect(
      definition.guide?.map((entry) => [entry.order, entry.title()]),
    ).toEqual([[20, "Plugin logs"]]);
    expect(definition.title("sidebar://plugin-log")).toBe("Plugin logs");
  });
});
