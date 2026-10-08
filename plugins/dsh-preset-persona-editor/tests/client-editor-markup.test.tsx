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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
import type { PersonaCatalog, PersonaDocument } from "../src/types.js";
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

/**
 * A preset the registry cannot activate, shaped the way the installed
 * `0.1.7-rc.2` class shapes it: `diagnostic()` joins its failed and pending rows
 * with `\n`, each row reads `<entry id> (<plugin name>): <detail>`, and the
 * detail is `mountDetail()`, which nests a cause under `- ` with `\n  `
 * continuations.
 */
const REFUSED_TREE = [
  "persona (@deepseek-ai/dsh-persona): the row refused to mount",
  "- @yadsh/demo-pack: no such module on disk",
  "  the cause the pack wrapped",
  "tool-bash (@deepseek-ai/dsh-tool-bash): waiting for sandbox",
].join("\n");

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

  it("keeps every reading reachable, and none of them editable", () => {
    const { container } = show(
      documentOf({
        persona: {
          prefix: "Original prefix.",
          suffix: "",
          complete: true,
          includeRuntimeContext: false,
        },
        sections: [sectionOf("preset:review", 100, "Read carefully.")],
        sectionsState: "local",
      }),
    );
    const controls = [...container.querySelectorAll("input, textarea")];
    expect(controls.length).toBeGreaterThan(4);
    for (const control of controls) {
      // A `disabled` control leaves the tab order, so a keyboard reader steps
      // over the value it carries and never learns it exists.
      expect(
        control.hasAttribute("disabled"),
        `a control no keyboard reader reaches: ${control.getAttribute("id")}`,
      ).toBe(false);
      // What says "reading" instead: `readonly` for the text a browser will not
      // let be typed into, and `aria-disabled` for the checkbox the page pinned.
      // `readOnly` is not the second one — it names a rule for the controls that
      // take text, and a browser enforces it on a checkbox by nothing.
      expect(
        control.hasAttribute("readonly") ||
          control.getAttribute("aria-disabled") === "true",
        `a reading that does not say it is one: ${control.getAttribute("id")}`,
      ).toBe(true);
    }
  });

  it("holds a clicked checkbox at the value the composition carries", () => {
    show(
      documentOf({
        persona: {
          prefix: "Original prefix.",
          suffix: "",
          complete: true,
          includeRuntimeContext: false,
        },
      }),
    );
    // The page's answer to a click has to be the composition's answer, for both
    // values and in both directions — a control that only *looks* pinned has a
    // state the reader then believes wrongly.
    const complete = screen.getByRole("checkbox", {
      name: strings.completeLabel,
    }) as HTMLInputElement;
    const runtime = screen.getByRole("checkbox", {
      name: strings.runtimeLabel,
    }) as HTMLInputElement;
    fireEvent.click(complete);
    fireEvent.click(runtime);
    expect(complete.checked).toBe(true);
    expect(runtime.checked).toBe(false);
  });

  it("states a refused composition with the breaks the host wrote it with", () => {
    const { container } = show(documentOf({ broken: REFUSED_TREE }));
    const stated = paragraph(container, "persona-broken");
    // Every line of the tree, not just the first: the card header is the place
    // that can carry one line, and this is the place that carries them all.
    expect(stated).toBe(`${strings.brokenTitle}: ${REFUSED_TREE}`);
    // And the structure the letters arrived in. A paragraph that collapses them
    // answers the question in the right words and the wrong shape: the tree is
    // what tells a nested cause from a second failure of the same row.
    const rule = styles
      .split("\n")
      .find((line) => line.startsWith(".preset-persona__error{"));
    expect(rule).toContain("white-space:pre-line");
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
  /**
   * The roster screen showing one preset the registry refused with `broken`,
   * and answering the same way every time it is asked.
   */
  function alwaysRefusing(broken: string): PersonaPageController {
    const catalog: PersonaCatalog = {
      presets: [
        {
          id: "demo",
          name: "Demo",
          description: "",
          isDefault: true,
          broken,
          persona: "unreadable",
          complete: false,
        },
      ],
    };
    return new PersonaPageController(
      faceOf({
        list: vi.fn(async () => ({ ok: true as const, value: catalog })),
      }),
    );
  }

  /**
   * A controller holding a roster already on screen, whose next refresh is
   * refused — the state `list()` fails into when there is a list to keep.
   */
  async function refusedRefresh(): Promise<PersonaPageController> {
    const list = vi.fn().mockResolvedValue(OK_CATALOG);
    const controller = new PersonaPageController(faceOf({ list }));
    await controller.load();
    list.mockResolvedValue({
      ok: false as const,
      error: new RemoteError("gateway/internal", "boom", {}),
    });
    return controller;
  }

  it("keeps a card header to the line the shell has room for", async () => {
    const { container } = showPage(alwaysRefusing(REFUSED_TREE));
    await screen.findByTestId("persona-roster");
    const description = container.querySelector(
      ".dsh-plugin-card__description",
    );
    // The registry's own first line, which is the part that names the row that
    // refused: the header is not this page's to re-word.
    expect(description?.textContent).toContain(
      REFUSED_TREE.split("\n")[0] ?? "",
    );
    // And one line, because that is all the shell gives a card — the breaks of
    // the rest would render as spaces here however the text were assembled. The
    // whole tree arrives in the opened card, in the paragraph that keeps them.
    expect(description?.textContent).not.toContain("\n");
    expect(screen.getByTestId("persona-preset-badge").textContent).toBe(
      strings.badgeBroken,
    );
  });

  it("gives the row's text the break the badge would otherwise be painted on", async () => {
    // The shell shrinks the head-text column beside a badge that never wraps, and
    // hands it no break of its own: a name or description carrying a token with no
    // break opportunity — a preset id, a module name — runs on past the column and
    // under the badge. Measured in a browser at 390px, one such line painted 121px
    // out of a 266px column and crossed the badge's own rect; the shell is not this
    // page's to change, so the roster carries the break.
    const rule = styles
      .split("\n")
      .find((line) => line.startsWith(".preset-persona__list{"));
    expect(rule).toContain("overflow-wrap:break-word");

    // The row reads that break as an inherited value, so the guard is the
    // relation, not the declaration alone: text that left the element this rule is
    // written on would keep the file green and paint under the badge again.
    showPage(new PersonaPageController(faceOf()));
    await screen.findByTestId("persona-roster");
    const text = document.querySelector(
      ".preset-persona__list .dsh-plugin-card__description",
    );
    expect(text?.textContent).toBe(strings.describedDefault);
  });

  it("re-reads the roster from the screen that shows it", async () => {
    const refused: PersonaCatalog = {
      presets: [
        {
          id: "demo",
          name: "Demo",
          description: "",
          isDefault: true,
          broken: "persona (@deepseek-ai/dsh-persona): waiting for sandbox",
          persona: "unreadable",
          complete: false,
        },
      ],
    };
    const list = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, value: refused })
      .mockResolvedValueOnce(OK_CATALOG);
    showPage(new PersonaPageController(faceOf({ list })));
    await screen.findByText(strings.badgeBroken);
    // A row waiting on a service that has not mounted yet becomes healthy by
    // itself, so the page that read it once holds a fact the deployment has
    // already outgrown. The reader's Reload re-reads the open preset only; this
    // is the control that asks the roster again.
    fireEvent.click(screen.getByRole("button", { name: strings.reloadRoster }));
    expect(await screen.findByText(strings.badgeCustom)).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("answers a refused retry with the refusal again, not with silence", async () => {
    const list = vi.fn().mockResolvedValue(OK_CATALOG);
    const controller = new PersonaPageController(faceOf({ list }));
    await controller.load();
    list.mockResolvedValue({
      ok: false as const,
      error: new RemoteError("gateway/internal", "boom", {}),
    });
    showPage(controller);
    await screen.findByTestId("persona-notice");
    fireEvent.click(screen.getByRole("button", { name: strings.reloadRoster }));
    // `refresh()` puts the notice down before it asks, because what the message
    // carries is "these rows are stale" and a fresh answer settles that. A fresh
    // answer that fails has to put a refusal back rather than leave the screen
    // quiet over the rows it did not manage to replace.
    const notice = await screen.findByTestId("persona-notice");
    expect(notice.textContent).toContain(`${strings.loadFailed} boom`);
    expect(screen.getAllByTestId("persona-preset-row")).toHaveLength(1);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it("says a refresh failed over the roster it keeps on screen", async () => {
    showPage(await refusedRefresh());
    // The controller records the refusal while `status` stays "ready", so this
    // screen — not the failed one — is where the words have to land. A roster
    // that refreshes into a message nobody renders is a stale list passing as
    // a fresh one.
    const notice = await screen.findByTestId("persona-notice");
    expect(notice.textContent).toContain(`${strings.loadFailed} boom`);
    expect(notice.classList.contains("preset-persona__error")).toBe(true);
    expect(screen.getAllByTestId("persona-preset-row")).toHaveLength(1);
  });

  it("lets the user put the refusal down without losing the rows", async () => {
    showPage(await refusedRefresh());
    await screen.findByTestId("persona-notice");
    // `dismissNotice` is on the controller, and a method only its own test
    // reaches is a notice the screen cannot be rid of: opening a preset was the
    // only way out. Pressed by name, so an unbound handler is a failure here
    // rather than a console error a user would meet first.
    fireEvent.click(screen.getByRole("button", { name: strings.dismiss }));
    expect(screen.queryByTestId("persona-notice")).toBeNull();
    expect(screen.getAllByTestId("persona-preset-row")).toHaveLength(1);
  });
});
