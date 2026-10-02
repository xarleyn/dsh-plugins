/**
 * Wiring guard for the client entry of the settings card.
 *
 * The card sits in the configuration seat that this bundle's own row on the
 * Plugins page owns. Three things are easy to get individually right and wrong
 * together: the seat key names `<package name>#<row id>` and the row id comes
 * from `cordis.patch.yml`, not from the constant this package reads the live
 * form under; and the row is titled and described by this package's exported
 * locale `meta`, not by the card. A key that names a row the patch does not
 * declare leaves the row without a configure control, a form resolved under any
 * other namespace edits values nobody reads, and a drifted `meta` renames the
 * row away from the card it opens — so this drives the real `apply()` against a
 * bare cordis context and checks all three against the shipped files.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Context } from "@deepseek-ai/cordis";
import { isValidElement } from "react";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

import { DOCUMENTS_CARD_SUMMARY, DocumentsCard } from "../src/client/card.js";
import * as clientModule from "../src/client/index.js";
import { DOCUMENTS_SETTINGS_NAMESPACE } from "../src/shared/settings.js";

const { apply } = clientModule;

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

/** One `ctx.slots.register` call, as the harness saw it. */
interface Registration {
  readonly name: string;
  readonly key: string | undefined;
  readonly props: Record<string, unknown>;
  readonly component: (props: never) => unknown;
}

/** The row this bundle's patch declares — the half of the key the Host owns. */
async function declaredRow(): Promise<{ id: string; name: string }> {
  const document = parseYaml(
    await readFile(join(packageRoot, "cordis.patch.yml"), "utf8"),
  ) as { insert?: { id?: string; name?: string }[] }[];
  const row = document.flatMap((part) => part.insert ?? [])[0] ?? {};
  if (typeof row.id !== "string" || typeof row.name !== "string") {
    throw new Error("the patch declares no row id and name");
  }
  return { id: row.id, name: row.name };
}

/** The display copy the Host reads for this package's row, without activating it. */
async function exportedMeta(): Promise<
  Record<string, string | undefined> | undefined
> {
  const locale = JSON.parse(
    await readFile(join(packageRoot, "locale/en.json"), "utf8"),
  ) as { meta?: Record<string, string | undefined> };
  return locale.meta;
}

/** The `plugins.row.config` key the row of this bundle owns. */
const ROW_CONFIG_KEY = `@yadsh/dsh-documents#${DOCUMENTS_SETTINGS_NAMESPACE}`;

function harnessOf(): {
  readonly ctx: Context;
  readonly registrations: Registration[];
  /** The seat names `ctx.slots.inject` was asked to wait for. */
  readonly injected: string[];
  /** The settings namespaces `apply()` resolved a live form under. */
  readonly namespaces: string[];
} {
  const ctx = new Context();
  const registrations: Registration[] = [];
  const injected: string[] = [];
  const namespaces: string[] = [];

  ctx.provide("configForms", {
    get: (namespace: string) => {
      namespaces.push(namespace);
      return {
        getSnapshot: () => ({
          status: "unavailable",
          value: undefined,
          writable: false,
          mode: "host",
        }),
        subscribe: () => () => undefined,
        mutate: () => Promise.resolve(true),
      };
    },
  });
  ctx.provide("slots", {
    inject: (name: string, callback: () => (() => void) | void) => {
      injected.push(name);
      const dispose = callback();
      return () => {
        if (typeof dispose === "function") dispose();
      };
    },
    register: (
      options: {
        name: string;
        key?: string;
        inject?: () => Record<string, unknown>;
      },
      component: (props: never) => unknown,
    ) => {
      registrations.push({
        name: options.name,
        key: options.key,
        props: options.inject?.() ?? {},
        component,
      });
      return () => undefined;
    },
  });

  return { ctx, registrations, injected, namespaces };
}

describe("client apply()", () => {
  it("registers the card on the keyed row seat and on nothing else", async () => {
    const harness = harnessOf();
    await apply(harness.ctx);

    expect(harness.injected).toEqual(["plugins.row.config"]);
    expect(harness.registrations).toHaveLength(1);
    const card = harness.registrations[0];
    expect(card?.name).toBe("plugins.row.config");
    expect(card?.key).toBe(ROW_CONFIG_KEY);
  });

  it("keys the seat and resolves the form under the row id its patch declares", async () => {
    const harness = harnessOf();
    await apply(harness.ctx);

    // The key is `<package name>#<row id>` and the row id is the namespace the
    // Host serves this plugin's volatile Config under, so a value written before
    // the card moved to this seat is the value the card reads after it. Neither
    // half is taken on trust from this package's own literal: both are read back
    // from `cordis.patch.yml`, which is what the page keys on. Renaming the
    // namespace or the row id therefore fails here instead of leaving the row
    // without a configure control.
    const row = await declaredRow();
    expect(harness.registrations[0]?.key).toBe(`${row.name}#${row.id}`);
    expect(harness.registrations[0]?.key?.split("#")[1]).toBe(row.id);
    expect(harness.namespaces).toEqual([row.id]);
    expect(row.id).toBe(DOCUMENTS_SETTINGS_NAMESPACE);
  });

  it("names and describes the row from this package's exported meta", async () => {
    // The page draws the row's title and description itself, from this package's
    // exported locale `meta` — the seat hands its registrant no `label`, and the
    // body draws no heading of its own. A bundle without this file is named by its
    // full package name, which is not a name an operator would recognise.
    const meta = await exportedMeta();
    expect(meta?.["title"]).toBe("Документы");
    // The row's description and the one-liner this entry answers its `summary`
    // view with are one string: the panel falls back to that answer, and a drift
    // would show the row describing something other than the page it opens.
    expect(meta?.["description"]).toBe(DOCUMENTS_CARD_SUMMARY);
  });

  it("hands the card the form under a name the seat cannot overwrite", async () => {
    const harness = harnessOf();
    await apply(harness.ctx);

    // The page renders its own `form` prop (the Host's `ConfigPageForm`) into the
    // same props object, so the card's subscribable form must not travel under
    // that name.
    const props = harness.registrations[0]?.props ?? {};
    expect(typeof props["settingsForm"]).toBe("object");
    expect("form" in props).toBe(false);
  });

  it("answers the summary view with the row's one-liner, not a second card", async () => {
    const harness = harnessOf();
    await apply(harness.ctx);
    const registration = harness.registrations[0];
    const entry = registration?.component;
    const settingsForm = registration?.props["settingsForm"];

    // The page asks for this view only where the row needs a one-liner it has no
    // display description for; the answer lands inside the page's own `<p>`, so
    // it stays text and never becomes a second card.
    expect(entry?.({ view: "summary", settingsForm } as never)).toBe(
      DOCUMENTS_CARD_SUMMARY,
    );

    // The `page` view is the body the page mounts under its own chrome.
    const body = entry?.({ view: "page", settingsForm } as never);
    expect(isValidElement(body)).toBe(true);
    expect((body as { type: unknown }).type).toBe(DocumentsCard);
  });
});
