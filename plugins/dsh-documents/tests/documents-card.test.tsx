// @vitest-environment jsdom
/**
 * The settings card: the shell contract, and the comparison section it edits.
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

const CONFIG = resolveDocumentsConfig({}) as unknown as DocumentsConfig;

interface Mutation {
  readonly op: string;
  readonly path: readonly string[];
  readonly value?: unknown;
}

/**
 * A stand for the Host-owned `ConfigForm` the settings tab hands the card.
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
 * Render the card and open it. The shell renders its body only while open, so
 * every assertion about a control happens after this.
 */
function renderCard(
  mutations: Mutation[],
  writable = true,
  fences?: (number | undefined)[],
) {
  const rendered = render(
    <DocumentsCard
      {...({} as never)}
      form={makeForm(mutations, writable, fences) as never}
    />,
  );
  fireEvent.click(screen.getByRole("button", { expanded: false }));
  return rendered;
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

describe("the Plugins tab surface", () => {
  it("stacks its shell inside a list the plugin owns", () => {
    renderCard([]);
    const card = screen
      .getByRole("button", { expanded: true })
      .closest("li") as HTMLLIElement | null;
    expect(card?.className).toContain("dsh-plugin-card");
    // The tab renders no list of its own, and AGENTS.md keeps the `<li>` shell
    // root inside a list the plugin declares.
    expect(card?.parentElement?.tagName).toBe("UL");
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
