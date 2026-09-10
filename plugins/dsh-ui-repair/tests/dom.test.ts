// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  collectRoots,
  DEFAULT_ROOT_SELECTOR,
  inferPlugin,
} from "../src/client/dom.js";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("plugin root discovery", () => {
  it("discovers common plugin metadata roots", () => {
    document.body.innerHTML = `
      <section data-plugin="legacy-plugin"></section>
      <section data-plugin-id="modern-plugin"></section>
      <section data-plugin-package="@example/scoped-plugin"></section>
    `;

    expect(
      collectRoots(document, DEFAULT_ROOT_SELECTOR).map((root) =>
        inferPlugin(root),
      ),
    ).toEqual(["legacy-plugin", "modern-plugin", "@example/scoped-plugin"]);
  });

  it("walks ancestors before falling back to an explicit repair root", () => {
    document.body.innerHTML = `
      <main data-plugin-package="@example/owner">
        <section data-dsh-ui-repair-root="fallback">
          <div id="target"></div>
        </section>
      </main>
    `;
    const root = document.querySelector(
      "[data-dsh-ui-repair-root]",
    ) as HTMLElement;

    expect(inferPlugin(root)).toBe("@example/owner");
  });

  it("excludes the repair card shell even while its body is closed", () => {
    document.body.innerHTML = `
      <ul data-slot="settings.plugin.item">
        <li id="repair-card"><span data-dsh-ui-repair-ui></span></li>
        <li id="other-card"></li>
      </ul>
    `;

    expect(
      collectRoots(document, DEFAULT_ROOT_SELECTOR).map(({ id }) => id),
    ).toEqual(["other-card"]);
  });
});
