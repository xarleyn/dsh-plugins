/**
 * The client's markup, as a browser and an assistive technology see it.
 *
 * Nothing else in the package renders the client: the bundle test replaces the
 * React creators with a no-op, so an element that lost its name, or a warning
 * that repeats a sentence already on screen, would reach a deployment unseen.
 * These cases hold the page's promises over both of its surfaces — the reader,
 * where every reading is named and "cannot compose" and "cannot read" are two
 * different sentences, and the roster screen, where whatever the controller
 * records has to be something the screen actually draws.
 */

// @vitest-environment jsdom

import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PersonaEditor } from "../src/client/PersonaEditor.js";
import {
  PersonaPage,
  type PersonaPageProps,
} from "../src/client/PersonaPage.js";
import { strings } from "../src/client/locale.js";
import { styles } from "../src/client/styles.js";
import {
  INITIAL_STATE,
  PersonaPageController,
  type PersonaPageSnapshot,
} from "../src/client/store.js";
import type { PersonaDocument } from "../src/types.js";
import { documentOf, faceOf, OK_CATALOG } from "./client-store.helpers.js";

afterEach(cleanup);

/** Elements that arrive with a user-agent margin the page has to reset. */
const BLOCK_ELEMENTS = ["p", "ul", "pre"];

/** The page state that shows one document in the open card. */
function stateOf(document: PersonaDocument): PersonaPageSnapshot {
  return {
    ...INITIAL_STATE,
    status: "ready",
    open: { id: "demo", status: "ready", error: "", document },
  };
}

/** Render the editor body over one document, as the card would. */
function show(document: PersonaDocument) {
  return render(
    createElement(PersonaEditor, {
      state: stateOf(document),
      controller: new PersonaPageController(faceOf()),
    }),
  );
}

/**
 * Render the roster screen over one controller.
 *
 * The settings shell's own props are runtime seats the page never reads, so
 * only the injected face is handed over.
 */
function showPage(controller: PersonaPageController) {
  return render(
    createElement(PersonaPage, { controller } as unknown as PersonaPageProps),
  );
}

/** One section of a composition, as the reader hands it to the page. */
function sectionOf(
  name: string,
  order: number,
  text: string,
): PersonaDocument["sections"][number] {
  return { name, order, text, enabled: true };
}

/** The text of a `<p>` the editor shows, or `null` when it shows none. */
function paragraph(container: HTMLElement, testId: string): string | null {
  const found = container.querySelector(`[data-testid="${testId}"]`);
  return found?.textContent ?? null;
}

/**
 * The paragraphs on screen carrying these words.
 *
 * A sentence is told once or the page contradicts itself, so the rule is about
 * the words rather than about a test id: a warning removed from the markup
 * leaves an id-based assertion unable to fail.
 */
function saying(container: HTMLElement, words: string): string[] {
  return [...container.querySelectorAll("p")]
    .map((element) => element.textContent ?? "")
    .filter((text) => text.includes(words));
}

/**
 * The name a control is tied to by `for`, and the description by
 * `aria-describedby`. Both are looked up by attribute rather than by selector
 * because the ids React mints contain colons.
 */
function ties(
  container: HTMLElement,
  control: Element,
): {
  label: string | null;
  description: string | null;
} {
  const id = control.getAttribute("id");
  let label: string | null = null;
  let description: string | null = null;
  for (const element of container.querySelectorAll("label[for], [id]")) {
    if (element.tagName === "LABEL") {
      if (element.getAttribute("for") === id) label = element.textContent;
      continue;
    }
    if (
      id !== null &&
      control.getAttribute("aria-describedby") === element.getAttribute("id")
    ) {
      description = element.textContent;
    }
  }
  return { label, description };
}

describe("the reader's markup", () => {
  it("names every reading with the label beside it", () => {
    const { container } = show(documentOf());
    expect(
      (
        screen.getByRole("textbox", {
          name: strings.prefixLabel,
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("Original prefix.");
    expect(
      screen.getByRole("textbox", { name: strings.suffixLabel }),
    ).toBeTruthy();
    expect(
      screen.getByRole("checkbox", { name: strings.completeLabel }),
    ).toBeTruthy();
    expect(
      screen.getByRole("checkbox", { name: strings.runtimeLabel }),
    ).toBeTruthy();
    // The rule, not the four cases above: every control the editor puts on
    // screen carries a label of its own, and the hint that explains it is a
    // description rather than part of its name.
    for (const control of [...container.querySelectorAll("input, textarea")]) {
      const { label, description } = ties(container, control);
      expect(label, "a control with no label tied to it").not.toBeNull();
      expect((label ?? "").trim()).not.toBe("");
      expect((description ?? "").trim().length > 0).toBe(
        control.getAttribute("aria-describedby") !== null,
      );
    }
    expect(
      ties(
        container,
        screen.getByRole("textbox", { name: strings.prefixLabel }),
      ).description,
    ).toBe(strings.prefixHint);
  });

  it("names the readings of the advanced area too", () => {
    const { container } = show(
      documentOf({
        sections: [
          {
            name: "preset:review",
            order: 100,
            text: "Read carefully.",
            enabled: true,
          },
        ],
        sectionsState: "local",
      }),
    );
    const controls = [...container.querySelectorAll("input, textarea")];
    expect(controls.length).toBeGreaterThan(4);
    for (const control of controls) {
      const { label } = ties(container, control);
      expect(label, "a control with no label tied to it").not.toBeNull();
      expect((label ?? "").trim()).not.toBe("");
    }
  });

  it("keeps two sections that share a name as two rows of their own", () => {
    // A composition edited by hand can declare two sections under one name: the
    // reader drops an empty name but keeps a duplicate. Keyed by the name alone,
    // the list would render with one key twice, and React answers that by
    // warning and dropping a row — so the second row would keep showing values
    // the preset no longer carries.
    const warning = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const first = documentOf({
        sections: [
          sectionOf("preset:review", 100, "Read carefully."),
          sectionOf("preset:review", 200, "Quote the line."),
        ],
        sectionsState: "local",
      });
      const view = show(first);
      expect(
        view.container.querySelectorAll('[data-testid="persona-section-row"]'),
      ).toHaveLength(2);
      expect(
        screen
          .getAllByTestId("persona-section-name")
          .map((input) => (input as HTMLInputElement).value),
      ).toEqual(["preset:review", "preset:review"]);
      expect(
        screen
          .getAllByTestId("persona-section-text")
          .map((area) => (area as HTMLTextAreaElement).value),
      ).toEqual(["Read carefully.", "Quote the line."]);
      view.rerender(
        createElement(PersonaEditor, {
          state: stateOf(
            documentOf({
              sections: [
                sectionOf("preset:review", 100, "Read carefully."),
                sectionOf("preset:review", 200, "Name the file."),
              ],
              sectionsState: "local",
            }),
          ),
          controller: new PersonaPageController(faceOf()),
        }),
      );
      expect(
        screen
          .getAllByTestId("persona-section-text")
          .map((area) => (area as HTMLTextAreaElement).value),
      ).toEqual(["Read carefully.", "Name the file."]);
      const words = warning.mock.calls
        .map((call) => String(call[0]))
        .join("\n");
      expect(words).not.toMatch(/same key/u);
    } finally {
      warning.mockRestore();
    }
  });

  it("says a broken preset cannot compose without denying its readings", () => {
    const { container } = show(documentOf({ broken: "the row names nothing" }));
    expect(paragraph(container, "persona-broken")).toContain(
      "the row names nothing",
    );
    expect(paragraph(container, "persona-read-error")).toBeNull();
    expect(
      (
        screen.getByRole("textbox", {
          name: strings.prefixLabel,
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("Original prefix.");
  });

  it("states one reason for a composition it cannot read", () => {
    const { container } = show(
      documentOf({
        readError: "agent-preset/not-found: Unknown agent preset: demo",
        source: "",
        rowCount: 0,
        hasRow: false,
      }),
    );
    expect(paragraph(container, "persona-read-error")).toContain(
      "Unknown agent preset: demo",
    );
    // The sentence belongs to this one paragraph. A second copy of it, or a
    // second warning saying the same thing, is the page contradicting itself.
    expect(saying(container, strings.unreadable)).toHaveLength(1);
    expect(
      container.querySelectorAll('[data-testid="persona-read-error"]'),
    ).toHaveLength(1);
  });

  it("keeps no warning at all for a preset it read cleanly", () => {
    const { container } = show(documentOf());
    expect(paragraph(container, "persona-read-error")).toBeNull();
    expect(paragraph(container, "persona-broken")).toBeNull();
    expect(saying(container, strings.unreadable)).toEqual([]);
    expect(saying(container, strings.brokenTitle)).toEqual([]);
  });

  it("resets the user-agent margin on every block it renders", () => {
    const { container } = show(
      documentOf({
        sections: [
          {
            name: "preset:review",
            order: 100,
            text: "Read carefully.",
            enabled: true,
          },
        ],
        sectionsState: "local",
      }),
    );
    // The page spaces its body with `gap`, so an element that keeps the margin
    // the user-agent gave it indents itself out of the rhythm. A modifier class
    // rides along with the base class beside it, which is where its reset lives.
    const resetsMargin = new Set(
      styles
        .split("\n")
        .filter((line) => line.startsWith(".") && line.includes("margin:0"))
        .map((line) => line.slice(0, line.indexOf("{"))),
    );
    const checked = new Set<string>();
    for (const tag of BLOCK_ELEMENTS) {
      for (const element of container.querySelectorAll(tag)) {
        const classes = [...element.classList];
        const key = `${tag} ${classes.sort().join(".")}`;
        if (classes.length === 0 || checked.has(key)) continue;
        checked.add(key);
        expect(
          classes.some((name) => resetsMargin.has(`.${name}`)),
          `<${tag} class="${classes.join(" ")}"> keeps a margin`,
        ).toBe(true);
      }
    }
    expect(checked.size).toBeGreaterThan(3);
  });
});

describe("the roster screen", () => {
  it("says a refresh failed over the roster it keeps on screen", async () => {
    const list = vi.fn().mockResolvedValue(OK_CATALOG);
    const controller = new PersonaPageController(faceOf({ list }));
    await controller.load();
    list.mockResolvedValue({
      ok: false as const,
      error: new RemoteError("gateway/internal", "boom", {}),
    });

    showPage(controller);
    // The controller records the refusal while `status` stays "ready", so this
    // screen — not the failed one — is where the words have to land. A roster
    // that refreshes into a message nobody renders is a stale list passing as
    // a fresh one.
    const notice = await screen.findByTestId("persona-notice");
    expect(notice.textContent).toBe(`${strings.loadFailed} boom`);
    expect(notice.classList.contains("preset-persona__error")).toBe(true);
    expect(screen.getAllByTestId("persona-preset-row")).toHaveLength(1);
  });
});
