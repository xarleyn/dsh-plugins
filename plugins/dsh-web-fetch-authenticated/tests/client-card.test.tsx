// @vitest-environment jsdom
/**
 * What the Plugins page draws from this bundle's row seat.
 *
 * `client-registration.test.ts` pins what `apply()` hands the slot — the key, the
 * face, the prop names — and cannot see the markup. Every way the move can fail
 * quietly lives in that markup: the entry answering markup where the page wanted
 * a line of text, the shell's `<li>` losing the `<ul>` AGENTS.md styles it
 * against, the body mounting over a form that never reached it, an edit whose
 * write never reaches that form, a write landing in the page's own `{ state,
 * mutate }` view instead of the `ConfigForm` that stores it, and the card header
 * repeating the sentence the page already printed one line above. This package
 * shipped without a DOM-rendering test on purpose (epic #453 addressed the
 * card from a browser instead); the seat made that gap load-bearing.
 *
 * The page renders each view with its own props (`PluginManagerPage.tsx:491`,
 * `:495`), so every case here goes through `seatProps`, which spreads those owner
 * props over the face the way the renderer does.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  demoConfig,
  registeredSeat,
  seatProps,
} from "./client-seat.helpers.js";

/**
 * The sentence the row page prints above this card: the Host reads the row's
 * display metadata off the bundle's own manifest and falls back to its
 * `description` field (`@deepseek-ai/dsh-plugin-manager` `src/index.ts:650`,
 * `@deepseek-ai/dsh-app-boot` `src/package-meta.ts:157`), so the line the user
 * sees is this string, not the entry's summary answer.
 */
const rowDescription =
  // Resolved through `node:url`/`node:path`: the `URL` the jsdom global exposes
  // answers a relative spec against the document base, not against this module.
  (
    JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
        "utf8",
      ),
    ) as { description: string }
  ).description;

/** The page renders the seat; the card polls the Remote on mount, inside `act`. */
async function renderSeat(
  seat: { component: (props: Record<string, unknown>) => ReactElement },
  view: "page" | "summary",
): Promise<ReturnType<typeof render>> {
  let result: ReturnType<typeof render> | undefined;
  await act(async () => {
    result = render(<seat.component {...seatProps(seat, view)} />);
    await Promise.resolve();
  });
  return result as ReturnType<typeof render>;
}

afterEach(async () => {
  // A poll whose reply lands after the assertions would report as an unwrapped
  // state update; flush it before unmounting.
  await act(async () => {
    await Promise.resolve();
  });
  cleanup();
});

describe("plugins row configuration entry, rendered", () => {
  it("draws the canonical shell in a list of its own, and opens the live body on click", async () => {
    const seat = await registeredSeat();
    const { container } = await renderSeat(seat, "page");

    const card = container.querySelector(".dsh-plugin-card");
    expect(card).toBeTruthy();
    // The shell renders its body only while open, so a closed card proves the
    // click is what reveals the configuration rather than a permanent panel.
    expect(container.querySelector(".dsh-plugin-card__body")).toBeNull();

    /*
     * The AGENTS.md pair, not one node: the shell is an `<li>` under rules written
     * against a list parent, and the row page's configuration column is a plain
     * `<div>` (`PluginManagerPage.tsx:494`, `detailSections`). Nothing but a
     * rendered card notices the wrapper going away.
     */
    const list = screen.getByTestId("wfa-card-list");
    expect(list.tagName).toBe("UL");
    expect(card?.parentElement).toBe(list);

    const header = screen.getByRole("button", {
      name: /show settings: authenticated web fetch/iu,
    });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(header);

    expect(container.querySelector(".dsh-plugin-card--open")).toBeTruthy();
    // The opened body is the live card, not a placeholder: the rule the stand
    // form carries is what proves the configuration reached it.
    expect(await screen.findByTestId("wfa-rules-list")).toBeTruthy();
    expect(screen.getByTestId("wfa-rule-row").textContent).toContain(
      "Demo product",
    );
    expect(screen.getByTestId("wfa-card-enabled-state").textContent).toBe(
      "Enabled",
    );

    // The mount-time poll reaches the Remote through the face the slot injected,
    // so the report the status section prints is the second proof of the props.
    const status = await screen.findByTestId("wfa-status-section");
    expect(status.textContent).toContain("1 rule(s), 1 enabled");
  });

  it("saves an edit to the Host form as one field of the namespace", async () => {
    /*
     * The clause the move cannot prove by rendering: a card seated on the row page
     * still has to reach the same Host form the old tab wrote through. `set`
     * addresses a scalar field inside the namespace section, so a knob nested
     * under `audit` travels as its whole container — a dotted path is something
     * the Host does not accept, and a card that looked right while sending one
     * would have lost every write silently.
     */
    const seat = await registeredSeat();
    await renderSeat(seat, "page");
    fireEvent.click(
      screen.getByRole("button", {
        name: /show settings: authenticated web fetch/iu,
      }),
    );
    await screen.findByTestId("wfa-global-section");

    fireEvent.click(screen.getByTestId("wfa-global-provider-enabled"));
    fireEvent.click(screen.getByTestId("wfa-global-audit-enabled"));

    expect(seat.writes).toEqual([
      { field: "enabled", value: false },
      { field: "audit", value: { enabled: false } },
    ]);
    // The page spreads its own `form` over the face, and the entry drops it
    // there. A card reading its configuration off that view and writing to the
    // face would show one thing and store another, so nothing may reach it.
    expect(seat.mutations).toEqual([]);
  });

  it("answers the row's own description and keeps its header off it", async () => {
    /*
     * The line above the card is this package's `description`, which the Host
     * reads off the manifest; the entry's summary answer is the fallback for a
     * row whose metadata carries none. Either of the two, copied into the card
     * header, prints the same sentence twice on one screen.
     */
    const seat = await registeredSeat();
    const page = await renderSeat(seat, "page");
    const summary = await renderSeat(seat, "summary");

    const cardDescription = page.container.querySelector(
      ".dsh-plugin-card__description",
    );
    expect(cardDescription?.textContent).toBeTruthy();
    expect(cardDescription?.textContent).not.toBe(rowDescription);
    expect(cardDescription?.textContent).not.toBe(
      summary.container.textContent,
    );
  });

  it("draws no card while the Host configuration is unavailable", async () => {
    const seat = await registeredSeat(demoConfig(), "unavailable");
    const { container } = await renderSeat(seat, "page");

    expect(container.querySelector(".dsh-plugin-card")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("keeps the card and disables its writes while the namespace is read-only", async () => {
    /*
     * The other half of the seat's availability story: a row page the Host does
     * serve, for a Config it will not let this browser edit. AGENTS.md asks for
     * disabled controls rather than a hidden card, so the operator still reads
     * the rules and the policy, and the refusal is what the toggle shows.
     */
    const seat = await registeredSeat(demoConfig(), "ready", false);
    const { container } = await renderSeat(seat, "page");
    fireEvent.click(
      screen.getByRole("button", {
        name: /show settings: authenticated web fetch/iu,
      }),
    );
    await screen.findByTestId("wfa-global-section");

    expect(container.querySelector(".dsh-plugin-card")).toBeTruthy();
    const toggle = screen.getByTestId(
      "wfa-global-provider-enabled",
    ) as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
    expect(
      (screen.getByTestId("wfa-global-audit-enabled") as HTMLInputElement)
        .disabled,
    ).toBe(true);
  });

  it("answers the summary view with one line of text and no second card", async () => {
    /*
     * The view the page asks for when a row's metadata carries no description
     * (`PluginManagerPage.tsx:491`); for this row the manifest supplies one, so
     * this answer is the fallback. Either way it lands inside the page's own
     * paragraph, so it stays text — a card here would mount a live settings store
     * and poll the Remote a second time for a line of prose.
     */
    const seat = await registeredSeat();
    const { container } = await renderSeat(seat, "summary");

    expect(container.querySelector(".dsh-plugin-card")).toBeNull();
    expect(container.textContent).toBe(
      "Per-origin authenticated rules for web_fetch: credentials, SSRF policy, and diagnostics.",
    );
  });
});
