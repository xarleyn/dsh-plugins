// @vitest-environment jsdom
/**
 * The settings card: the body the Plugins page mounts, and the comparison
 * section it edits.
 *
 * The card is the only place an operator meets the comparison configuration, so
 * the paths it writes are the contract between the browser and the resolver. A
 * typo here would be invisible to every other test in this package: the schema
 * would accept the value, and nothing would read it.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { DocumentsConfig } from "../src/documents/config.js";
import { resolveDocumentsConfig } from "../src/documents/config.js";
import { DocumentsCard } from "../src/client/card.js";
import { styles } from "../src/client/styles.js";

const CONFIG = resolveDocumentsConfig({}) as unknown as DocumentsConfig;

interface Mutation {
  readonly op: string;
  readonly path: readonly string[];
  readonly value?: unknown;
}

/**
 * A stand for the live `ConfigForm` the card edits.
 *
 * The Plugins page hands a `plugins.row.config` registrant a `form` of its own —
 * the Host's `ConfigPageForm`, `{ state, mutate }` only — and the card's form
 * arrives beside it under `settingsForm`, so this stand is passed under that name.
 * `fences`, when given, collects the revision each write arrived fenced with.
 */
function makeForm(
  mutations: Mutation[],
  writable = true,
  fences?: (number | undefined)[],
) {
  const snapshot = {
    status: "ready" as const,
    value: CONFIG,
    base: undefined,
    user: {},
    revision: 1,
    writable,
    mode: "host" as const,
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    mutate: (ops: readonly Mutation[], expectedRevision?: number) => {
      mutations.push(...ops);
      fences?.push(expectedRevision);
      return Promise.resolve(true);
    },
    set: () => Promise.resolve(true),
    unset: () => Promise.resolve(true),
  };
}

/**
 * Render the card the way the row page mounts it: as the body, expanded by the
 * page rather than by a control of its own.
 */
function renderCard(
  mutations: Mutation[],
  writable = true,
  fences?: (number | undefined)[],
) {
  return render(
    <DocumentsCard
      {...({} as never)}
      settingsForm={makeForm(mutations, writable, fences) as never}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("the comparison section", () => {
  it("is part of the card, under its own heading", () => {
    renderCard([]);
    expect(screen.getByText("Сравнение редакций")).toBeDefined();
    expect(
      screen.getByText("Детерминированное сравнение документов"),
    ).toBeDefined();
  });

  it("says which tools the feature registers", () => {
    renderCard([]);
    const facts = screen.getByText(/document_compare/u);
    expect(facts.textContent).toContain("document_diff_read");
  });

  it("writes the namespace paths the resolver reads", () => {
    const mutations: Mutation[] = [];
    renderCard(mutations);

    fireEvent.click(
      screen.getByLabelText(/Детерминированное сравнение документов/u),
    );
    fireEvent.change(screen.getByLabelText(/Режим по умолчанию/u), {
      target: { value: "default" },
    });
    fireEvent.change(screen.getByLabelText(/Максимум изменений/u), {
      target: { value: "1234" },
    });

    expect(mutations).toEqual([
      { op: "set", path: ["comparison", "enabled"], value: false },
      { op: "set", path: ["comparison", "defaultMode"], value: "default" },
      { op: "set", path: ["comparison", "maxChanges"], value: 1234 },
    ]);
  });

  it("renders every comparison control read-only while the scope is not writable", () => {
    renderCard([], false);
    // A read-only scope is answered with disabled controls rather than with
    // writes the Host would refuse: the toggle, the mode and the budgets all
    // come back as unavailable.
    for (const label of [
      /Детерминированное сравнение документов/u,
      /Режим по умолчанию/u,
      /Максимум изменений/u,
      /Предел времени/u,
    ]) {
      const control = screen.getByLabelText(label) as HTMLInputElement;
      expect(control.disabled).toBe(true);
    }
  });

  it("does not normalise meaning away in the wording it shows", () => {
    renderCard([]);
    expect(
      screen.getByText(/Числа, проценты, валюты, даты и отрицания/u),
    ).toBeDefined();
  });
});

describe("the body the Plugins page mounts", () => {
  // The page draws the card surface, the row title, the row id and the
  // description line, and only then mounts this view under its configuration
  // section, so a frame of our own here is the second card the contract forbids.
  it("mounts its controls straight away, under no card of our own", () => {
    const { container } = renderCard([]);
    expect(container.querySelector("li")).toBeNull();
    expect(container.querySelector("ul")).toBeNull();
    expect(container.querySelector('[class*="dsh-plugin-card"]')).toBeNull();
    // No disclosure of ours: the page owns the chevron and the open state, so the
    // body is there from the first render rather than behind a click.
    expect(container.querySelectorAll("svg")).toHaveLength(0);
    expect(screen.queryByRole("button", { expanded: false })).toBeNull();
    expect(screen.getByTestId("docs-pipeline-enabled")).toBeDefined();
    expect(screen.getByTestId("docs-templates-max-pages")).toBeDefined();
  });

  it("rings every control it draws with the Host's tokens and both fallbacks", () => {
    // The Host's `focus.css` suppresses a hard-coded outline under pointer
    // modality (0-3-2 against a plain class rule's 0-2-0), and a token that is
    // not declared on the surface invalidates the whole `outline` shorthand. So
    // each ring names both tokens, each with its fallback length or colour.
    const rings = [...styles.matchAll(/[^{}]+:focus-visible\{[^}]*\}/gu)].map(
      ([rule]) => rule,
    );
    // A text/number/select field, a switch and a button: the controls this
    // package renders itself, not the ones the page draws around them.
    expect(rings.length).toBeGreaterThanOrEqual(3);
    for (const rule of rings) {
      const outline = /outline:([^;}]+)/u.exec(rule)?.[1] ?? "";
      expect(/--dsw-focus-ring-width\s*,\s*\S+/u.test(outline)).toBe(true);
      expect(/--dsw-focus-ring-color\s*,\s*\S+/u.test(outline)).toBe(true);
    }
  });

  it("fences every write with the revision the form reports", () => {
    const fences: (number | undefined)[] = [];
    renderCard([], true, fences);
    // The switch is reached by its hook: what this asserts is the fence on the
    // write, so a reworded caption must not blind the test.
    fireEvent.click(screen.getByTestId("docs-pipeline-enabled"));
    // Every write carries the revision the form reports, read at write time: a
    // document another browser moved in between is refused instead of overwritten.
    expect(fences).toEqual([1]);
  });
});
