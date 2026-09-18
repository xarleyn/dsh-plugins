// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import type { DomTranslationRule } from "../src/types.js";
import { createTranslator } from "./dom-translator.helpers.js";

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
});
