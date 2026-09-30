// @vitest-environment jsdom
/**
 * What the Plugins page draws from this bundle's row seat.
 *
 * `client-registration.test.ts` pins what `apply()` hands the slot — the key, the
 * face, the prop names — and cannot see the markup. Every way the move can fail
 * quietly lives in that markup: the entry answering `null` where the page asked
 * for the row's sentence, the shell's `<li>` losing the `<ul>` AGENTS.md styles it
 * against, the body mounting over a form that never reached it, and the card
 * header repeating the sentence the page already printed one line above. This
 * package shipped without a DOM-rendering test on purpose (epic #453 addressed the
 * card from a browser instead); the seat made that gap load-bearing.
 */

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
     * `<div>` (`lib/client.js:1852`). Nothing but a rendered card notices the
     * wrapper going away.
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

  it("draws no card while the Host configuration is unavailable", async () => {
    const seat = await registeredSeat(demoConfig(), "unavailable");
    const { container } = await renderSeat(seat, "page");

    expect(container.querySelector(".dsh-plugin-card")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("answers the summary view with the row's sentence and no second card", async () => {
    const seat = await registeredSeat();
    const { container } = await renderSeat(seat, "summary");

    expect(container.querySelector(".dsh-plugin-card")).toBeNull();
    expect(container.textContent).toBe(
      "Per-origin authenticated rules for web_fetch: credentials, SSRF policy, and diagnostics.",
    );
  });

  it("keeps the row's description and the card's own copy distinct", async () => {
    /*
     * The page prints this entry's summary view as the row's description line
     * (`lib/client.js:1841`), one paragraph above the card the same entry draws, so
     * a header repeating that sentence shows it twice on one screen.
     */
    const seat = await registeredSeat();
    const summary = await renderSeat(seat, "summary");
    const page = await renderSeat(seat, "page");

    const cardDescription = page.container.querySelector(
      ".dsh-plugin-card__description",
    );
    expect(cardDescription?.textContent).toBeTruthy();
    expect(cardDescription?.textContent).not.toBe(
      summary.container.textContent,
    );
  });
});
