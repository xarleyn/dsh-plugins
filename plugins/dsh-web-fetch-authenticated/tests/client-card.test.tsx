// @vitest-environment jsdom
/**
 * What the Plugins page draws from this bundle's row seat.
 *
 * `client-registration.test.ts` pins what `apply()` hands the slot — the key, the
 * face, the prop names — and cannot see the markup. Every way the move can fail
 * quietly lives in that markup: the entry answering markup where the page wanted a
 * line of text, a frame of our own drawn inside the page's card, the body mounting
 * over a form that never reached it, an edit whose write never reaches that form,
 * and a write landing in the page's own `{ state, mutate }` view instead of the
 * `ConfigForm` that stores it. This package shipped without a DOM-rendering test on
 * purpose (epic #453 addressed the card from a browser instead); the seat made that
 * gap load-bearing.
 *
 * The page owns the chrome — the surface, the row title, the row id, the
 * description line and the expansion of the section — so the `page` view is the
 * configuration body and it is mounted with no click of ours (AGENTS.md).
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
import { styles } from "../src/client/styles.js";
import {
  demoConfig,
  demoStatus,
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

/** The Host's ring, with a fallback on each half of the pair. */
const HOST_RING =
  "outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))";

/** Every control class the sheet draws itself, rather than inheriting from the page. */
const OWN_CONTROLS = [
  ".wfa-control",
  ".wfa-btn",
  ".wfa-icon-btn",
  ".wfa-toggle",
  ".wfa-advanced summary",
];

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
  it("mounts the live configuration body with no frame of its own", async () => {
    const seat = await registeredSeat();
    const { container } = await renderSeat(seat, "page");

    // The page's card is the only frame here: no shell class, no `<li>` root, and
    // no expand control of ours — the page expands the section it seated us in.
    expect(container.querySelector('[class*="dsh-plugin-card"]')).toBeNull();
    expect(container.querySelector("li")).toBeNull();
    expect(container.querySelector("button[aria-expanded]")).toBeNull();
    expect(container.firstElementChild?.tagName).toBe("DIV");

    // Mounted straight away, and live: the rule the stand form carries is what
    // proves the configuration reached the body without a click of ours.
    expect(await screen.findByTestId("wfa-rules-list")).toBeTruthy();
    expect(screen.getByTestId("wfa-rule-row").textContent).toContain(
      "Demo product",
    );

    /*
     * The page's chrome gives the row's title and id but not its enablement, so
     * the body still answers that — in the status section the shell's header
     * badge used to duplicate. Which of the two stand sources feeds the pill is
     * the next case's question, not this one's.
     */
    const status = await screen.findByTestId("wfa-status-section");
    expect(status.textContent).toContain("1 rule(s), 1 enabled");
  });

  it("takes the enabled pill from the provider report, not from the saved setting", async () => {
    /*
     * The header badge this shell dropped read `config.enabled` and flipped in the
     * same click. The pill in the status section reads the provider's own report
     * (`sections/status.tsx:37-40`), which the card only learns from the polled
     * `status()` call — nothing refreshes it after a write, and
     * `startVisibilityAwarePolling` skips ticks under `hidden`. So between a write
     * and the next report the two disagree, and a stand that set both to the same
     * value could not tell which one the pill follows. Here the setting says
     * enabled and the report says otherwise.
     */
    const seat = await registeredSeat(
      demoConfig(),
      "ready",
      true,
      demoStatus({ enabled: false }),
    );
    await renderSeat(seat, "page");
    await screen.findByTestId("wfa-global-section");

    expect(screen.getByTestId("wfa-status-enabled-state").textContent).toBe(
      "Disabled",
    );
    // The Global switch is the setting, and it says the opposite.
    expect(
      (screen.getByTestId("wfa-global-provider-enabled") as HTMLInputElement)
        .checked,
    ).toBe(true);
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

  it("leaves the row's title and description line to the page", async () => {
    /*
     * The page prints this package's manifest `description` above the body, and the
     * entry's summary answer is the same sentence for a row whose metadata carries
     * none — so one assertion here covers both: neither the line the page draws nor
     * the line the seat would fall back to is repeated inside the body, which is
     * what a heading inside the Host's card amounts to.
     */
    const seat = await registeredSeat();
    const page = await renderSeat(seat, "page");

    expect(page.container.textContent).not.toContain(rowDescription);
    expect(await screen.findByTestId("wfa-rules-list")).toBeTruthy();
  });

  it("says why the body is empty while the Host configuration is unavailable", async () => {
    /*
     * The panel answers from a browser the settings directory is not served to, so
     * this state is normal here rather than an error. The page owns the frame, and
     * a card that owns its shell may stay invisible; this one drawing nothing would
     * leave the opened row with a blank section and no reason, which reads as a
     * broken card. So the seat answers the state with a sentence and no controls.
     */
    const seat = await registeredSeat(demoConfig(), "unavailable");
    const { container } = await renderSeat(seat, "page");

    const note = screen.getByTestId("wfa-card-unavailable");
    expect(note.textContent).toContain("not available in this session");
    expect(note.textContent).toContain("read or changed");
    expect(
      container.querySelectorAll("button, input, textarea, select"),
    ).toHaveLength(0);
    expect(screen.queryByTestId("wfa-rules-list")).toBeNull();
  });

  it("keeps the body and disables its writes while the namespace is read-only", async () => {
    /*
     * The other half of the seat's availability story: a row page the Host does
     * serve, for a Config it will not let this browser edit. AGENTS.md asks for
     * disabled controls rather than a hidden card, so the operator still reads
     * the rules and the policy, and the refusal is what the toggle shows.
     */
    const seat = await registeredSeat(demoConfig(), "ready", false);
    const { container } = await renderSeat(seat, "page");
    await screen.findByTestId("wfa-global-section");

    expect(container.textContent).not.toBe("");
    const toggle = screen.getByTestId(
      "wfa-global-provider-enabled",
    ) as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
    expect(
      (screen.getByTestId("wfa-global-audit-enabled") as HTMLInputElement)
        .disabled,
    ).toBe(true);
  });

  it("answers the summary view with the row's own line, as text and no second body", async () => {
    /*
     * The view the page asks for when a row's metadata carries no description
     * (`PluginManagerPage.tsx:491`); for this row the manifest supplies one, so this
     * answer is the fallback. It is held to the same sentence on purpose: a row with
     * two descriptions shows whichever one the reader's metadata happens to carry,
     * and an edit of `package.json` alone would quietly leave both. Compared against
     * the manifest rather than against a literal here, so moving one half without the
     * other is a red test rather than a visible surprise.
     *
     * Either way it lands inside the page's own paragraph, so it stays text —
     * mounting the body here would open a live settings store and poll the Remote a
     * second time for a line of prose.
     */
    const seat = await registeredSeat();
    const { container } = await renderSeat(seat, "summary");

    expect(container.textContent).toBe(rowDescription);
    expect(container.querySelector("[data-testid]")).toBeNull();
  });

  it.each(OWN_CONTROLS)(
    "dresses the ring of %s from the Host's tokens",
    (control) => {
      /*
       * The Host's `focus.css` dresses its own elements, not the ones a plugin
       * renders inside its section, and under pointer modality it beats a rule of
       * ours that hard-codes the outline (0-3-2 against 0-2-0). Raising
       * specificity is the wrong repair: each control this sheet draws takes the
       * Host's tokens, with a fallback on both halves — where
       * `--dsw-focus-ring-width` is undeclared the whole `outline` shorthand is
       * invalid and the ring disappears rather than degrading. `verifyHostChrome`
       * reads the same rule off the built bundle; this pins that no control was
       * left out of the selector list.
       */
      const ringRule = styles
        .split("\n")
        .find((line) => line.includes(HOST_RING));
      expect(ringRule).toBeTruthy();
      expect(ringRule).toContain(`${control}:focus-visible`);
    },
  );
});
