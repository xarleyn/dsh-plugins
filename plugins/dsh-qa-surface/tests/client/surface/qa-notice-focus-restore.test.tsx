// @vitest-environment jsdom

import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { focusRing } from "../../../src/client/focus-ring.js";
import {
  BACKGROUNDS,
  cleanupNoticeRingWorld,
  controlOf,
  currentConfig,
  focused,
  focusedLine,
  line,
  lines,
  mount,
  pressEnter,
  publishConfig,
  settleTurns,
  stackRoot,
  surfaceRoot,
  tabbables,
} from "../../helpers/notice-ring-world.js";

/**
 * Where the keyboard goes when a notice leaves the stack: waving a line off, a
 * fourth turn pushing the oldest out of a full stack, and the desktop opt-in
 * answering itself away all take the focused control out of the page while the
 * stack stays on screen. The ring remembers the line the reader stood on and
 * hands them to the one that took its place, on the same control of it.
 *
 * The stand is `tests/helpers/notice-ring-world.tsx`; the ring's own edges are
 * `qa-notice-focus-ring.test.tsx` and `qa-focus-ring-markup.test.tsx`.
 */
afterEach(cleanupNoticeRingWorld);
describe("the reader left standing when a notice goes away", () => {
  it("keeps the focus on the line that took a dismissed one's place", async () => {
    await mount({ settled: BACKGROUNDS.slice(0, 3) });
    expect(lines()).toHaveLength(3);
    const dismiss = controlOf(line(1), "qa-turn-notice-dismiss");
    dismiss.focus();

    fireEvent.click(dismiss);
    // Waving one line off three leaves the stack standing and the focused cross
    // out of the page: the count of lines never reaches zero, yet the next Tab
    // would have been answered by the browser's own order.
    expect(lines()).toHaveLength(2);
    expect(focusedLine()).toBe(line(1));
  });

  it("keeps the focus in the stack when a fourth line pushes the oldest out", async () => {
    const world = await mount({
      chats: BACKGROUNDS,
      settled: BACKGROUNDS.slice(0, 3),
    });
    const oldest = line(-1);
    const dismiss = controlOf(oldest, "qa-turn-notice-dismiss");
    dismiss.focus();

    // The stack holds three lines and drops what it cannot show, so a fourth
    // turn changes nothing about its length: the line the reader stood on is
    // gone all the same, and a check on the number of lines would never notice.
    settleTurns(world, [BACKGROUNDS[3]]);
    expect(lines()).toHaveLength(3);
    expect(focusedLine()).toBe(line(-1));
    expect(focusedLine()).not.toBe(oldest);
  });

  it("keeps the focus on the oldest line when a batch of turns lands on it", async () => {
    const world = await mount({
      chats: BACKGROUNDS,
      settled: BACKGROUNDS.slice(0, 2),
    });
    expect(lines()).toHaveLength(2);
    const oldest = line(-1);
    const dismiss = controlOf(oldest, "qa-turn-notice-dismiss");
    dismiss.focus();

    // Two turns settle in one tick: the stack puts both in front of what the
    // reader can see and, capped at three lines, lets go of the line they stand
    // on. A place counted along the ring slides by exactly the controls the
    // batch brought and hands the keyboard to one of the fresh lines; what the
    // reader lost is the last line, and the last line is whichever one is left
    // standing last.
    settleTurns(world, BACKGROUNDS.slice(2));
    expect(lines()).toHaveLength(3);
    expect(focusedLine()).toBe(line(-1));
    expect(focusedLine()).not.toBe(oldest);
    // The same control of it: a cross given back as a cross.
    expect(focused().dataset.testid).toBe("qa-turn-notice-dismiss");
  });

  it("keeps the focus in the stack when the opt-in answers itself away", async () => {
    await mount();
    const offer = screen.getByTestId("qa-turn-notice-offer-action");
    offer.focus();

    // The offer is a single question per browser, so answering the permission
    // prompt takes its button out while the lines stay: the opt-in — the control
    // this card was raised over — is the one that leaves the page under focus.
    fireEvent.click(offer);
    await waitFor(() =>
      expect(screen.queryByTestId("qa-turn-notice-offer-action")).toBeNull(),
    );
    expect(stackRoot()).toBeTruthy();
    expect(focusedLine()).toBe(line(-1));
    // And on its first control, not its last: the offer is not a line, so the
    // place read for it is the front of the line the stack keeps last. The last
    // control is the cross, which would answer the second Enter — the reader
    // aimed it at the opt-in, not at a notice.
    expect(focused().dataset.testid).toBe("qa-turn-notice-open");
  });

  it("leaves a control of neither a line nor the offer without a guessed place", async () => {
    await mount({ settled: BACKGROUNDS.slice(0, 2) });
    const stack = stackRoot();
    // The next block the stack may grow — a heading, a «скрыть все» — is not the
    // desktop opt-in. Read as the opt-in it anchors to the last line, and its
    // loss hands the reader to a line they never stood on; read as what it is,
    // the ring keeps no place for it and the keyboard stays where the reader has
    // it. The opt-in is named by its own block for exactly that reason.
    const foreign = document.createElement("button");
    foreign.type = "button";
    foreign.dataset.testid = "qa-turn-notice-all";
    stack.append(foreign);
    foreign.focus();

    foreign.remove();
    fireEvent.click(controlOf(line(0), "qa-turn-notice-dismiss"));
    expect(focusedLine()).toBeNull();
  });

  it("keeps the focus on a control of the surface when the stack goes away", async () => {
    await mount();
    const dismiss = screen.getByTestId("qa-turn-notice-dismiss");
    dismiss.focus();
    // The place is remembered as focus lands on the stack's control, not as the
    // reader proves they work it by keyboard — and a Tab given here is nowhere
    // near the edge of the ring, so the focus stays exactly where it was.
    fireEvent.keyDown(dismiss, { key: "Tab" });
    expect(document.activeElement).toBe(dismiss);

    fireEvent.click(dismiss);
    expect(screen.queryByTestId("qa-turn-notice")).toBeNull();
    const surface = surfaceRoot();
    expect(surface.contains(focused())).toBe(true);
    // Back into the interface, and onto a control of it rather than onto the
    // surface itself: from a focused root the reader has to press Tab again
    // before the page answers, and the place they were working is lost twice.
    expect(focused()).not.toBe(surface);
    expect(tabbables().some((element) => element === focused())).toBe(true);
  });

  it("gives a lost stack back to a control that takes the keyboard", async () => {
    await mount();
    const dismiss = screen.getByTestId("qa-turn-notice-dismiss");
    dismiss.focus();

    // The hand-off goes back into the interface at the control the ring reaches
    // last — and that is the one place a media query can switch off without a
    // word in the markup the enumeration could read (`.dsh-qa-rail` at ≤900px).
    // jsdom applies no CSS, so the stand switches the edge off by hand: an edge
    // that answers `focus()` by moving nothing has to send the keyboard on, not
    // leave the reader on a control that is no longer on the page.
    const main = surfaceRoot();
    const edge = focusRing([main]).at(-1);
    if (edge === undefined) throw new Error("the surface holds no controls");
    edge.focus = () => {};

    fireEvent.click(dismiss);
    expect(screen.queryByTestId("qa-turn-notice")).toBeNull();
    expect(focused()).not.toBe(edge);
    expect(focused()).not.toBe(main);
    expect(focusRing([main])).toContain(focused());
    expect(focused()).toBe(focusRing([main]).at(-2));
  });

  it("leaves the focus alone when a control of the surface goes away under it", async () => {
    await mount();
    const header = screen.getByTestId("qa-surface-header-files");
    // A control that already holds the focus gives no focusin when it is asked
    // for one, so the keyboard is put elsewhere first and walked onto the header
    // — the only way this case says anything about the place it lands on.
    screen.getByTestId("qa-composer-input").focus();
    header.focus();

    // The deployment turned the header off, which is how a control of `<main>`
    // leaves the page under the reader: the surface itself re-renders over the
    // loss, so a ring that remembered this place would be able to answer it.
    const config = currentConfig();
    if (config === undefined) throw new Error("the surface is not mounted");
    act(() =>
      publishConfig({ ...config, ui: { ...config.ui, showHeader: false } }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("qa-surface-header")).toBeNull(),
    );

    // The same shape of loss — a focused control out of the page and nothing
    // focused after it — read from the surface rather than from the notices. A
    // row of the queue dock, a transcript action taken back by its message, a
    // rebuilt chat: the surface decides where its reader goes after any of those,
    // and a step handed back from the ring would be a rule this card never
    // promised. What the ring remembers is a step of the notice stack only.
    expect(focused()).toBe(document.body);
  });

  it("leaves the focus where the reader put it when a line goes after they left the stack", async () => {
    await mount({ settled: BACKGROUNDS.slice(0, 3) });
    const dismiss = controlOf(line(1), "qa-turn-notice-dismiss");
    dismiss.focus();

    // The reader moves on to work inside the interface. That step is what gives
    // the place back: the ring remembers a stack the reader is standing in, and
    // a control of `<main>` that holds the focus is nobody's to pull out of it.
    const composer = screen.getByTestId("qa-composer-input");
    composer.focus();
    fireEvent.click(dismiss);

    expect(lines()).toHaveLength(2);
    expect(focused()).toBe(composer);
  });

  it("leaves the keyboard of a blurred page alone and hands the place back when the window returns", async () => {
    const world = await mount({
      chats: BACKGROUNDS,
      settled: BACKGROUNDS.slice(0, 3),
    });
    const oldest = line(-1);
    const dismiss = controlOf(oldest, "qa-turn-notice-dismiss");
    dismiss.focus();

    // The reader works in another window, where turns keep settling and a full
    // stack still lets the oldest line go. A page nobody is looking at is not
    // given a keyboard: `focus()` would move it inside this page while the
    // reader is typing somewhere else.
    document.hasFocus = () => false;
    settleTurns(world, [BACKGROUNDS[3]]);

    expect(lines()).toHaveLength(3);
    expect(focused()).toBe(document.body);
    expect(focusedLine()).toBeNull();

    // The place was remembered rather than dropped, so the window coming back is
    // what pays the hand-over: the reader's first Tab is the interface's, not the
    // browser's, and it starts where they stood — on the same control of the line
    // that took the lost one's place. A page back on screen answers
    // `document.hasFocus()` with true, and that is the state the event brings.
    document.hasFocus = () => true;
    fireEvent.focus(window);
    expect(focusedLine()).toBe(line(-1));
    expect(focusedLine()).not.toBe(oldest);
    expect(focused().dataset.testid).toBe("qa-turn-notice-dismiss");
  });

  it("leaves a blurred hand-over to the reader who comes back into the interface", async () => {
    const world = await mount({
      chats: BACKGROUNDS,
      settled: BACKGROUNDS.slice(0, 3),
    });
    const dismiss = controlOf(line(-1), "qa-turn-notice-dismiss");
    dismiss.focus();
    document.hasFocus = () => false;
    settleTurns(world, [BACKGROUNDS[3]]);

    // Returning to the tab and clicking into the composer is the reader stating
    // where they stand: the place the ring remembers is a stack the reader is
    // standing in, so it is given up the moment focus reaches `<main>` and the
    // window coming back has nothing owed to it.
    const composer = screen.getByTestId("qa-composer-input");
    composer.focus();
    document.hasFocus = () => true;
    fireEvent.focus(window);

    expect(focused()).toBe(composer);
  });
});

describe("a notice that opens the chat it names", () => {
  /** The chat the sidebar marks active, which is what the surface is showing. */
  function activeChat(): string {
    const row = screen
      .getAllByTestId("qa-surface-sidebar-item-open")
      .find((node) => node.getAttribute("aria-current") === "true");
    return row?.textContent ?? "";
  }

  /**
   * The chat a line names, read from the line's own title rather than from which
   * index of the stack it sits at: a fresh turn is put in front of the lines the
   * reader can see, so an index says nothing on its own.
   */
  function chatNamed(item: HTMLElement): string {
    const name = item.querySelector<HTMLElement>(
      ".dsh-qa-turn-notice__chat",
    )?.textContent;
    if (name === undefined) throw new Error("the line names no chat");
    return name;
  }

  it("keeps the reader on the stack when a notice opens the chat it names", async () => {
    await mount({
      withSessionList: true,
      chats: BACKGROUNDS,
      settled: BACKGROUNDS.slice(0, 3),
    });
    expect(lines()).toHaveLength(3);
    const open = controlOf(line(1), "qa-turn-notice-open");
    const named = chatNamed(line(1));
    open.focus();

    // Opening is the one way a line leaves the stack that also changes what the
    // surface shows: the notice goes and its chat arrives underneath it. The
    // keyboard does not follow the chat — a chat that has just been asked for is
    // still being bound, and its composer is no control a browser can stop on
    // yet — so the ring hands the reader to the line the stack keeps next to the
    // one that went, on the same control of it. Wherever the reader then presses
    // Tab, the answer is the interface's, not the browser's.
    fireEvent.click(open);
    await waitFor(() => expect(activeChat()).toContain(named));

    expect(lines()).toHaveLength(2);
    expect(focusedLine()).toBe(line(1));
    expect(focused().dataset.testid).toBe("qa-turn-notice-open");
  });

  it("keeps the reader on the stack when an Enter opens the chat a notice names", async () => {
    await mount({
      withSessionList: true,
      chats: BACKGROUNDS,
      settled: BACKGROUNDS.slice(0, 3),
    });
    const open = controlOf(line(2), "qa-turn-notice-open");
    const named = chatNamed(line(2));
    open.focus();

    // Reached by keyboard, answered the same way: the ring takes Tab and nothing
    // else, so the Enter the reader gives a notice is theirs and reaches the
    // button under it — and the chat it names opens the same way the pointer
    // opens it, with the keyboard left on the stack.
    expect(pressEnter(open)).toBe(true);
    await waitFor(() => expect(activeChat()).toContain(named));

    expect(lines()).toHaveLength(2);
    expect(focusedLine()).toBe(line(1));
    expect(focused().dataset.testid).toBe("qa-turn-notice-open");
  });
});
