/**
 * The seam between this card and the Host's Plugins page.
 *
 * Two of the move's load-bearing facts are invisible to the compiler, and each
 * fails by making the card quietly disappear rather than by throwing:
 *
 * 1. The seat is keyed `<package name>#<row id>`, and the page looks that key up
 *    in the inventory built from this bundle's `cordis.patch.yml`. Restating the
 *    key as a literal here would let a renamed row or a renamed package unseat
 *    the card while every gate stayed green — so the key is derived from the two
 *    files that define it, and the row id is compared against the settings
 *    namespace the card reads and writes under, because one string is both.
 * 2. The page spreads its own owner props over the injected face, and two of
 *    them are `view` and `form`. A face occupying either name is overwritten
 *    without a trace, so the full `ConfigForm` crosses as `settingsForm` and
 *    neither owner name is claimed.
 *
 * The same entry is seated twice — once as the row's description line, once as
 * its configuration body — which is what the last three cases pin. What the page
 * *draws* from those answers is `client-card.test.tsx`.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WEB_FETCH_AUTH_SETTINGS_NAMESPACE } from "../src/types.js";
import { registeredSeat } from "./client-seat.helpers.js";

/** The package this bundle publishes under, read from its own manifest. */
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { name: string };

/**
 * The `id` of this bundle's single patch row, read from the patch the Host
 * inventories. The `key` the page matches on is built from it, so the test takes
 * it from the same source rather than trusting a copy.
 */
function patchRowId(): string {
  const patch = readFileSync(
    new URL("../cordis.patch.yml", import.meta.url),
    "utf8",
  );
  const ids = [...patch.matchAll(/^\s*-\s*id:\s*(\S+)\s*$/gmu)].map(
    (match) => match[1] as string,
  );
  expect(ids, "the patch must declare exactly one row").toHaveLength(1);
  return ids[0] as string;
}

/** The card's own source, for the two sentences it must not merge. */
const clientSource = readFileSync(
  new URL("../src/client/index.tsx", import.meta.url),
  "utf8",
);

describe("plugins row configuration seat", () => {
  it("keys the seat by this package and its own patch row", async () => {
    const seat = await registeredSeat();
    expect(seat.name).toBe("plugins.row.config");
    expect(seat.key).toBe(`${packageJson.name}#${patchRowId()}`);
  });

  it("takes the row id as the settings namespace, so a saved value survives the move", async () => {
    const seat = await registeredSeat();
    const [packageName, rowId] = (seat.key ?? "").split("#");
    expect(rowId).toBe(WEB_FETCH_AUTH_SETTINGS_NAMESPACE);
    expect(packageName).toBe(packageJson.name);
  });

  it("frees both owner prop names and carries the form under a third", async () => {
    const seat = await registeredSeat();
    expect(seat.face).not.toHaveProperty("form");
    expect(seat.face).not.toHaveProperty("view");
    expect(seat.face.settingsForm).toBeDefined();
  });

  it("answers the row's summary seat with one line of text and no card", async () => {
    const seat = await registeredSeat();
    // The harness types the seat as a component because the page renders it; the
    // summary answer is not an element, so it leaves that type here rather than
    // in the seat's signature.
    const summary = seat.component({
      ...seat.face,
      view: "summary",
    }) as unknown;

    // The page drops this into a paragraph of its own; markup here would nest a
    // card inside a sentence, and the card's hooks would run for a line of text.
    expect(typeof summary).toBe("string");
    expect(summary).not.toMatch(/</u);
    expect((summary as string).trim()).not.toBe("");
  });

  it("mounts the card only for the page seat, over the same form", async () => {
    const seat = await registeredSeat();
    const page = seat.component({ ...seat.face, view: "page" }) as {
      type: unknown;
      props: Record<string, unknown>;
    };

    expect(typeof page.type).toBe("function");
    expect(page.props.settingsForm).toBe(seat.face.settingsForm);
  });

  it("seats the row's sentence and the card's own copy as two separate answers", () => {
    /*
     * The page prints the summary view as the row's description line one paragraph
     * above the card this same entry draws, so the header needs its own sentence —
     * one shared literal is how the two screens start repeating themselves. Which
     * text lands where is asserted in the rendered card.
     */
    expect(clientSource).toMatch(
      /if \(view === "summary"\) return WEB_FETCH_AUTH_ROW_SUMMARY;/u,
    );
    expect(clientSource).toMatch(
      /description=\{WEB_FETCH_AUTH_CARD_DESCRIPTION\}/u,
    );
    expect(clientSource).not.toMatch(
      /description=\{WEB_FETCH_AUTH_ROW_SUMMARY\}/u,
    );
  });
});
