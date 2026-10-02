import { afterEach, describe, expect, it } from "vitest";
import * as clientModule from "../src/client/index.js";
import {
  logPanelDefinition,
  LOG_PANEL_ID,
  LOG_PANEL_KIND,
} from "../src/client/panel/definition.js";
import {
  EMPTY_TAIL,
  harnessOf,
  rowConfigRegistration,
} from "./helpers/client-harness.js";

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
 *
 * The card's own rendering is in `client-card.test.tsx`, which mounts the
 * component captured here rather than a copy of it.
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

    // The settings card mounts on the host Plugins page, in the keyed seat the
    // row of this bundle owns.
    const card = rowConfigRegistration(harness);
    expect(card?.key).toBe("@yadsh/dsh-plugin-log-ui#dsh-plugin-log-ui");
    // The row id in that key is also the namespace the live form is resolved
    // under, which is what keeps a value saved before the move readable after it.
    expect(harness.configNamespaces).toEqual(["dsh-plugin-log-ui"]);
    // The seat hands the page's own `ConfigPageForm`, which can neither be
    // subscribed to nor written field by field, so the card's form arrives
    // through the injected face, under a name the owner prop cannot shadow — and
    // it is the same form the stand resolved for that one namespace.
    expect(card?.props["settingsForm"]).toBe(
      harness.forms.get("dsh-plugin-log-ui"),
    );
    expect(typeof card?.props["inspect"]).toBe("function");

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
    // The card sheet is injected first now that its registration no longer waits
    // on the Remote namespace; the pair, not their order, is the contract.
    expect(dom.tags.map((tag) => tag.dataset["plugin"])).toEqual([
      "dsh-plugin-log-ui",
      "dsh-plugin-log-ui/panel",
    ]);
    const [card, panel] = dom.tags;
    expect(panel?.textContent).toContain(".plu-log{");
    expect(card?.textContent).toContain(".plu-grid{");
  });

  /*
   * Both sheets now dress their controls with the Host's ring pair rather than an
   * outline of their own: `focus.css` of the Host outranks a hard-coded
   * `outline: 2px solid …` under pointer modality (0-3-2 against 0-2-0), so a ring
   * written by hand is one a mouse click erases. Each half of the pair needs its
   * fallback too — where a token is undeclared the whole `outline` shorthand is
   * invalid, and the ring vanishes instead of degrading. Read off the sheets the
   * plugin actually injects, so a rule deleted to satisfy the gate is caught here.
   */
  it("rings every control it draws with the Host's focus tokens, each with a fallback", async () => {
    const dom = installDom();
    await apply(harnessOf().ctx);

    const rules = dom.tags.flatMap((tag) => [
      ...tag.textContent.matchAll(
        /:focus(?:-visible)?[^{}]*\{[^}]*outline:\s*([^;}]+)/gu,
      ),
    ]);
    // The card's selects, and the panel's level chips, action buttons, source
    // filter and search field — four rules, one per control family.
    expect(rules).toHaveLength(4);
    for (const [, value] of rules) {
      for (const token of [
        "--dsw-focus-ring-width",
        "--dsw-focus-ring-color",
      ]) {
        expect(value).toContain(token);
        expect(value).toMatch(new RegExp(`${token}\\s*,\\s*\\S+`, "u"));
      }
    }
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
