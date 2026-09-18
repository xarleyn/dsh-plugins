import { describe, expect, it } from "vitest";
import { TranslationPackRegistry } from "../src/registry/translation-registry.js";
import type { TranslationPack } from "../src/types.js";
import { createDiagnostics } from "./registry.helpers.js";

describe("TranslationPackRegistry", () => {
  it("returns English DOM rules in registration order and no rules for other locales", () => {
    const registry = new TranslationPackRegistry(createDiagnostics());
    registry.register({
      id: "first",
      target: { package: "first-package" },
      en: {},
      dom: [
        {
          source: "Enviar",
          target: "Send",
          scope: ".composer",
          mode: "exact",
          attributes: ["title"],
        },
        { source: "Cancelar", target: "Cancel", scope: ".composer" },
      ],
    });
    registry.register({
      id: "second",
      target: { package: "second-package" },
      en: {},
      dom: [{ source: "Guardar", target: "Save", scope: ".settings" }],
    });

    expect(registry.getDomRules("en")).toEqual([
      {
        source: "Enviar",
        target: "Send",
        scope: ".composer",
        mode: "exact",
        attributes: ["title"],
      },
      { source: "Cancelar", target: "Cancel", scope: ".composer" },
      { source: "Guardar", target: "Save", scope: ".settings" },
    ]);
    expect(registry.getDomRules("EN")).toEqual([]);
    expect(registry.getDomRules("fr")).toEqual([]);
    expect(registry.getStats()).toEqual({
      packs: 2,
      localeOverrides: 0,
      domRules: 3,
    });
  });

  it("warns exactly once per pack containing global DOM rules", () => {
    const diagnostics = createDiagnostics();
    const registry = new TranslationPackRegistry(diagnostics);
    registry.register({
      id: "global-pack",
      target: { package: "example" },
      en: {},
      dom: [
        { source: "Uno", target: "One", scope: "global" },
        { source: "Dos", target: "Two", scope: ".scoped" },
        { source: "Tres", target: "Three", scope: "global" },
      ],
    });

    expect(registry.getDomRules("en")).toHaveLength(3);
    expect(diagnostics.snapshot()).toEqual([
      {
        level: "warning",
        code: "global_dom_scope",
        message: expect.stringContaining("global-pack"),
      },
    ]);
  });

  it("skips malformed runtime DOM rules while keeping valid siblings", () => {
    const diagnostics = createDiagnostics();
    const registry = new TranslationPackRegistry(diagnostics);
    const pack = {
      id: "runtime-pack",
      target: { package: "example" },
      en: {},
      dom: [
        { source: "Valid", target: "Good", scope: "[broken-selector" },
        { source: "Blank scope", target: "Bad", scope: "   " },
        { source: " ", target: "Bad", scope: ".scope" },
        { source: "Blank target", target: "\t", scope: ".scope" },
        {
          source: "Unsupported mode",
          target: "Bad",
          scope: ".scope",
          mode: "contains",
        },
        {
          source: "Unsupported attribute",
          target: "Bad",
          scope: ".scope",
          attributes: ["title", "value"],
        },
      ],
    } as unknown as TranslationPack;

    expect(() => registry.register(pack)).not.toThrow();
    expect(registry.getDomRules("en")).toEqual([
      { source: "Valid", target: "Good", scope: "[broken-selector" },
    ]);
    expect(registry.getStats()).toEqual({
      packs: 1,
      localeOverrides: 0,
      domRules: 1,
    });
    expect(diagnostics.snapshot()).toHaveLength(5);
    expect(
      diagnostics
        .snapshot()
        .every(
          ({ level, code, message }) =>
            level === "error" &&
            code === "invalid_dom_rule" &&
            message.includes("runtime-pack"),
        ),
    ).toBe(true);
  });

  it("isolates exceptions from every DOM rule property read", () => {
    const diagnostics = createDiagnostics();
    const registry = new TranslationPackRegistry(diagnostics);
    const hostileRules = [
      "source",
      "target",
      "scope",
      "mode",
      "attributes",
    ].map((property) => {
      const rule: Record<string, unknown> = {
        source: "Source",
        target: "Target",
        scope: ".scope",
        mode: "exact",
        attributes: ["title"],
      };
      Object.defineProperty(rule, property, {
        enumerable: true,
        get(): never {
          throw new Error(`${property} unavailable`);
        },
      });
      return rule;
    });
    const pack = {
      id: "hostile-dom-pack",
      target: { package: "example" },
      en: {},
      dom: [
        ...hostileRules,
        { source: "Valid", target: "Accepted", scope: ".valid" },
      ],
    } as unknown as TranslationPack;

    expect(() => registry.register(pack)).not.toThrow();
    expect(registry.getDomRules("en")).toEqual([
      { source: "Valid", target: "Accepted", scope: ".valid" },
    ]);
    expect(registry.getStats()).toEqual({
      packs: 1,
      localeOverrides: 0,
      domRules: 1,
    });
    expect(diagnostics.snapshot()).toHaveLength(5);
    expect(
      diagnostics
        .snapshot()
        .every(
          ({ level, code }) => level === "error" && code === "invalid_dom_rule",
        ),
    ).toBe(true);
  });

  it("reads each DOM rule property once and snapshots the captured values", () => {
    const diagnostics = createDiagnostics();
    const registry = new TranslationPackRegistry(diagnostics);
    const reads = {
      source: 0,
      target: 0,
      scope: 0,
      mode: 0,
      attributes: 0,
    };
    const rule = {
      get source(): string {
        reads.source += 1;
        return reads.source === 1 ? "Captured source" : " ";
      },
      get target(): string {
        reads.target += 1;
        return reads.target === 1 ? "Captured target" : " ";
      },
      get scope(): string {
        reads.scope += 1;
        return reads.scope === 1 ? "global" : " ";
      },
      get mode(): string {
        reads.mode += 1;
        return reads.mode === 1 ? "exact" : "contains";
      },
      get attributes(): string[] {
        reads.attributes += 1;
        return reads.attributes === 1 ? ["title"] : ["value"];
      },
    };

    registry.register({
      id: "changing-dom-pack",
      target: { package: "example" },
      en: {},
      dom: [rule],
    } as unknown as TranslationPack);

    expect(reads).toEqual({
      source: 1,
      target: 1,
      scope: 1,
      mode: 1,
      attributes: 1,
    });
    expect(registry.getDomRules("en")).toEqual([
      {
        source: "Captured source",
        target: "Captured target",
        scope: "global",
        mode: "exact",
        attributes: ["title"],
      },
    ]);
    expect(diagnostics.snapshot()).toEqual([
      {
        level: "warning",
        code: "global_dom_scope",
        message: expect.stringContaining("changing-dom-pack"),
      },
    ]);
  });

  it("reads each DOM attribute element once before validation and freezing", () => {
    const registry = new TranslationPackRegistry(createDiagnostics());
    let attributeReads = 0;
    const attributes = new Proxy(["title"], {
      get(target, property, receiver): unknown {
        if (property === "0") {
          attributeReads += 1;
          return attributeReads === 1 ? "title" : "value";
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    registry.register({
      id: "changing-attributes-pack",
      target: { package: "example" },
      en: {},
      dom: [
        {
          source: "Source",
          target: "Target",
          scope: ".scope",
          attributes,
        },
      ],
    } as unknown as TranslationPack);

    expect(attributeReads).toBe(1);
    expect(registry.getDomRules("en")).toEqual([
      {
        source: "Source",
        target: "Target",
        scope: ".scope",
        attributes: ["title"],
      },
    ]);
  });

  it("diagnoses a non-array DOM declaration without rejecting translations", () => {
    const diagnostics = createDiagnostics();
    const registry = new TranslationPackRegistry(diagnostics);
    const pack = {
      id: "non-array-dom-pack",
      target: { package: "example" },
      en: { composer: { send: "Send" } },
      dom: { source: "Raw", target: "Rejected", scope: "global" },
    } as unknown as TranslationPack;

    expect(() => registry.register(pack)).not.toThrow();
    expect(registry.resolve("en", "composer", "send")).toBe("Send");
    expect(registry.getDomRules("en")).toEqual([]);
    expect(registry.getStats()).toEqual({
      packs: 1,
      localeOverrides: 1,
      domRules: 0,
    });
    expect(diagnostics.snapshot()).toEqual([
      {
        level: "error",
        code: "invalid_dom_rule",
        message: expect.stringContaining("non-array-dom-pack"),
      },
    ]);
  });

  it("contains an unreadable DOM declaration and still commits translations", () => {
    const diagnostics = createDiagnostics();
    const registry = new TranslationPackRegistry(diagnostics);
    let domReads = 0;
    const pack = {
      id: "unreadable-dom-pack",
      target: { package: "example" },
      en: { composer: { send: "Send" } },
      get dom(): never {
        domReads += 1;
        throw new Error("DOM declaration unavailable");
      },
    } as unknown as TranslationPack;

    expect(() => registry.register(pack)).not.toThrow();
    expect(domReads).toBe(1);
    expect(registry.resolve("en", "composer", "send")).toBe("Send");
    expect(registry.getStats()).toEqual({
      packs: 1,
      localeOverrides: 1,
      domRules: 0,
    });
    expect(diagnostics.snapshot()).toEqual([
      {
        level: "error",
        code: "invalid_dom_rule",
        message: expect.stringContaining("unreadable-dom-pack"),
      },
    ]);
  });

  it("commits large DOM packs without argument-spread failure", () => {
    const registry = new TranslationPackRegistry(createDiagnostics());
    const ruleCount = 150_000;
    const rule = { source: "Source", target: "Target", scope: ".scope" };

    expect(() =>
      registry.register({
        id: "large-dom-pack",
        target: { package: "example" },
        en: { composer: { send: "Send" } },
        dom: new Array(ruleCount).fill(rule),
      }),
    ).not.toThrow();
    expect(registry.getStats()).toEqual({
      packs: 1,
      localeOverrides: 1,
      domRules: ruleCount,
    });
    expect(registry.getDomRules("en")).toHaveLength(ruleCount);
  });
});
