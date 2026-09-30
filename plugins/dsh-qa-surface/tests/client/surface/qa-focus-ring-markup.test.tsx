// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeyboardEvent } from "react";
import {
  focusRing,
  focusable,
  trapKeys,
} from "../../../src/client/focus-ring.js";

/**
 * What the ring counts as a step, read off the markup with no surface mounted
 * under it.
 *
 * These are the two promises the enumeration and the trap make to the reader: a
 * control the page has taken off the Tab path is not a step of the ring, and a
 * step the ring hands the keyboard to is a control that takes it. The mounted
 * cases in `qa-notice-focus-ring.test.tsx` walk the same list through a real
 * surface; here the markup and the sheet are what is under test, because what
 * `focusable` reads — `tabindex`, `hidden`, `inert`, a closed fold, a container
 * the layout switched off — is decided without one.
 */
afterEach(cleanup);

/**
 * A page at a narrow width, shaped the way the surface is shaped: a sidebar at
 * the front of the path, a chat rail near its end, and the notice stack painted
 * after `<main>`.
 *
 * The two rules are the ones the surface ships — `.dsh-qa-sidebar` yields to the
 * conversation at ≤600px and `.dsh-qa-rail` goes away at ≤900px (`styles.ts`).
 * They are written here bare, without the media query around them, because
 * jsdom resolves a rule that stands on a class and applies no media query at
 * all: the declarations and the selectors are production's, the width is what
 * the reader is assumed to have.
 */
function renderANarrowWidth(): {
  main: HTMLElement;
  stack: HTMLElement;
  at: (testid: string) => HTMLElement;
} {
  const { container } = render(
    <>
      <style data-phantom-sheet>{`
        .dsh-qa-sidebar{display:none}
        .dsh-qa-rail{display:none}
      `}</style>
      <main data-testid="main">
        <div className="dsh-qa-sidebar">
          <button type="button" data-testid="new-chat" />
        </div>
        <button type="button" data-testid="header-action" />
        <textarea data-testid="composer" />
        <div className="dsh-qa-rail">
          <button type="button" data-testid="turn-mark" />
        </div>
      </main>
      <div data-testid="notice-stack">
        <button type="button" data-testid="notice-open" />
      </div>
    </>,
  );
  const at = (testid: string): HTMLElement => {
    const element = container.querySelector<HTMLElement>(
      `[data-testid='${testid}']`,
    );
    if (element === null) throw new Error(`${testid} is not mounted`);
    return element;
  };
  return { main: at("main"), stack: at("notice-stack"), at };
}

/** The key the reader gives the page, as the trap sees it. */
function tabKey(shift: boolean): KeyboardEvent<HTMLElement> & {
  preventDefault: ReturnType<typeof vi.fn>;
} {
  return {
    key: "Tab",
    shiftKey: shift,
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent<HTMLElement> & {
    preventDefault: ReturnType<typeof vi.fn>;
  };
}

describe("the Tab path the ring reads off the markup", () => {
  it("leaves off the path what a browser leaves off: a negative `tabindex`, a hidden parent", () => {
    const { container } = render(
      <div>
        {/* What makes these unreachable is the `-1`, and a browser reads it
            before it asks what element the `-1` stands on. */}
        <button type="button" tabIndex={-1} data-testid="off-path-button" />
        <input type="file" tabIndex={-1} data-testid="off-path-input" />
        <pre tabIndex={-1} data-testid="off-path-pre" />
        <button type="button" hidden data-testid="hidden-button" />
        {/* A panel body the surface keeps mounted and hides rather than unmounts:
            the browser takes its controls off the path along with it. */}
        <div hidden>
          <button type="button" data-testid="under-a-hidden-parent" />
        </div>
        <button type="button" disabled data-testid="disabled-button" />
        {/* A `select` and a `summary` are what the surface itself paints inside
            `<main>` — the role picker of the header and the fold of a message —
            and a browser gives both a place on the path. */}
        <select data-testid="picker">
          <option value="a">А</option>
        </select>
        <select disabled data-testid="disabled-picker">
          <option value="a">А</option>
        </select>
        <details>
          <summary data-testid="fold" />
        </details>
        <div tabIndex={0} data-testid="listed" />
      </div>,
    );

    expect(
      focusable(container).map((element) => element.dataset.testid),
    ).toEqual(["picker", "fold", "listed"]);
  });

  it("takes no key when the ring holds no controls", () => {
    const { container } = render(
      <div tabIndex={0} data-testid="hollow-ring">
        <button type="button" hidden />
      </div>,
    );
    const root = container.querySelector<HTMLElement>(
      "[data-testid='hollow-ring']",
    );
    if (root === null) throw new Error("the ring is not mounted");
    const event = {
      key: "Tab",
      shiftKey: false,
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent<HTMLElement>;

    // A Tab prevented with no control to hand the focus to is a stuck key. What
    // the root itself is asked to do stays the browser's: a ring with nothing in
    // it has no interface to keep the reader inside of, so it answers nothing.
    trapKeys(event, [root]);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("counts the header's role picker as a step the ring walks over", () => {
    // What the chat header paints once the account offers more than one
    // profile: a `select` (role/RoleSelector) and the fold of a message
    // (`summary`). A browser stops on both, so an enumeration that left them out
    // drew the edge of the ring past a control the reader reaches — and counted
    // the walk over a page with one step fewer than it has.
    const { container } = render(
      <main>
        <label>
          Роль ассистента
          <select data-testid="role-picker">
            <option value="general">Общий</option>
            <option value="reviewer">Ревьюер</option>
          </select>
        </label>
        <details>
          <summary data-testid="message-fold">Инструменты разговора</summary>
          <p>…</p>
        </details>
      </main>,
    );

    expect(
      focusRing([container.querySelector("main")]).map(
        (element) => element.dataset.testid,
      ),
    ).toEqual(["role-picker", "message-fold"]);
  });

  it("keeps a closed fold's own handle on the path and its body off it", () => {
    const { container } = render(
      <main>
        {/* A system notice of the transcript, the way `QaMessage` paints one: the
            reader has not opened it, and what hides under the fold is rendered
            markdown — which paints its source chips as buttons. A browser gives
            the reader no Tab step into a block they have not opened. */}
        <details>
          <summary data-testid="closed-fold">Служебное сообщение</summary>
          <button type="button" data-testid="chip-under-closed-fold">
            Источник
          </button>
        </details>
        <details open>
          <summary data-testid="open-fold">Инструменты разговора</summary>
          <button type="button" data-testid="chip-in-open-fold">
            Источник
          </button>
        </details>
      </main>,
    );

    expect(
      focusRing([container.querySelector("main")]).map(
        (element) => element.dataset.testid,
      ),
    ).toEqual(["closed-fold", "open-fold", "chip-in-open-fold"]);
  });

  it("walks past the edge of the ring that cannot take the keyboard", () => {
    const { container } = render(
      <main>
        <button type="button" data-testid="switched-off" />
        <button type="button" data-testid="next-control" />
        <button type="button" data-testid="back-edge" />
      </main>,
    );
    const at = (id: string): HTMLElement => {
      const element = container.querySelector<HTMLElement>(
        `[data-testid='${id}']`,
      );
      if (element === null) throw new Error(`${id} is not mounted`);
      return element;
    };
    // What a browser does to a control the page has switched off in a media
    // query rather than in the markup: `.dsh-qa-rail` at ≤900px and
    // `.dsh-qa-sidebar` at ≤600px are two of them, and the front of the ring is
    // the sidebar. A test reads the layout through the sheet that switches a
    // control off — the case above this one — and a stand at a wide panel has no
    // such control to trip over, so this one paints the refusal itself: what the
    // hand-off owes a control that answers `focus()` by moving nothing.
    const switchedOff = at("switched-off");
    switchedOff.focus = () => {};
    expect(focusRing([container.querySelector("main")])).toEqual([
      switchedOff,
      at("next-control"),
      at("back-edge"),
    ]);

    // Tab at the back edge asks for the front of the ring, and the front is the
    // control that refuses: prevented and left there, the key is one the reader
    // pressed with nothing to show for it. The ring answers at the next control
    // of the way instead.
    const event = {
      key: "Tab",
      shiftKey: false,
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent<HTMLElement>;
    at("back-edge").focus();
    trapKeys(event, [container.querySelector("main")]);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(at("next-control"));
  });

  it("keeps a control the layout switched off out of the path the ring walks", () => {
    const { main, stack } = renderANarrowWidth();

    // What the media query leaves the reader is the path the ring has to draw on:
    // the sidebar's button and the rail's mark answer no Tab at this width, and a
    // list that still counts them puts its edges on controls nobody stands on.
    expect(
      focusRing([main, stack]).map((element) => element.dataset.testid),
    ).toEqual(["header-action", "composer", "notice-open"]);
    expect(focusable(main).map((element) => element.dataset.testid)).toEqual([
      "header-action",
      "composer",
    ]);
  });

  it("catches Shift+Tab at the front the width leaves, not at a switched-off control", () => {
    const { main, stack, at } = renderANarrowWidth();
    const front = at("header-action");
    front.focus();

    // The reader stands on the first control this width leaves them and asks for
    // what comes before it. Were the edge the sidebar's button, this key would
    // belong to no branch of the trap and would walk them out of the interface —
    // the browser's own order has nothing before a hidden container.
    const event = tabKey(true);
    trapKeys(event, [main, stack]);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(at("notice-open"));
  });

  it("turns Tab back at the last control the width leaves, with no notice to end on", () => {
    const { main, at } = renderANarrowWidth();
    const back = at("composer");
    back.focus();

    // The stack is empty, so the ring ends inside `<main>` — and what the page
    // paints last there is the rail's mark, which this width switched off. The
    // key given at the composer is the ring's, and it comes back to the front of
    // the path rather than leaving for the browser chrome.
    const event = tabKey(false);
    trapKeys(event, [main]);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(at("header-action"));
  });
});
