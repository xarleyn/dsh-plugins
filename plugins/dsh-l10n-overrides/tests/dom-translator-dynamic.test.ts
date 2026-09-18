// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { createTranslator, flushMutations } from "./dom-translator.helpers.js";

describe("DomTranslator", () => {
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
});
