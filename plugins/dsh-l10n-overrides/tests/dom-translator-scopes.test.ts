// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { DomTranslationRule } from "../src/types.js";
import {
  createDiagnostics,
  createTranslator,
  flushMutations,
} from "./dom-translator.helpers.js";

describe("DomTranslator", () => {
  it("skips invalid scopes, supports global scope, and keeps the first duplicate tuple", () => {
    document.body.innerHTML = `
      <span id="global">Global source</span>
      <section class="scope">
        <span id="duplicate">Duplicate</span>
        <button id="duplicate-attribute" title="Duplicate"></button>
      </section>
    `;
    const diagnostics = createDiagnostics();
    const translator = createTranslator(
      [
        { source: "Broken", target: "Never", scope: "[broken" },
        { source: "Also broken", target: "Never", scope: "[broken" },
        { source: "Global source", target: "Global target", scope: "global" },
        {
          source: "Duplicate",
          target: "First",
          scope: ".scope",
          attributes: ["title"],
        },
        {
          source: "Duplicate",
          target: "Second",
          scope: ".scope",
          attributes: ["title"],
        },
      ],
      diagnostics,
    );

    expect(() => translator.setLocale("en")).not.toThrow();

    expect(document.querySelector("#global")?.textContent).toBe(
      "Global target",
    );
    expect(document.querySelector("#duplicate")?.textContent).toBe("First");
    expect(
      document.querySelector("#duplicate-attribute")?.getAttribute("title"),
    ).toBe("First");
    expect(
      diagnostics.snapshot().filter(({ code }) => code === "invalid_dom_scope"),
    ).toHaveLength(1);
  });

  it("rejects escaped selectors without translating attributes or feeding mutations back", async () => {
    document.body.innerHTML = `
      <span id="feedback" title="Enviar">Enviar</span>
    `;
    const feedback = document.querySelector("#feedback") as Element;
    const setAttribute = vi.spyOn(feedback, "setAttribute");
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    const diagnostics = createDiagnostics();
    const translator = createTranslator(
      [
        {
          source: "Enviar",
          target: "Send",
          scope: String.raw`[t\itle="Enviar"]`,
          attributes: ["title"],
        },
      ],
      diagnostics,
    );

    translator.setLocale("en");
    for (let turn = 0; turn < 10; turn += 1) await flushMutations();

    expect(feedback.textContent).toBe("Enviar");
    expect(feedback.getAttribute("title")).toBe("Enviar");
    expect(
      setAttribute.mock.calls.filter(([attribute]) => attribute === "title"),
    ).toHaveLength(0);
    expect(
      diagnostics.snapshot().filter(({ code }) => code === "invalid_dom_scope"),
    ).toHaveLength(1);
    expect(observe).not.toHaveBeenCalled();
  });

  it("rejects namespace and comment attribute-selector bypasses before browser parsing", async () => {
    document.body.innerHTML = `
      <span id="feedback" title="Enviar">Enviar</span>
    `;
    const unsupportedScopes = [
      '[*|title="Enviar"]',
      '[|title="Enviar"]',
      '[title/**/="Enviar"]',
      '[/**/title="Enviar"]',
    ];
    const feedback = document.querySelector("#feedback") as Element;
    const setAttribute = vi.spyOn(feedback, "setAttribute");
    const querySelector = vi.spyOn(DocumentFragment.prototype, "querySelector");
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    const diagnostics = createDiagnostics();
    const rules: DomTranslationRule[] = unsupportedScopes.map((scope) => ({
      source: "Enviar",
      target: "Send",
      scope,
      attributes: ["title"],
    }));
    const translator = createTranslator(rules, diagnostics);

    translator.setLocale("en");
    for (let turn = 0; turn < 10; turn += 1) await flushMutations();

    expect(feedback.textContent).toBe("Enviar");
    expect(feedback.getAttribute("title")).toBe("Enviar");
    expect(
      setAttribute.mock.calls.filter(([attribute]) => attribute === "title"),
    ).toHaveLength(0);
    expect(
      diagnostics.snapshot().filter(({ code }) => code === "invalid_dom_scope"),
    ).toHaveLength(unsupportedScopes.length);
    expect(querySelector).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();
  });

  it.each([
    {
      scope: "[title]",
      markup: '<span title="present">Enviar</span>',
      dependency: "title",
    },
    {
      scope: '[title="x"]',
      markup: '<span title="x">Enviar</span>',
      dependency: "title",
    },
    {
      scope: "[title=x]",
      markup: '<span title="x">Enviar</span>',
      dependency: "title",
    },
    {
      scope: '[title="X" i]',
      markup: '<span title="x">Enviar</span>',
      dependency: "title",
    },
    {
      scope: '[lang|="en"]',
      markup: '<span lang="en-US">Enviar</span>',
      dependency: "lang",
    },
    {
      scope: '[class~="token"]',
      markup: '<span class="other token">Enviar</span>',
      dependency: "class",
    },
    {
      scope: '[data-x^="a"]',
      markup: '<span data-x="amz">Enviar</span>',
      dependency: "data-x",
    },
    {
      scope: '[data-x$="z"]',
      markup: '<span data-x="amz">Enviar</span>',
      dependency: "data-x",
    },
    {
      scope: '[data-x*="m"]',
      markup: '<span data-x="amz">Enviar</span>',
      dependency: "data-x",
    },
    {
      scope: '[data-x="space and ] bracket"]',
      markup: '<span data-x="space and ] bracket">Enviar</span>',
      dependency: "data-x",
    },
  ])(
    "supports basic attribute scope $scope with an exact dependency",
    ({ scope, markup, dependency }) => {
      document.body.innerHTML = markup;
      const observe = vi.spyOn(MutationObserver.prototype, "observe");
      const translator = createTranslator([
        { source: "Enviar", target: "Send", scope },
      ]);
      const expectedFilter = [
        "class",
        "id",
        "contenteditable",
        "data-no-translate",
        "data-message-id",
        "data-testid",
      ];
      if (!expectedFilter.includes(dependency)) expectedFilter.push(dependency);

      translator.setLocale("en");

      expect(document.body.textContent).toBe("Send");
      expect(observe).toHaveBeenLastCalledWith(
        document.body,
        expect.objectContaining({ attributeFilter: expectedFilter }),
      );
    },
  );

  it.each([
    ["relational pseudo", ".wrapper:has([data-active])"],
    ["descendant combinator", ".ancestor .plugin"],
    ["child combinator", ".a > .b"],
    ["adjacent sibling combinator", ".a + .b"],
    ["general sibling combinator", ".a ~ .b"],
    ["selector list", ".a,.b"],
    ["negation pseudo", ".a:not(.b)"],
  ])("rejects unsupported %s scopes", (_kind, scope) => {
    document.body.innerHTML = `
      <section class="wrapper"><span data-active>Enviar</span></section>
      <section class="ancestor"><span class="plugin">Enviar</span></section>
      <section class="a"><span class="b">Enviar</span></section>
      <span class="a"></span><span class="b">Enviar</span>
      <span class="a">Enviar</span>
    `;
    const diagnostics = createDiagnostics();
    const translator = createTranslator(
      [{ source: "Enviar", target: "Send", scope }],
      diagnostics,
    );

    translator.setLocale("en");

    expect(document.body.textContent).not.toContain("Send");
    expect(
      diagnostics.snapshot().filter(({ code }) => code === "invalid_dom_scope"),
    ).toHaveLength(1);
  });
});
