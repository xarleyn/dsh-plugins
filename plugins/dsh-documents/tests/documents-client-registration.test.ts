/**
 * Wiring guard for the client entry of the settings card.
 *
 * The card sits in the configuration seat that this bundle's own row on the
 * Plugins page owns. Two halves of that join are easy to get individually right
 * and wrong together: the seat key names `<package name>#<row id>`, and the row
 * id is also the namespace the live form is resolved under. A key that names a
 * row the patch does not declare leaves the row without a configure control, and
 * a form resolved under any other namespace edits values nobody reads — so this
 * drives the real `apply()` against a bare cordis context and checks the pair.
 */

import { Context } from "@deepseek-ai/cordis";
import { isValidElement } from "react";
import { describe, expect, it } from "vitest";

import { DOCUMENTS_CARD_SUMMARY, DocumentsCard } from "../src/client/card.js";
import * as clientModule from "../src/client/index.js";
import { DOCUMENTS_SETTINGS_NAMESPACE } from "../src/shared/settings.js";

const { apply } = clientModule;

/** One `ctx.slots.register` call, as the harness saw it. */
interface Registration {
  readonly name: string;
  readonly key: string | undefined;
  readonly props: Record<string, unknown>;
  readonly component: (props: never) => unknown;
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

  it("resolves the live form under the row id its own seat key names", async () => {
    const harness = harnessOf();
    await apply(harness.ctx);

    // The key is `<package name>#<row id>`; the row id is the namespace the Host
    // serves this plugin's volatile Config under, so a value written before the
    // card moved to this seat is the value the card reads after it.
    expect(harness.namespaces).toEqual([DOCUMENTS_SETTINGS_NAMESPACE]);
    expect(harness.registrations[0]?.key?.split("#")[1]).toBe(
      DOCUMENTS_SETTINGS_NAMESPACE,
    );
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

    // The `summary` view lands inside the page's own `<p>`: it stays text.
    expect(entry?.({ view: "summary", settingsForm } as never)).toBe(
      DOCUMENTS_CARD_SUMMARY,
    );

    // The `page` view is the card, which is what draws the shell.
    const body = entry?.({ view: "page", settingsForm } as never);
    expect(isValidElement(body)).toBe(true);
    expect((body as { type: unknown }).type).toBe(DocumentsCard);
  });
});
