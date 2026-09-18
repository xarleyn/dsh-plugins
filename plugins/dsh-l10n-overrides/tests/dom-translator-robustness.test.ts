// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { DomTranslator } from "../src/runtime/dom-translator.js";
import {
  createDiagnostics,
  createTranslator,
  flushMutations,
  translators,
} from "./dom-translator.helpers.js";

describe("DomTranslator", () => {
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
