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

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  section,
  settle,
} from "./qa-settings-card.helpers.js";

/*
 * The row's one-liner as the host reads it: the installed manifest's
 * `description`, which fills the page's paragraph before this seat is ever asked.
 * Read rather than repeated, because a manifest edit has nothing to fail in a test
 * that quotes the same words. Resolved through `fileURLToPath` because the jsdom
 * environment replaces the global `URL`, and Node's `readFileSync` only
 * recognises its own.
 */
const MANIFEST_DESCRIPTION = (
  JSON.parse(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        "..",
        "package.json",
      ),
      "utf8",
    ),
  ) as { description?: string }
).description;

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
  it("answers the summary view with the row's one-liner and no markup", async () => {
    const summary = await renderEntry("summary");
    /*
     * The line is the row's description: plain text the page drops into its own
     * paragraph — no body, no element, and no second poll of the Remote. The host
     * fills that paragraph from the manifest and asks this seat only for a row that
     * declares none, so the two answers must be one sentence (§4.2 of
     * `docs/DSH-0.1.7-MIGRATION.md`).
     */
    expect(summary.container.textContent).toBe(MANIFEST_DESCRIPTION);
    expect(summary.container.firstElementChild).toBeNull();
    expect(summary.polls).toBe(0);

    const page = await renderEntry("page");
    // The page view is the one that carries controls, and it is the same entry.
    expect(page.container.firstElementChild?.className).toBe("qa-card-body");
    expect(page.polls).toBeGreaterThan(0);
  });

  it("mounts the card when the seat passes no view", async () => {
    // An entry the page renders without asking for a view is the page, not an
    // empty column: the form surface is the default and the one-liner the opt-in.
    const entry = await renderEntry();
    expect(entry.container.firstElementChild?.className).toBe("qa-card-body");
  });

  it("writes through its own form while the seat holds a `form` of its own", async () => {
    const entry = await renderEntry("page");
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
