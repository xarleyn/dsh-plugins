// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { Diagnostics } from "../src/registry/diagnostics.js";
import { DomTranslator } from "../src/runtime/dom-translator.js";
import type { DomTranslationRule } from "../src/types.js";

function createDiagnostics(): Diagnostics {
  return new Diagnostics({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  });
}

const translators = new Set<DomTranslator>();

function createTranslator(
  rules: readonly DomTranslationRule[],
  diagnostics = createDiagnostics(),
): DomTranslator {
  const translator = new DomTranslator(document, rules, diagnostics);
  translators.add(translator);
  return translator;
}

afterEach(() => {
  for (const translator of translators) translator.dispose();
  translators.clear();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function flushMutations(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("DomTranslator", () => {
  it("translates only exact scoped text while preserving surrounding whitespace", () => {
    document.body.innerHTML = `
      <section class="composer">
        <span id="exact">  Enviar\n</span>
        <span id="sentence">Enviar ahora</span>
      </section>
      <span id="outside">Enviar</span>
    `;
    const translator = createTranslator([
      { source: "Enviar", target: "Send", scope: ".composer" },
    ]);

    translator.setLocale("en");

    expect(document.querySelector("#exact")?.textContent).toBe("  Send\n");
    expect(document.querySelector("#sentence")?.textContent).toBe(
      "Enviar ahora",
    );
    expect(document.querySelector("#outside")?.textContent).toBe("Enviar");
  });

  it("never translates text in protected native or DSH surfaces", () => {
    document.body.innerHTML = `
      <main class="scope">
        <input id="input" value="Enviar">
        <textarea id="textarea">Enviar</textarea>
        <pre id="pre">Enviar</pre>
        <code id="code">Enviar</code>
        <kbd id="kbd">Enviar</kbd>
        <samp id="samp">Enviar</samp>
        <script id="script" type="text/plain">Enviar</script>
        <style id="style">Enviar</style>
        <div id="editable" contenteditable>Enviar</div>
        <div id="no-translate" data-no-translate>Enviar</div>
        <div id="conversation" data-testid="conversation-panel">Enviar</div>
        <div id="message" data-message-id="message-1">Enviar</div>
        <div id="markdown" class="markdown-body">Enviar</div>
        <div id="editor" data-testid="monaco-editor">Enviar</div>
        <div id="terminal" class="terminal-output">Enviar</div>
        <div id="prompt" data-testid="prompt-input">Enviar</div>
        <div id="composer" data-testid="chat-composer">Enviar</div>
        <div data-no-translate><span id="protected-child">Enviar</span></div>
        <span id="allowed">Enviar</span>
      </main>
      <div data-testid="conversation-panel">
        <section class="nested-scope"><span id="protected-scope">Enviar</span></section>
      </div>
    `;
    const translator = createTranslator([
      { source: "Enviar", target: "Send", scope: ".scope" },
      { source: "Enviar", target: "Send", scope: ".nested-scope" },
    ]);

    translator.setLocale("en");

    for (const id of [
      "textarea",
      "pre",
      "code",
      "kbd",
      "samp",
      "script",
      "style",
      "editable",
      "no-translate",
      "conversation",
      "message",
      "markdown",
      "editor",
      "terminal",
      "prompt",
      "composer",
      "protected-child",
      "protected-scope",
    ]) {
      expect(document.querySelector(`#${id}`)?.textContent, id).toBe("Enviar");
    }
    expect((document.querySelector("#input") as HTMLInputElement).value).toBe(
      "Enviar",
    );
    expect(document.querySelector("#allowed")?.textContent).toBe("Send");
  });

  it("translates only explicitly listed safe attributes in scope", () => {
    document.body.innerHTML = `
      <section class="scope">
        <input id="input" placeholder="Escribe" value="Escribe">
        <textarea id="safe-textarea" placeholder="Escribe">Escribe</textarea>
        <button id="title" title="Escribe" aria-label="Escribe">Button</button>
        <img id="image" alt="Escribe" src="Escribe">
        <div id="forbidden" data-label="Escribe" class="Escribe" title="Other"></div>
        <a data-key="forbidden-all" id="Escribe" class="Escribe" href="Escribe" src="Escribe" value="Escribe" data-extra="Escribe"></a>
        <div id="unlisted" title="Solo"></div>
        <input id="protected-input" data-no-translate placeholder="Escribe">
        <div data-testid="monaco-editor"><span id="protected-title" title="Escribe"></span></div>
      </section>
    `;
    const translator = createTranslator([
      {
        source: "Escribe",
        target: "Type here",
        scope: ".scope",
        attributes: ["placeholder", "title", "aria-label", "alt"],
      },
      {
        source: "Solo",
        target: "Alone",
        scope: ".scope",
        attributes: ["placeholder"],
      },
    ]);

    translator.setLocale("en");

    expect(document.querySelector("#input")?.getAttribute("placeholder")).toBe(
      "Type here",
    );
    expect(document.querySelector("#title")?.getAttribute("title")).toBe(
      "Type here",
    );
    expect(
      document.querySelector("#safe-textarea")?.getAttribute("placeholder"),
    ).toBe("Type here");
    expect(document.querySelector("#safe-textarea")?.textContent).toBe(
      "Escribe",
    );
    expect(document.querySelector("#title")?.getAttribute("aria-label")).toBe(
      "Type here",
    );
    expect(document.querySelector("#image")?.getAttribute("alt")).toBe(
      "Type here",
    );
    expect((document.querySelector("#input") as HTMLInputElement).value).toBe(
      "Escribe",
    );
    expect(document.querySelector("#image")?.getAttribute("src")).toBe(
      "Escribe",
    );
    expect(
      document.querySelector("#forbidden")?.getAttribute("data-label"),
    ).toBe("Escribe");
    expect(document.querySelector("#forbidden")?.getAttribute("class")).toBe(
      "Escribe",
    );
    expect(document.querySelector("#forbidden")?.getAttribute("title")).toBe(
      "Other",
    );
    const forbidden = document.querySelector('[data-key="forbidden-all"]');
    for (const attribute of [
      "id",
      "class",
      "href",
      "src",
      "value",
      "data-extra",
    ]) {
      expect(forbidden?.getAttribute(attribute), attribute).toBe("Escribe");
    }
    expect(document.querySelector("#unlisted")?.getAttribute("title")).toBe(
      "Solo",
    );
    expect(
      document.querySelector("#protected-input")?.getAttribute("placeholder"),
    ).toBe("Escribe");
    expect(
      document.querySelector("#protected-title")?.getAttribute("title"),
    ).toBe("Escribe");
  });

  it("rejects forbidden attributes from malformed runtime rules", () => {
    document.body.innerHTML = `
      <section class="scope">
        <a data-key="target" href="Raw" src="Raw" value="Raw" class="Raw" id="Raw" data-extra="Raw"></a>
      </section>
    `;
    const malformedRule = {
      source: "Raw",
      target: "Translated",
      scope: ".scope",
      attributes: ["href", "src", "value", "class", "id", "data-extra"],
    } as unknown as DomTranslationRule;
    const translator = createTranslator([malformedRule]);

    translator.setLocale("en");

    const target = document.querySelector('[data-key="target"]');
    for (const attribute of [
      "href",
      "src",
      "value",
      "class",
      "id",
      "data-extra",
    ]) {
      expect(target?.getAttribute(attribute), attribute).toBe("Raw");
    }
  });

  it("protects native code-like attributes while allowing control placeholders", () => {
    document.body.innerHTML = `
      <section class="scope">
        <pre id="pre" title="Raw"><span id="pre-child" title="Raw"></span></pre>
        <code id="code" title="Raw"></code>
        <kbd id="kbd" title="Raw"></kbd>
        <samp id="samp" title="Raw"></samp>
        <script id="script" type="text/plain" title="Raw"></script>
        <style id="style" title="Raw"></style>
        <input id="input-placeholder" placeholder="Raw">
        <textarea id="textarea-placeholder" placeholder="Raw"></textarea>
      </section>
    `;
    const translator = createTranslator([
      {
        source: "Raw",
        target: "Translated",
        scope: ".scope",
        attributes: ["title", "placeholder"],
      },
    ]);

    translator.setLocale("en");

    for (const id of [
      "pre",
      "pre-child",
      "code",
      "kbd",
      "samp",
      "script",
      "style",
    ]) {
      expect(document.querySelector(`#${id}`)?.getAttribute("title"), id).toBe(
        "Raw",
      );
    }
    expect(
      document.querySelector("#input-placeholder")?.getAttribute("placeholder"),
    ).toBe("Translated");
    expect(
      document
        .querySelector("#textarea-placeholder")
        ?.getAttribute("placeholder"),
    ).toBe("Translated");
  });

  it("translates dynamic descendants, new scope roots, and exact updates", async () => {
    document.body.innerHTML = `
      <section class="scope"><span id="text">Other</span></section>
      <input class="scope" id="attribute" placeholder="Other">
    `;
    const translator = createTranslator([
      { source: "Enviar", target: "Send", scope: ".scope" },
      {
        source: "Escribe",
        target: "Type here",
        scope: ".scope",
        attributes: ["placeholder"],
      },
    ]);
    translator.setLocale("en");

    const added = document.createElement("span");
    added.id = "added";
    added.textContent = "Enviar";
    document.querySelector("section.scope")?.append(added);
    const newScope = document.createElement("section");
    newScope.className = "scope";
    newScope.innerHTML = '<span id="new-scope-text">Enviar</span>';
    document.body.append(newScope);
    const text = document.querySelector("#text")?.firstChild;
    if (text !== undefined && text !== null) text.textContent = "Enviar";
    document
      .querySelector("#attribute")
      ?.setAttribute("placeholder", "Escribe");

    await flushMutations();

    expect(added.textContent).toBe("Send");
    expect(document.querySelector("#new-scope-text")?.textContent).toBe("Send");
    expect(document.querySelector("#text")?.textContent).toBe("Send");
    expect(
      document.querySelector("#attribute")?.getAttribute("placeholder"),
    ).toBe("Type here");
  });

  it("reconciles owned subtrees moved outside, under protection, or into another scope", async () => {
    document.body.innerHTML = `
      <div id="outside"></div>
      <div id="protected" data-no-translate></div>
      <div id="conversation" data-testid="conversation-panel"></div>
      <section class="first">
        <span id="move-outside" title="Enviar">Enviar</span>
        <span id="move-protected" title="Enviar">Enviar</span>
        <span id="move-conversation" title="Enviar">Enviar</span>
        <span id="move-scope" title="Enviar">Enviar</span>
      </section>
      <section class="second"></section>
    `;
    const translator = createTranslator([
      {
        source: "Enviar",
        target: "First",
        scope: ".first",
        attributes: ["title"],
      },
      {
        source: "Enviar",
        target: "Second",
        scope: ".second",
        attributes: ["title"],
      },
    ]);
    translator.setLocale("en");

    document
      .querySelector("#outside")
      ?.append(document.querySelector("#move-outside") as Element);
    document
      .querySelector("#protected")
      ?.append(document.querySelector("#move-protected") as Element);
    document
      .querySelector("#conversation")
      ?.append(document.querySelector("#move-conversation") as Element);
    document
      .querySelector(".second")
      ?.append(document.querySelector("#move-scope") as Element);
    await flushMutations();

    for (const id of ["move-outside", "move-protected", "move-conversation"]) {
      expect(document.querySelector(`#${id}`)?.textContent, id).toBe("Enviar");
      expect(document.querySelector(`#${id}`)?.getAttribute("title"), id).toBe(
        "Enviar",
      );
    }
    expect(document.querySelector("#move-scope")?.textContent).toBe("Second");
    expect(document.querySelector("#move-scope")?.getAttribute("title")).toBe(
      "Second",
    );
  });

  it("restores and releases a translated subtree when it is disconnected", async () => {
    document.body.innerHTML = `
      <section class="scope"><span id="transient" title="Enviar">Enviar</span></section>
    `;
    const translator = createTranslator([
      {
        source: "Enviar",
        target: "Send",
        scope: ".scope",
        attributes: ["title"],
      },
    ]);
    translator.setLocale("en");
    const transient = document.querySelector("#transient") as Element;

    transient.remove();
    await flushMutations();

    expect(transient.textContent).toBe("Enviar");
    expect(transient.getAttribute("title")).toBe("Enviar");
    transient.textContent = "External";
    transient.setAttribute("title", "External");
    document.querySelector(".scope")?.append(transient);
    await flushMutations();
    translator.setLocale("zh");
    translator.dispose();
    expect(transient.textContent).toBe("External");
    expect(transient.getAttribute("title")).toBe("External");
  });

  it("immediately releases ownership after unmatched external text and attribute changes", async () => {
    document.body.innerHTML = `
      <section class="scope"><span id="external" title="Enviar">Enviar</span></section>
    `;
    const translator = createTranslator([
      {
        source: "Enviar",
        target: "Send",
        scope: ".scope",
        attributes: ["title"],
      },
    ]);
    translator.setLocale("en");
    const external = document.querySelector("#external") as Element;
    const externalText = external.firstChild as Text;

    externalText.data = "Unmatched";
    external.setAttribute("title", "Unmatched");
    await flushMutations();
    externalText.data = "Send";
    external.setAttribute("title", "Send");
    translator.setLocale("zh");

    expect(external.textContent).toBe("Send");
    expect(external.getAttribute("title")).toBe("Send");
  });

  it("reconciles local subtrees when scope or protection attributes change", async () => {
    document.body.innerHTML = `
      <section id="host" data-panel="no"><span id="label">Enviar</span></section>
    `;
    const translator = createTranslator([
      {
        source: "Enviar",
        target: "Send",
        scope: '.active[data-panel="yes"]',
      },
    ]);
    translator.setLocale("en");
    const host = document.querySelector("#host") as Element;

    host.classList.add("active");
    host.setAttribute("data-panel", "yes");
    await flushMutations();
    expect(document.querySelector("#label")?.textContent).toBe("Send");

    host.classList.remove("active");
    await flushMutations();
    expect(document.querySelector("#label")?.textContent).toBe("Enviar");

    host.classList.add("active");
    await flushMutations();
    expect(document.querySelector("#label")?.textContent).toBe("Send");

    host.setAttribute("data-no-translate", "");
    await flushMutations();
    expect(document.querySelector("#label")?.textContent).toBe("Enviar");

    host.removeAttribute("data-no-translate");
    await flushMutations();
    expect(document.querySelector("#label")?.textContent).toBe("Send");
  });

  it("does not feed its own mutations back through another rule", async () => {
    document.body.innerHTML =
      '<section class="outer"><div class="inner"></div></section>';
    const translator = createTranslator([
      { source: "Uno", target: "One", scope: ".outer" },
      { source: "One", target: "Chained", scope: ".inner" },
    ]);
    translator.setLocale("en");
    const added = document.createElement("span");
    added.textContent = "Uno";
    document.querySelector(".inner")?.append(added);

    await flushMutations();

    expect(added.textContent).toBe("One");
  });

  it("is inactive until English, restores owned values, and preserves external changes", async () => {
    document.body.innerHTML = `
      <section class="scope">
        <span id="owned-text">Enviar</span>
        <span id="external-text">Enviar</span>
        <input id="owned-attribute" placeholder="Escribe">
        <input id="external-attribute" placeholder="Escribe">
      </section>
    `;
    const translator = createTranslator([
      { source: "Enviar", target: "Send", scope: ".scope" },
      {
        source: "Escribe",
        target: "Type here",
        scope: ".scope",
        attributes: ["placeholder"],
      },
    ]);

    translator.setLocale("zh");
    expect(document.querySelector("#owned-text")?.textContent).toBe("Enviar");
    expect(
      document.querySelector("#owned-attribute")?.getAttribute("placeholder"),
    ).toBe("Escribe");

    translator.setLocale("en");
    expect(document.querySelector("#owned-text")?.textContent).toBe("Send");
    expect(
      document.querySelector("#owned-attribute")?.getAttribute("placeholder"),
    ).toBe("Type here");

    const externalText = document.querySelector("#external-text");
    const externalAttribute = document.querySelector("#external-attribute");
    if (externalText !== null) externalText.textContent = "React text";
    externalAttribute?.setAttribute("placeholder", "React placeholder");
    translator.setLocale("zh");

    expect(document.querySelector("#owned-text")?.textContent).toBe("Enviar");
    expect(
      document.querySelector("#owned-attribute")?.getAttribute("placeholder"),
    ).toBe("Escribe");
    expect(externalText?.textContent).toBe("React text");
    expect(externalAttribute?.getAttribute("placeholder")).toBe(
      "React placeholder",
    );

    if (externalText !== null) externalText.textContent = "Enviar";
    externalAttribute?.setAttribute("placeholder", "Escribe");
    translator.setLocale("en");
    expect(document.querySelector("#owned-text")?.textContent).toBe("Send");
    expect(externalText?.textContent).toBe("Send");

    expect(() => translator.dispose()).not.toThrow();
    expect(() => translator.dispose()).not.toThrow();
    expect(document.querySelector("#owned-text")?.textContent).toBe("Enviar");
    expect(externalText?.textContent).toBe("Enviar");
    expect(
      document.querySelector("#owned-attribute")?.getAttribute("placeholder"),
    ).toBe("Escribe");

    const later = document.createElement("span");
    later.textContent = "Enviar";
    document.querySelector(".scope")?.append(later);
    translator.setLocale("en");
    await flushMutations();
    expect(later.textContent).toBe("Enviar");
  });

  it("restores the latest host source after active retranslation and tolerates repeated locales", async () => {
    document.body.innerHTML = `
      <section class="scope">
        <span id="text">Uno</span>
        <input id="attribute" placeholder="Escribe">
      </section>
    `;
    const translator = createTranslator([
      { source: "Uno", target: "One", scope: ".scope" },
      { source: "Dos", target: "Two", scope: ".scope" },
      {
        source: "Escribe",
        target: "Type here",
        scope: ".scope",
        attributes: ["placeholder"],
      },
      {
        source: "Busca",
        target: "Search",
        scope: ".scope",
        attributes: ["placeholder"],
      },
    ]);
    translator.setLocale("en");
    translator.setLocale("en");

    const textNode = document.querySelector("#text")?.firstChild;
    if (textNode !== null && textNode !== undefined)
      textNode.textContent = "Dos";
    document.querySelector("#attribute")?.setAttribute("placeholder", "Busca");
    await flushMutations();
    expect(document.querySelector("#text")?.textContent).toBe("Two");
    expect(
      document.querySelector("#attribute")?.getAttribute("placeholder"),
    ).toBe("Search");

    translator.setLocale("zh");
    translator.setLocale("zh");

    expect(document.querySelector("#text")?.textContent).toBe("Dos");
    expect(
      document.querySelector("#attribute")?.getAttribute("placeholder"),
    ).toBe("Busca");
  });

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

  it("supports root-local compound selectors with dynamic membership", async () => {
    document.body.innerHTML = `
      <section id="active" class="active" data-panel="no"><span>Uno</span></section>
      <section id="exact" class="plugin"><span>Dos</span></section>
      <article id="tagged" class="card" data-kind="primary secondary"><span>Tres</span></article>
    `;
    const translator = createTranslator([
      {
        source: "Uno",
        target: "One",
        scope: '.active[data-panel="yes"]',
      },
      {
        source: "Dos",
        target: "Two",
        scope: "#exact.plugin[data-x]",
      },
      {
        source: "Tres",
        target: "Three",
        scope: 'article.card[data-kind~="primary"][aria-label="Panel A"]',
      },
    ]);
    translator.setLocale("en");
    const active = document.querySelector("#active") as Element;
    const exact = document.querySelector("#exact") as Element;
    const tagged = document.querySelector("#tagged") as Element;

    active.setAttribute("data-panel", "yes");
    exact.setAttribute("data-x", "");
    tagged.setAttribute("aria-label", "Panel A");
    await flushMutations();

    expect(active.textContent).toBe("One");
    expect(exact.textContent).toBe("Two");
    expect(tagged.textContent).toBe("Three");

    active.setAttribute("data-panel", "no");
    exact.removeAttribute("data-x");
    tagged.setAttribute("aria-label", "Panel B");
    await flushMutations();

    expect(active.textContent).toBe("Uno");
    expect(exact.textContent).toBe("Dos");
    expect(tagged.textContent).toBe("Tres");
  });

  it("keeps attribute dependency conflicts as defense-in-depth", async () => {
    document.body.innerHTML = `
      <span id="feedback" title="Enviar">Enviar</span>
    `;
    const diagnostics = createDiagnostics();
    const translator = createTranslator(
      [
        {
          source: "Enviar",
          target: "Send",
          scope: '[title="Enviar"]',
          attributes: ["title"],
        },
      ],
      diagnostics,
    );

    translator.setLocale("en");
    await flushMutations();

    expect(document.querySelector("#feedback")?.textContent).toBe("Send");
    expect(document.querySelector("#feedback")?.getAttribute("title")).toBe(
      "Enviar",
    );
    expect(
      diagnostics.snapshot().filter(({ code }) => code === "invalid_dom_rule"),
    ).toHaveLength(1);
  });

  it("queries each declared scope once initially and never rescans document or body on mutations", async () => {
    document.body.innerHTML = '<section class="scope"></section>';
    const documentQuery = vi.spyOn(document, "querySelectorAll");
    const translator = createTranslator([
      { source: "Enviar", target: "Send", scope: ".scope" },
      { source: "Cancelar", target: "Cancel", scope: ".scope" },
    ]);

    translator.setLocale("en");
    expect(
      documentQuery.mock.calls.filter(([selector]) => selector === ".scope"),
    ).toHaveLength(1);

    documentQuery.mockClear();
    const bodyQuery = vi.spyOn(document.body, "querySelectorAll");
    const added = document.createElement("span");
    added.textContent = "Enviar";
    document.querySelector(".scope")?.append(added);
    await flushMutations();

    expect(added.textContent).toBe("Send");
    expect(documentQuery).not.toHaveBeenCalled();
    expect(bodyQuery).not.toHaveBeenCalled();
  });

  it("handles structural attributes without rescanning body or unrelated descendants", async () => {
    document.body.innerHTML = `
      <section class="plugin"><span id="existing-plugin">Enviar</span></section>
      <div id="local"><span id="local-label">Enviar</span></div>
    `;
    const translator = createTranslator([
      { source: "Enviar", target: "Send", scope: ".plugin" },
    ]);
    translator.setLocale("en");
    const createTreeWalker = vi.spyOn(document, "createTreeWalker");
    const bodyQuery = vi.spyOn(document.body, "querySelectorAll");

    document.body.classList.add("unrelated");
    await flushMutations();

    expect(document.querySelector("#existing-plugin")?.textContent).toBe(
      "Send",
    );
    expect(createTreeWalker).not.toHaveBeenCalled();
    expect(bodyQuery).not.toHaveBeenCalled();

    const local = document.querySelector("#local") as Element;
    local.classList.add("plugin");
    await flushMutations();
    expect(document.querySelector("#local-label")?.textContent).toBe("Send");
    expect(createTreeWalker).toHaveBeenCalledTimes(1);
    expect(createTreeWalker.mock.calls[0]?.[0]).toBe(local);
    expect(bodyQuery).not.toHaveBeenCalled();

    createTreeWalker.mockClear();
    local.classList.remove("plugin");
    await flushMutations();
    expect(document.querySelector("#local-label")?.textContent).toBe("Enviar");
    expect(createTreeWalker).not.toHaveBeenCalled();

    local.classList.add("plugin");
    await flushMutations();
    expect(document.querySelector("#local-label")?.textContent).toBe("Send");
    createTreeWalker.mockClear();

    local.setAttribute("data-no-translate", "");
    await flushMutations();
    expect(document.querySelector("#local-label")?.textContent).toBe("Enviar");
    expect(createTreeWalker).not.toHaveBeenCalled();

    local.removeAttribute("data-no-translate");
    await flushMutations();
    expect(document.querySelector("#local-label")?.textContent).toBe("Send");
    expect(createTreeWalker.mock.calls.every(([root]) => root === local)).toBe(
      true,
    );
    expect(bodyQuery).not.toHaveBeenCalled();
  });

  it("reapplies global rules only when class-based protection clears locally", async () => {
    document.body.innerHTML = `
      <div id="class-protected" class="conversation-panel">
        <span id="global-label">Enviar</span>
      </div>
    `;
    const translator = createTranslator([
      { source: "Enviar", target: "Send", scope: "global" },
    ]);
    translator.setLocale("en");
    const createTreeWalker = vi.spyOn(document, "createTreeWalker");

    document.body.classList.add("unrelated");
    await flushMutations();
    expect(createTreeWalker).not.toHaveBeenCalled();

    const protectedRoot = document.querySelector("#class-protected") as Element;
    protectedRoot.classList.remove("conversation-panel");
    await flushMutations();

    expect(document.querySelector("#global-label")?.textContent).toBe("Send");
    expect(
      createTreeWalker.mock.calls.every(([root]) => root === protectedRoot),
    ).toBe(true);
  });

  it("traverses only topmost roots for nested instances of the same scope", () => {
    document.body.innerHTML = `
      <section class="scope">
        <div class="scope"><span id="nested">Enviar</span></div>
      </section>
    `;
    const createTreeWalker = vi.spyOn(document, "createTreeWalker");
    const translator = createTranslator([
      { source: "Enviar", target: "Send", scope: ".scope" },
    ]);

    translator.setLocale("en");

    expect(document.querySelector("#nested")?.textContent).toBe("Send");
    expect(createTreeWalker).toHaveBeenCalledTimes(1);
  });

  it("observes an exact bounded filter for translation, scope, and safety attributes", () => {
    document.body.innerHTML = '<section class="scope"></section>';
    const observe = vi.spyOn(MutationObserver.prototype, "observe");

    const textOnly = createTranslator([
      {
        source: "Enviar",
        target: "Send",
        scope: ".scope[data-panel]",
      },
    ]);
    textOnly.setLocale("en");
    expect(observe).toHaveBeenLastCalledWith(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: [
        "class",
        "id",
        "contenteditable",
        "data-no-translate",
        "data-message-id",
        "data-testid",
        "data-panel",
      ],
    });
    textOnly.dispose();

    const withAttributes = createTranslator([
      {
        source: "Uno",
        target: "One",
        scope: ".scope",
        attributes: ["title", "placeholder"],
      },
      {
        source: "Dos",
        target: "Two",
        scope: ".scope",
        attributes: ["title", "aria-label"],
      },
    ]);
    withAttributes.setLocale("en");
    expect(observe).toHaveBeenLastCalledWith(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: [
        "title",
        "placeholder",
        "aria-label",
        "class",
        "id",
        "contenteditable",
        "data-no-translate",
        "data-message-id",
        "data-testid",
      ],
    });
  });

  it("fails open with diagnostics when body or MutationObserver is unavailable", () => {
    const bodylessDocument = document.implementation.createHTMLDocument();
    bodylessDocument.body?.remove();
    const bodylessDiagnostics = createDiagnostics();
    const bodylessTranslator = new DomTranslator(
      bodylessDocument,
      [{ source: "Source", target: "Target", scope: "global" }],
      bodylessDiagnostics,
    );

    expect(() => bodylessTranslator.setLocale("en")).not.toThrow();
    expect(
      bodylessDiagnostics
        .snapshot()
        .some(({ code }) => code === "dom_translation_failed"),
    ).toBe(true);

    const observerDiagnostics = createDiagnostics();
    class ThrowingMutationObserver {
      constructor() {
        throw new Error("observer unavailable");
      }
    }
    const hostileDocument = new Proxy(document, {
      get(target, property, receiver): unknown {
        if (property === "defaultView") {
          return { MutationObserver: ThrowingMutationObserver };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    }) as Document;
    const observerTranslator = new DomTranslator(
      hostileDocument,
      [{ source: "Source", target: "Target", scope: "global" }],
      observerDiagnostics,
    );
    expect(() => observerTranslator.setLocale("en")).not.toThrow();
    expect(
      observerDiagnostics
        .snapshot()
        .some(({ code }) => code === "dom_translation_failed"),
    ).toBe(true);
  });

  it("contains hostile tree walking without throwing into the host", () => {
    document.body.innerHTML = '<section class="scope">Enviar</section>';
    const diagnostics = createDiagnostics();
    vi.spyOn(document, "createTreeWalker").mockImplementation(() => {
      throw new Error("tree walker unavailable");
    });
    const translator = createTranslator(
      [{ source: "Enviar", target: "Send", scope: ".scope" }],
      diagnostics,
    );

    expect(() => translator.setLocale("en")).not.toThrow();
    expect(document.querySelector(".scope")?.textContent).toBe("Enviar");
    expect(
      diagnostics
        .snapshot()
        .filter(({ code }) => code === "dom_translation_failed"),
    ).toHaveLength(1);
  });

  it("translates dynamic nodes from the injected document realm", async () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const foreignDocument = iframe.contentDocument;
    if (foreignDocument === null)
      throw new Error("iframe document unavailable");
    foreignDocument.body.innerHTML = `
      <section class="scope"><span id="initial">Enviar</span></section>
    `;
    const translator = new DomTranslator(
      foreignDocument,
      [
        {
          source: "Enviar",
          target: "Send",
          scope: ".scope",
          attributes: ["title"],
        },
      ],
      createDiagnostics(),
    );
    translators.add(translator);
    translator.setLocale("en");
    const dynamic = foreignDocument.createElement("span");
    dynamic.textContent = "Enviar";
    dynamic.setAttribute("title", "Enviar");

    foreignDocument.querySelector(".scope")?.append(dynamic);
    await flushMutations();

    expect(foreignDocument.querySelector("#initial")?.textContent).toBe("Send");
    expect(dynamic.textContent).toBe("Send");
    expect(dynamic.getAttribute("title")).toBe("Send");
  });

  it("isolates a hostile mutation and continues the same observer batch", async () => {
    document.body.innerHTML = '<section class="scope"></section>';
    const diagnostics = createDiagnostics();
    const translator = createTranslator(
      [{ source: "Enviar", target: "Send", scope: ".scope" }],
      diagnostics,
    );
    translator.setLocale("en");
    const hostile = document.createElement("span");
    hostile.textContent = "Enviar";
    hostile.closest = (): never => {
      throw new Error("closest unavailable");
    };
    const valid = document.createElement("span");
    valid.textContent = "Enviar";

    document.querySelector(".scope")?.append(hostile, valid);
    await flushMutations();

    expect(valid.textContent).toBe("Send");
    expect(
      diagnostics
        .snapshot()
        .filter(({ code }) => code === "dom_translation_failed"),
    ).toHaveLength(1);
  });

  it("isolates a hostile initial root and continues with later roots", () => {
    document.body.innerHTML = `
      <section class="scope" id="hostile">Enviar</section>
      <section class="scope" id="healthy">Enviar</section>
    `;
    const hostile = document.querySelector("#hostile");
    Object.defineProperty(hostile, "querySelectorAll", {
      configurable: true,
      value: (): never => {
        throw new Error("root traversal unavailable");
      },
    });
    const diagnostics = createDiagnostics();
    const translator = createTranslator(
      [{ source: "Enviar", target: "Send", scope: ".scope" }],
      diagnostics,
    );

    expect(() => translator.setLocale("en")).not.toThrow();

    expect(document.querySelector("#hostile")?.textContent).toBe("Enviar");
    expect(document.querySelector("#healthy")?.textContent).toBe("Send");
    expect(
      diagnostics
        .snapshot()
        .filter(({ code }) => code === "dom_translation_failed"),
    ).toHaveLength(1);
  });

  it("isolates a hostile descendant and continues later descendants in the same root", () => {
    document.body.innerHTML = `
      <section class="scope">
        <span id="hostile-descendant" title="Enviar">Enviar</span>
        <span id="healthy-descendant" title="Enviar">Enviar</span>
      </section>
    `;
    const hostile = document.querySelector("#hostile-descendant") as Element;
    hostile.closest = (): never => {
      throw new Error("closest unavailable");
    };
    const translator = createTranslator([
      {
        source: "Enviar",
        target: "Send",
        scope: ".scope",
        attributes: ["title"],
      },
    ]);

    translator.setLocale("en");

    const healthy = document.querySelector("#healthy-descendant");
    expect(healthy?.textContent).toBe("Send");
    expect(healthy?.getAttribute("title")).toBe("Send");
  });
});
