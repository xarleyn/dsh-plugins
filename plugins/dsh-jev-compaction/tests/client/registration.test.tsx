// @vitest-environment jsdom

/**
 * The client entry's wiring: one card, in the configuration seat the Plugins page
 * gives this bundle's own row, bound to the Host settings section keyed by the
 * plugin's profile entry id. A wrong key means the card edits a section the Host
 * never serves, so the key is the whole contract.
 */

import type { Context } from "@deepseek-ai/cordis";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CLIENT_PLUGIN_NAME,
  SETTINGS_CARD_SLOT,
  apply,
  inject,
} from "../../src/client/index.js";
import { JEV_COMPACTION_ROW_SUMMARY } from "../../src/client/card.js";
import { JEV_COMPACTION_SETTINGS_NAMESPACE } from "../../src/shared/settings.js";

interface SlotRegistration {
  readonly name: string;
  readonly key?: string;
  readonly inject?: () => unknown;
  readonly component?: unknown;
}

/** One write the card issues against a form. */
interface WriteOp {
  readonly op: string;
  readonly path: readonly string[];
  readonly value?: unknown;
}

const resolvedNamespaces: string[] = [];

beforeEach(() => {
  resolvedNamespaces.length = 0;
});

afterEach(cleanup);

function stub(options: { withForms?: boolean; writes?: WriteOp[] } = {}) {
  const slots: SlotRegistration[] = [];
  const face = {
    configForms: {
      get: (entryId: string) => {
        resolvedNamespaces.push(entryId);
        // One stable snapshot object: the card reads it through
        // `useSyncExternalStore`, which re-renders on every identity change.
        const snapshot = {
          status: "ready",
          value: { enabled: true },
          base: {},
          // One override, so the reset control the write test clicks exists.
          user: { enabled: true },
          revision: 1,
          writable: true,
          mode: "host",
        };
        return {
          getSnapshot: () => snapshot,
          subscribe: () => () => {},
          mutate: async (ops: WriteOp[]) => {
            options.writes?.push(...ops);
          },
          set: async () => {},
          unset: async () => {},
        };
      },
    },
    slots: {
      inject: (_name: string, factory: () => unknown) => {
        factory();
        return () => {};
      },
      register: (registration: SlotRegistration, component: unknown) => {
        slots.push({ ...registration, component });
        return () => {};
      },
    },
  };
  if (options.withForms === false) {
    return { ctx: { slots: face.slots } as unknown as Context, slots };
  }
  return { ctx: face as unknown as Context, slots };
}

function registeredCard(): SlotRegistration {
  const { ctx, slots } = stub();
  apply(ctx);
  expect(slots).toHaveLength(1);
  return slots[0]!;
}

/**
 * The `ConfigPageForm` the row seat hands its registrant: `{ state, mutate }`,
 * beside the form this plugin resolved for itself.
 */
function pageForm(writes: WriteOp[]) {
  return {
    state: { status: "ready", value: {}, revision: 1, writable: true },
    mutate: async (ops: WriteOp[]) => {
      writes.push(...ops);
    },
  };
}

/** The entry as the row's configuration section renders it, with the page's form beside it. */
function mountRowSection(settingsWrites: WriteOp[]) {
  const { ctx, slots } = stub({ writes: settingsWrites });
  apply(ctx);
  const registration = slots[0]!;
  const Component = registration.component as ComponentType<
    Record<string, unknown>
  >;
  const pageWrites: WriteOp[] = [];
  const result = render(
    createElement(Component, {
      ...(registration.inject?.() as Record<string, unknown>),
      view: "page",
      form: pageForm(pageWrites),
    }),
  );
  return { ...result, pageWrites };
}

describe("client entry registration", () => {
  it("declares the client services the runtime must resolve", () => {
    expect([...inject]).toEqual(["slots", "configForms"]);
  });

  it("registers one card on the Plugins page row seat", () => {
    const registration = registeredCard();
    expect(registration.name).toBe("plugins.row.config");
    expect(SETTINGS_CARD_SLOT).toBe("plugins.row.config");
    expect(typeof registration.inject).toBe("function");
  });

  it("keys the seat by the package name and the row id whose section it edits", () => {
    const registration = registeredCard();
    // `<package name>#<row id>`, the row id as cordis.patch.yml declares it —
    // the same string the Host files this plugin's volatile Config under.
    expect(registration.key).toBe(
      `${CLIENT_PLUGIN_NAME}#${JEV_COMPACTION_SETTINGS_NAMESPACE}`,
    );
    expect(resolvedNamespaces).toEqual([JEV_COMPACTION_SETTINGS_NAMESPACE]);
  });

  it("hands the card the resolved form under a name the slot cannot overwrite", () => {
    const props = registeredCard().inject?.();
    // The seat renders its registrant with the page's own `form`, so the plugin's
    // ConfigForm arrives as `settingsForm` or the card would bind to the wrong one.
    expect(props).toEqual({
      settingsForm: expect.objectContaining({
        getSnapshot: expect.any(Function),
      }),
    });
  });

  it("answers the summary view with the one-liner, not a second card", () => {
    const component = registeredCard().component;
    expect(component).toBeDefined();
    const { container } = render(
      createElement(component as ComponentType<{ view: "summary" }>, {
        view: "summary",
      }),
    );
    // The page puts this view inside its own text, so it stays a sentence: a card
    // here would nest a second shell under the row.
    expect(container.textContent).toBe(JEV_COMPACTION_ROW_SUMMARY);
    expect(container.querySelector("li.dsh-plugin-card")).toBeNull();
    // And no control of the form reaches the collapsed row.
    expect(container.querySelector("input, select, button")).toBeNull();
  });

  it("mounts the card in the row's section and writes through the injected form", () => {
    const settingsWrites: WriteOp[] = [];
    const { container, pageWrites } = mountRowSection(settingsWrites);
    // The seat really renders the card: the shell the configuration contract
    // asserts, kept inside the list this plugin owns.
    const root = container.querySelector("li.dsh-plugin-card");
    expect(root).not.toBeNull();
    expect(root!.parentElement?.tagName).toBe("UL");
    // Opened the way a user opens it, then one write.
    fireEvent.click(
      screen.getByRole("button", { name: "Show settings: Jev Compaction" }),
    );
    fireEvent.click(screen.getByTestId("jevc-reset-overrides"));
    // The card binds to the form it resolved for its own namespace — the one that
    // can be subscribed to and read field by field — and never to the page's
    // `{ state, mutate }`, whatever the seat passes beside it.
    expect(settingsWrites).toEqual([{ op: "unset", path: ["enabled"] }]);
    expect(pageWrites).toEqual([]);
  });

  it("renders no card when the page exposes no settings forms", () => {
    const { ctx, slots } = stub({ withForms: false });
    const dispose = apply(ctx);
    expect(slots).toHaveLength(0);
    expect(typeof dispose).toBe("function");
  });

  it("identifies itself by the full package name", () => {
    expect(CLIENT_PLUGIN_NAME).toBe("@yadsh/dsh-jev-compaction");
  });
});
