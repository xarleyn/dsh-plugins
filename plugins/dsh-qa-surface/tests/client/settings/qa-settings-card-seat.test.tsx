// @vitest-environment jsdom
/**
 * The two views the Plugins page seats this entry in, and the owner props the
 * seat spreads over the injected face.
 *
 * Both halves are parts of the move a type check cannot protect. The row's
 * one-liner has to stay a sentence: a card seated in the middle of a line draws
 * a page within a line and polls the `describe` Remote a second time. And the
 * page hands its registrant a `form` of its own *after* the injected face, so a
 * face prop called `form` would be replaced there by `{ state, mutate }` — a
 * shape with nothing to subscribe to — in the operator's browser rather than in
 * a test.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/react";

import {
  EFFECTIVE,
  Entry,
  makeForm,
  openCard,
  section,
  settle,
} from "./qa-settings-card.helpers.js";

/** One recorded call of a stub, as the assertions below read it. */
type Spy = ReturnType<typeof vi.fn>;

interface SeatRender {
  readonly container: HTMLElement;
  /** The write the card's own namespace form took. */
  readonly cardMutate: Spy;
  /** The write the page's seat would have taken, had the card used it. */
  readonly seatMutate: Spy;
  /** The `qaSurface/describe` polls the render performed. */
  readonly polls: number;
}

/**
 * Renders the registered entry the way the seat does — the injected face first,
 * then its own owner props — for the view the page asks for, or for none.
 */
async function renderEntry(view?: "summary" | "page"): Promise<SeatRender> {
  const { form, mutate: cardMutate } = makeForm();
  const describe = vi.fn(async () => ({ ok: true as const, value: EFFECTIVE }));
  const seat = {
    state: { status: "ready", value: {}, revision: 99, writable: true },
    mutate: vi.fn(async () => undefined),
  };
  let result: ReturnType<typeof render> | undefined;
  // The card polls once on mount; keeping that answer inside act holds the
  // update in the test instead of after its assertions.
  await act(async () => {
    result = render(
      <Entry
        {...{ settingsForm: form, describe }}
        form={seat}
        {...(view === undefined ? {} : { view })}
      />,
    );
    await Promise.resolve();
  });
  return {
    container: (result as ReturnType<typeof render>).container,
    cardMutate,
    seatMutate: seat.mutate,
    polls: describe.mock.calls.length,
  };
}

afterEach(async () => {
  await settle();
  cleanup();
});

describe("QA Surface row seat", () => {
  it("answers the summary view with the row's one-liner, not a second card", async () => {
    const page = await renderEntry("page");
    const header =
      page.container.querySelector(".dsh-plugin-card__description")
        ?.textContent ?? "";
    expect(header).not.toBe("");
    cleanup();

    const summary = await renderEntry("summary");
    // The line carries exactly the sentence the card header carries, and nothing
    // more: no shell, no list around it, and no poll of the Remote.
    expect(summary.container.textContent).toBe(header);
    expect(summary.container.querySelector("li.dsh-plugin-card")).toBeNull();
    expect(summary.container.querySelector("ul")).toBeNull();
    expect(summary.polls).toBe(0);
  });

  it("mounts the card when the seat passes no view", async () => {
    // An entry the page renders without asking for a view is the page, not an
    // empty column: the form surface is the default and the one-liner the opt-in.
    const entry = await renderEntry();
    expect(entry.container.querySelector("li.dsh-plugin-card")).not.toBeNull();
  });

  it("writes through its own form while the seat holds a `form` of its own", async () => {
    const entry = await renderEntry("page");
    expect(entry.container.querySelector("li.dsh-plugin-card")).not.toBeNull();

    openCard();
    fireEvent.click(
      within(section("qa-settings-access")).getByRole("checkbox", {
        name: /Страница включена/u,
      }),
    );
    await settle();
    // The card's namespace form took the write; the page's bulk-only seat stayed
    // untouched, exactly as the face's `settingsForm` name intends.
    expect(entry.cardMutate).toHaveBeenCalledWith([
      { op: "set", path: ["enabled"], value: false },
    ]);
    expect(entry.seatMutate).not.toHaveBeenCalled();
  });
});
