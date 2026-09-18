// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  createDiagnostics,
  createTranslator,
  flushMutations,
} from "./dom-translator.helpers.js";

describe("DomTranslator", () => {
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
});
