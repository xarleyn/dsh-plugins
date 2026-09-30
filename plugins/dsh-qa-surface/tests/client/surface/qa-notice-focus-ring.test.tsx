// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  focusable,
  focusRing,
  isInert,
} from "../../../src/client/focus-ring.js";
import {
  applicationRoot,
  cleanupNoticeRingWorld,
  focused,
  mount,
  NOTICE_CONTROLS,
  pressTab,
  stackRoot,
  surfaceRoot,
  switchTheWidthOff,
  tabbables,
} from "../../helpers/notice-ring-world.js";

/**
 * Where the ring is drawn: the notice stack painted in `document.body` joined
 * the Tab ring of the surface, and a key given inside it is trapped by a handler
 * mounted on the stack itself — `<main>` is not its ancestor and never hears it.
 *
 * These cases walk the ring through the mounted surface with real key presses.
 * The stand is `tests/helpers/notice-ring-world.tsx`; what the enumeration and
 * the trap read off the markup with no surface under them is
 * `qa-focus-ring-markup.test.tsx`, and what a line's loss does to the keyboard
 * the reader stood on is `qa-notice-focus-restore.test.tsx`.
 */
afterEach(cleanupNoticeRingWorld);
describe("the notice stack inside the surface's Tab ring", () => {
  it("jumps the composer's hidden file picker on the way to the attach button", async () => {
    await mount();
    const picker = screen.getByTestId("qa-composer-file-input");
    const attach = screen.getByTestId("qa-composer-attach");
    const composer = screen.getByTestId("qa-composer-input");
    // The picker is opened by the attach button, so it is taken off the tab
    // order by hand — the one control of the page that is focusable by script
    // and no further by Tab.
    expect(picker.getAttribute("tabindex")).toBe("-1");
    expect(focusable(document.body)).not.toContain(picker);
    expect(focusable(document.body)).toContain(attach);

    // And the keyboard follows that read, because this stand walks production's
    // own list: the key given below the picker has to answer with the control
    // after it. An enumeration that kept the picker would step the test onto a
    // control no Tab reaches in a browser.
    composer.focus();
    pressTab();
    expect(focused()).toBe(attach);
  });

  it("carries Tab from the composer over every control of the stack", async () => {
    await mount();
    const composer = await screen.findByTestId("qa-composer-input");
    composer.focus();
    expect(document.activeElement).toBe(composer);

    const seen: string[] = [];
    for (let press = 0; press < 60; press++) {
      const { testid } = (document.activeElement as HTMLElement).dataset;
      if (testid !== undefined && NOTICE_CONTROLS.includes(testid))
        seen.push(testid);
      if (seen.length === NOTICE_CONTROLS.length) break;
      pressTab();
    }
    // The stack's controls, in the order the page lays them out: the line, its
    // cross, and the opt-in the reader has not answered yet.
    expect(seen).toEqual([...NOTICE_CONTROLS]);
  });

  it("keeps focus inside the QA interface at the edge of the stack", async () => {
    await mount();
    const offer = screen.getByTestId("qa-turn-notice-offer-action");
    offer.focus();

    // Past the stack's last button there is nothing of the reader's left to
    // reach, so the key is taken and turned back into the surface.
    expect(fireEvent.keyDown(offer, { key: "Tab" })).toBe(false);
    expect(surfaceRoot().contains(focused())).toBe(true);
  });

  it("walks Shift+Tab from the surface's first control back into the stack", async () => {
    await mount();
    const surface = surfaceRoot();
    const first = tabbables().find((element) => surface.contains(element));
    expect(first).toBeDefined();
    first?.focus();

    pressTab(true);
    expect(focused()).toBe(screen.getByTestId("qa-turn-notice-offer-action"));
  });

  it("keeps a control the width switched off from marking the edge of the ring", async () => {
    await mount({ withSessionList: true });
    const surface = surfaceRoot();
    // A wide panel starts its walk in the sidebar: the first control of
    // `qa-surface-root` is the chat list's own, and it is where Shift+Tab from
    // the header turns back.
    const wide = focusRing([surface]);
    const wideFront = wide[0];
    if (wideFront === undefined) throw new Error("the wide page holds no ring");
    expect(wideFront.closest(".dsh-qa-sidebar")).not.toBeNull();
    switchTheWidthOff();

    const ring = focusRing([surface, stackRoot()]);
    expect(
      ring.some((element) => element.closest(".dsh-qa-sidebar, .dsh-qa-rail")),
    ).toBe(false);
    const front = ring[0];
    const back = ring.at(-1);
    if (front === undefined || back === undefined)
      throw new Error("the narrow page holds no ring");
    expect(front).not.toBe(wideFront);

    // Shift+Tab at the front of what the width leaves: an edge still drawn at the
    // sidebar's control would answer no branch here, and the key would be the
    // browser's — which walks the reader out of the QA interface. That is what a
    // live Chromium does at 500px against the ring as it stood before this read.
    front.focus();
    expect(fireEvent.keyDown(front, { key: "Tab", shiftKey: true })).toBe(
      false,
    );
    expect(focused()).toBe(back);

    // The stack gone, and the ring ends inside the surface. Both the sidebar and
    // the rail carry no `hidden` for the enumeration to read — a media query took
    // them — so neither of them is allowed to be the last step of the way.
    fireEvent.click(screen.getByTestId("qa-turn-notice-dismiss"));
    expect(screen.queryByTestId("qa-turn-notice")).toBeNull();
    const bare = focusRing([surface]);
    const tail = bare.at(-1);
    if (tail === undefined) throw new Error("the surface holds no controls");
    expect(tail.closest(".dsh-qa-sidebar, .dsh-qa-rail")).toBeNull();
    tail.focus();
    expect(fireEvent.keyDown(tail, { key: "Tab" })).toBe(false);
    expect(focused()).toBe(bare[0]);
  });

  it("hands a key the ring does not answer to the dialog behind", async () => {
    await mount();
    const dismissed = vi.fn();
    window.addEventListener("keydown", dismissed);
    const dismiss = screen.getByTestId("qa-turn-notice-dismiss");
    dismiss.focus();

    // The ring answers Tab and nothing else: an Escape given here is the
    // reader's, and a dialog that listens on the window — `QaModal`, and the
    // settings dialog built on it — is what hears it.
    fireEvent.keyDown(dismiss, { key: "Escape" });
    expect(dismissed).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(dismiss);

    fireEvent.keyDown(dismiss, { key: "Tab" });
    expect(dismissed).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", dismissed);
  });

  it("leaves the keyboard to the gate that holds the page inert", async () => {
    await mount({ withWelcome: true });
    const surface = surfaceRoot();
    const stack = stackRoot();
    // The gate marks the element the application is mounted into, and the
    // surface stands under that mark while the stack, painted into
    // `document.body`, does not. The property is what the ring reads: a browser
    // reflects it into the attribute and jsdom reflects it into nothing, so a
    // test that set the attribute by hand would be describing a state the page
    // never reaches.
    expect(applicationRoot()?.inert).toBe(true);
    expect(isInert(surface)).toBe(true);

    // A control that cannot take focus is not a step of the ring: an edge that
    // pointed into the inert surface would aim `focus()` at a node that ignores
    // it, with the Tab already prevented — a key that sticks.
    expect(
      focusRing([surface, stack]).some((element) => surface.contains(element)),
    ).toBe(false);

    // The gate owns the page while it is up and traps the keys of its own
    // dialog. A second trap drawn over it would leave the reader with nowhere to
    // go but a stack of three buttons, so the ring lets this one through.
    const offer = screen.getByTestId("qa-turn-notice-offer-action");
    offer.focus();
    expect(fireEvent.keyDown(offer, { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(offer, { key: "Tab", shiftKey: true })).toBe(true);
  });

  it("keeps the onboarding dialog's own trap in charge", async () => {
    await mount({ withWelcome: true });
    const dialog = screen.getByTestId("qa-surface-welcome-panel");
    expect(dialog).toBeTruthy();
    screen.getByTestId("qa-surface-welcome-continue").focus();

    // The gate is a trap of its own, mounted beside the surface rather than
    // under it: however many times the reader presses Tab inside the dialog,
    // the surface's ring never hears the key and never pulls them out of it.
    for (let press = 0; press < 4; press++) pressTab();
    expect(dialog.contains(focused())).toBe(true);
  });

  it("leaves the stack out of the ring while a dialog of the surface is open", async () => {
    await mount({ withSessionList: true });
    fireEvent.click(screen.getByTestId("qa-surface-sidebar-version"));
    await screen.findByTestId("qa-surface-modal");
    const surface = surfaceRoot();
    const offer = screen.getByTestId("qa-turn-notice-offer-action");

    // `QaModal` marks nothing inert and traps no Tab of its own, so while it is
    // up the dialog is where the reader is and this ring does not own the
    // keyboard. The stack therefore answers nothing, in either direction — the
    // same answer it gave before the notices joined the ring at all. A key taken
    // here would turn the reader out of the dialog and onto a surface held under
    // the scrim.
    offer.focus();
    expect(fireEvent.keyDown(offer, { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(offer, { key: "Tab", shiftKey: true })).toBe(true);

    // And the surface's own edge no longer reaches into the stack either: the
    // last control of `<main>` turns back into `<main>`.
    const lastOfMain = focusable(surface).at(-1);
    if (lastOfMain === undefined) throw new Error("the surface holds nothing");
    lastOfMain.focus();
    expect(fireEvent.keyDown(lastOfMain, { key: "Tab" })).toBe(false);
    expect(surface.contains(focused())).toBe(true);
    expect(stackRoot().contains(focused())).toBe(false);

    // Escape given to a notice is the reader's: the stack lets it bubble, and
    // the dialog's own listener on the window is what hears it.
    offer.focus();
    fireEvent.keyDown(offer, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByTestId("qa-surface-modal")).toBeNull(),
    );

    // Gone, and the ring is drawn around the stack again.
    expect(fireEvent.keyDown(offer, { key: "Tab" })).toBe(false);
    expect(surfaceRoot().contains(focused())).toBe(true);
  });

  it("walks into the stack from the surface's edge while no dialog is up", async () => {
    await mount();
    const surface = surfaceRoot();
    const lastOfMain = focusable(surface).at(-1);
    if (lastOfMain === undefined) throw new Error("the surface holds nothing");
    lastOfMain.focus();

    // The same key the case above leaves alone: the ring's last step is the
    // stack's last button now, so the edge of `<main>` is a step of the way to
    // the notices rather than the end of the page.
    pressTab();
    expect(stackRoot().contains(focused())).toBe(true);
    expect(focused()).toBe(screen.getByTestId("qa-turn-notice-open"));
  });
});
