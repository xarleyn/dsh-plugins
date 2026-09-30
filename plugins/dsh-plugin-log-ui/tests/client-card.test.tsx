// @vitest-environment jsdom
/**
 * The card rendered the way the host's Plugins page renders it.
 *
 * The seat is the card's only route to a stored value, and the page calls the
 * registered entry twice, in two shapes: `RowDetail` puts the row's description in
 * a `<p>`, falling back to `{ view: "summary" }` for a row that declares none, and
 * mounts the configuration section with `{ view: "page", form }`
 * (`@deepseek-ai/dsh-client-ui-plugin-manager@0.1.7-rc.2`, `lib/client.js:1841`
 * and `:1852`). Both shapes are driven here against the component `apply()`
 * actually registered, so the read and the write of this plugin's namespace are
 * proven rather than asserted in prose: a level and a format stored by an earlier
 * build come back into the selects, and a change leaves through the form resolved
 * for that namespace.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import * as clientModule from "../src/client/index.js";
import { harnessOf, rowConfigRegistration } from "./helpers/client-harness.js";

const { apply } = clientModule;

/** What one `set` call carried. */
interface Write {
  readonly field: string;
  readonly value: unknown;
}

/**
 * A stand for the live `ConfigForm` of this plugin's namespace, holding the values
 * a build *before* the move wrote there.
 *
 * `getSnapshot` returns one object for every call, as the Host's form does: a fresh
 * object each render would spin `useSyncExternalStore` forever.
 */
function storedForm(writes: Write[]) {
  const snapshot = {
    status: "ready" as const,
    value: {
      defaultLevel: "warn",
      format: "json",
      levels: { "dsh-sample": "debug" },
    },
    base: undefined,
    user: {},
    revision: 3,
    writable: true,
    mode: "host" as const,
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    set: (field: string, value: unknown) => {
      writes.push({ field, value });
      return Promise.resolve(true);
    },
    unset: (field: string) => {
      writes.push({ field, value: undefined });
      return Promise.resolve(true);
    },
    mutate: () => Promise.resolve(true),
  };
}

/**
 * The page's own `ConfigPageForm`, shaped as the contract declares it: `{ state,
 * mutate }`, no subscription and no single-field write. It rides along on purpose —
 * were the card ever to read `props.form` instead of its own, this object has no
 * `set` to call and no level to show, so the assertions below fail loudly rather
 * than writing somewhere quiet.
 */
const PAGE_FORM = {
  state: { status: "ready", value: {}, revision: 0, writable: true },
  mutate: () => Promise.resolve(true),
};

/**
 * Mount the seat's entry as the page's configuration section does, and open the
 * card. Also waits for the registry snapshot, which the card reads on mount rather
 * than receiving as a prop.
 */
async function openCard(writes: Write[]) {
  const harness = harnessOf({ settingsForm: storedForm(writes) });
  await apply(harness.ctx);
  const seat = rowConfigRegistration(harness);
  if (!seat) throw new Error("the card lost its seat registration");

  render(
    createElement(seat.component, {
      ...seat.props,
      view: "page",
      form: PAGE_FORM,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: /Show settings/ }));
  await waitFor(() =>
    expect(screen.getByTestId("log-card-plugin-row")).toBeDefined(),
  );
  return harness;
}

afterEach(() => {
  cleanup();
});

describe("the row-config card", () => {
  it("reads back the level and format stored under the row's namespace", async () => {
    await openCard([]);

    // Both came from the form `apply()` resolved, not from a default: a card that
    // lost the read path would sit on `info` + `text` and still look alive.
    expect(
      screen.getByTestId<HTMLSelectElement>("log-card-default-level").value,
    ).toBe("warn");
    expect(screen.getByTestId<HTMLSelectElement>("log-card-format").value).toBe(
      "json",
    );
    expect(
      screen.getByTestId<HTMLSelectElement>("log-card-plugin-level").value,
    ).toBe("debug");
  });

  it("writes a change through the form of that namespace, not through the page's", async () => {
    const writes: Write[] = [];
    await openCard(writes);

    fireEvent.change(screen.getByTestId("log-card-default-level"), {
      target: { value: "error" },
    });
    await waitFor(() =>
      expect(writes).toEqual([{ field: "defaultLevel", value: "error" }]),
    );
  });

  it("keeps the shell contract: an li card inside the plugin's own ul", async () => {
    await openCard([]);

    const header = screen.getByRole("button", {
      name: /settings: Plugin logging/,
    });
    const root = header.closest("li");
    expect(root?.className).toContain("dsh-plugin-card");
    // The page's configuration section supplies no list, so the entry brings one.
    expect(root?.parentElement?.tagName).toBe("UL");
    expect(root?.parentElement?.getAttribute("data-testid")).toBe(
      "log-card-section",
    );
  });

  it("answers the summary seat with the one-liner, and no second card", async () => {
    const harness = harnessOf();
    await apply(harness.ctx);
    const seat = rowConfigRegistration(harness);
    if (!seat) throw new Error("the card lost its seat registration");

    const { container } = render(
      createElement(seat.component, { ...seat.props, view: "summary" }),
    );
    expect(container.textContent).toBe(
      "Levels and readable file output for registered server plugins.",
    );
    // A card here would nest an `li` inside the page's own `<p>`.
    expect(container.querySelector(".dsh-plugin-card")).toBeNull();
  });
});
