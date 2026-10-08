// @vitest-environment jsdom
/**
 * The card rendered the way the host's Plugins page renders it.
 *
 * The seat is the card's only route to a stored value, and the page calls the
 * registered entry twice, in two shapes: `RowDetail` puts the row's description in
 * a `<p>`, falling back to `{ view: "summary" }` for a row that declares none, and
 * mounts the configuration section with `{ view: "page", form }` (the shapes are
 * pinned to the installed package by `host-seat-contract.test.ts`). Both shapes are
 * driven here against the component `apply()` actually registered, so the read and
 * the write of this plugin's namespace are proven rather than asserted in prose: a
 * level and a format stored by an earlier build come back into the selects, and a
 * change leaves through the form resolved for that namespace.
 *
 * The page draws the chrome on this surface — the surface, the heading and the
 * expand control — so what is pinned here besides the data path is that the bundle
 * brings a body and no frame of its own (decision D1 of §10, reversed to "as the
 * host does" and landed through #684).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

/*
 * The row's sentence as the host reads it: `meta.description` of the exported
 * `locale/en.json`, which fills the page's `<p>` before the seat is ever asked for
 * its `summary` view — the manifest's own `description` is only the fallback behind
 * that file. Resolved through `fileURLToPath` because the jsdom environment
 * replaces the global `URL`, and Node's `readFileSync` only recognises its own.
 */
const ROW_META = (
  JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "locale/en.json"),
      "utf8",
    ),
  ) as { meta: { description: string; title: string } }
).meta;

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
function storedForm(writes: Write[], writable = true) {
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
    writable,
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
 * than writing somewhere quiet. The empty `value` is the tell: nothing here is a
 * level the card could display.
 */
const PAGE_FORM = {
  state: {
    status: "ready" as const,
    value: {},
    base: undefined,
    user: {},
    revision: 0,
    writable: true,
    mode: "host" as const,
  },
  mutate: () => Promise.resolve(true),
};

/**
 * Mount the seat's entry as the page's configuration section does. The section is
 * mounted when the row opens, so there is nothing to click here: the body is the
 * whole of what this bundle answers. Also waits for the registry snapshot, which
 * the card reads on mount rather than receiving as a prop.
 */
async function openCard(writes: Write[], writable = true) {
  const harness = harnessOf({ settingsForm: storedForm(writes, writable) });
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
  await waitFor(() =>
    expect(screen.getByTestId("log-card-plugin-row")).toBeDefined(),
  );
  return harness;
}

afterEach(() => {
  cleanup();
});

describe("the row-config card", () => {
  /*
   * The state the page shows the moment the row opens. The configuration section is
   * mounted eagerly and the Host's own control is what expands it, so a body that
   * waited for a click of ours would park the reader inside an opened row with a
   * second disclosure to find. The surface, the heading and the chevron this card
   * used to draw are the page's now: repeating them is the second frame that
   * decision D1 of §10 forbids, so what the bundle owes is the body alone.
   */
  it("mounts the form under the page's chrome and draws no frame of its own", async () => {
    const writes: Write[] = [];
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

    const root = screen.getByTestId("log-card-section");
    // A `div` body, not the `li` of a card that owns its shell inside a list.
    expect(root.tagName).toBe("DIV");
    expect(root.querySelector("li")).toBeNull();
    /*
     * The fields are on the page before anyone clicks. A closed-but-mounted body
     * would put two editors on the page at once; a body that stayed hidden behind a
     * header of ours would leave the opened row with nothing in it.
     */
    expect(screen.getByTestId("log-card-default-level")).toBeDefined();
    expect(screen.getByTestId("log-card-format")).toBeDefined();
    await waitFor(() =>
      expect(screen.getByTestId("log-card-plugin-row")).toBeDefined(),
    );
    /*
     * The page owns the disclosure, so the body brings no expand control of ours:
     * nothing carries `aria-expanded`, and no button offers to show or hide the
     * card. The buttons the body does draw are actions the page's chrome cannot
     * supply — hold a level for a moment, give it back — and they open nothing.
     */
    expect(root.querySelector("[aria-expanded]")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^(show|hide|expand|collapse)/iu }),
    ).toBeNull();
    expect(root.querySelector("svg")).toBeNull();
    expect(root.className).not.toContain("dsh-plugin-card");
    expect(root.querySelector("[class*='dsh-plugin-card']")).toBeNull();
    // Mounting the section is not an edit: the stand records what the card wrote.
    expect(writes).toEqual([]);
  });

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

  it("keeps the live consumer count inside the body it draws", async () => {
    await openCard([]);

    /*
     * The count rode the card header's badge, and the header is the page's now.
     * Deleting it along with the chrome would drop the only number in the section
     * that says how many loggers these settings are applied to, so it sits with the
     * list it counts.
     */
    expect(
      screen.getByTestId<HTMLSpanElement>("log-card-active-count").textContent,
    ).toBe("1 active");
  });

  it("answers the summary seat with the row's one-liner, and no body", async () => {
    const harness = harnessOf();
    await apply(harness.ctx);
    const seat = rowConfigRegistration(harness);
    if (!seat) throw new Error("the card lost its seat registration");

    const { container } = render(
      createElement(seat.component, { ...seat.props, view: "summary" }),
    );
    /*
     * The host fills the row's sentence from `meta.description` and only asks this
     * seat when the row declares none, so the two must be the same sentence — read
     * here rather than repeated, since an edit to that file cannot be caught by a
     * literal in a test.
     */
    expect(container.textContent).toBe(ROW_META.description);
    // The row's name comes from the same file and nowhere else: the seat hands the
    // registrant no label, so this is the phrase an operator reads on the panel.
    expect(ROW_META.title).toBe("Plugin Logging");
    // The sentence lands inside the page's own `<p>`: a form there is a page in a line.
    expect(container.querySelector("select")).toBeNull();
    expect(
      container.querySelector("[data-testid='log-card-section']"),
    ).toBeNull();
  });

  it("says what is unavailable instead of leaving the opened row silent", async () => {
    const harness = harnessOf();
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

    /*
     * A card that owns its shell can stay invisible while its namespace answers
     * `unavailable` — there is no frame to explain. Inside the page's chrome the
     * row is already open, so silence reads as a broken section and the body owes
     * the reason.
     */
    expect(screen.getByTestId("log-card-unavailable").textContent).toContain(
      "not reachable",
    );
    expect(screen.queryByTestId("log-card-default-level")).toBeNull();
    // The read-only notice is for a connection that can read but not write.
    expect(screen.queryByTestId("log-card-read-only")).toBeNull();
  });

  /*
   * The hold path, and the one thing it owes: a level the operator did not save
   * must never reach the settings form. Before #743 the card had only the saved
   * overrides, so looking at one plugin's DEBUG meant writing it to the stand's
   * Config and remembering to undo it; these tests stand on the distinction the
   * card now draws between looking and leaving.
   */
  it("holds a level through the plugin's Remote and writes nothing to settings", async () => {
    const writes: Write[] = [];
    const harness = await openCard(writes);

    fireEvent.change(screen.getByTestId("log-card-hold-plugin"), {
      target: { value: "dsh-sample" },
    });
    fireEvent.change(screen.getByTestId("log-card-hold-window"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByTestId("log-card-hold-apply"));

    await waitFor(() =>
      expect(harness.holds).toEqual([
        { pluginId: "dsh-sample", level: "debug", minutes: 5 },
      ]),
    );
    // The form records every `set` the card makes, and the hold made none.
    expect(writes).toEqual([]);
  });

  it("marks the row that runs on a held level and keeps its select on the setting", async () => {
    const writes: Write[] = [];
    await openCard(writes);

    fireEvent.change(screen.getByTestId("log-card-hold-plugin"), {
      target: { value: "dsh-sample" },
    });
    fireEvent.change(screen.getByTestId("log-card-hold-level"), {
      target: { value: "trace" },
    });
    fireEvent.click(screen.getByTestId("log-card-hold-apply"));

    const marker = await screen.findByTestId("log-card-hold-marker");
    expect(marker.textContent).toContain("not saved: held at trace");
    expect(marker.textContent).toContain("min left");
    // The row reports what the logger is running at, which is now not what the
    // select says: the two disagree on purpose, and the chip says why.
    const row = screen.getByTestId("log-card-plugin-row");
    expect(row.textContent).toContain("active: trace");
    expect(
      screen.getByTestId<HTMLSelectElement>("log-card-plugin-level").value,
    ).toBe("debug");
    expect(writes).toEqual([]);
  });

  it("counts a session hold down as nothing and gives it back on the click", async () => {
    const harness = await openCard([]);

    fireEvent.change(screen.getByTestId("log-card-hold-plugin"), {
      target: { value: "dsh-sample" },
    });
    fireEvent.change(screen.getByTestId("log-card-hold-window"), {
      target: { value: "session" },
    });
    fireEvent.click(screen.getByTestId("log-card-hold-apply"));

    await waitFor(() => expect(harness.holds).toHaveLength(1));
    expect(harness.holds[0]?.minutes).toBeUndefined();
    const held = screen.getByTestId("log-card-hold-row");
    expect(held.textContent).toContain("until revoked");
    expect(held.textContent).not.toMatch(/min left/u);

    fireEvent.click(screen.getByTestId("log-card-hold-revert"));
    await waitFor(() => expect(harness.releases).toEqual(["dsh-sample"]));
    await waitFor(() =>
      expect(screen.queryByTestId("log-card-hold-row")).toBeNull(),
    );
    expect(screen.queryByTestId("log-card-hold-marker")).toBeNull();
  });

  it("disables the hold controls instead of hiding them from a read-only connection", async () => {
    await openCard([], false);

    // The Plugins panel answers from a non-loopback browser where the settings
    // directory is not reachable; the card stays, the writes stop (AGENTS.md).
    expect(
      screen.getByTestId<HTMLButtonElement>("log-card-hold-apply").disabled,
    ).toBe(true);
    expect(
      screen.getByTestId<HTMLSelectElement>("log-card-hold-plugin").disabled,
    ).toBe(true);
    expect(screen.getByTestId("log-card-read-only")).toBeDefined();
    expect(screen.getByTestId("log-card-section")).toBeDefined();
  });
});
