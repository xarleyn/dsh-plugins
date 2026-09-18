import { describe, expect, it } from "vitest";
import { TranslationPackRegistry } from "../src/registry/translation-registry.js";
import type { TranslationPack } from "../src/types.js";
import { createDiagnostics, invalidPackCases } from "./registry.helpers.js";

describe("TranslationPackRegistry", () => {
  it.each(invalidPackCases)(
    "rejects $name atomically and permits id reuse",
    ({ intendedId, create }) => {
      const diagnostics = createDiagnostics();
      const registry = new TranslationPackRegistry(diagnostics);
      const recoveryId = intendedId ?? "recovery-pack";

      expect(() =>
        registry.register(create() as TranslationPack),
      ).not.toThrow();
      expect(registry.getStats()).toEqual({
        packs: 0,
        localeOverrides: 0,
        domRules: 0,
      });
      expect(registry.getDomRules("en")).toEqual([]);
      expect(diagnostics.snapshot()).toHaveLength(1);
      expect(diagnostics.snapshot()[0]).toMatchObject({
        level: "error",
        code: "invalid_pack",
      });

      registry.register({
        id: recoveryId,
        target: { package: "example" },
        en: { recovered: { key: "Recovered" } },
      });

      expect(registry.resolve("en", "recovered", "key")).toBe("Recovered");
      expect(registry.getStats()).toEqual({
        packs: 1,
        localeOverrides: 1,
        domRules: 0,
      });
      expect(diagnostics.snapshot()).toHaveLength(1);
    },
  );

  it("snapshots translation and DOM source data at registration", () => {
    const registry = new TranslationPackRegistry(createDiagnostics());
    const source = {
      id: "mutable-pack",
      target: { package: "example" },
      en: { composer: { send: "Send" } },
      dom: [
        {
          source: "Enviar",
          target: "Send",
          scope: ".composer",
          mode: "exact",
          attributes: ["title"],
        },
      ],
    };
    registry.register(source as unknown as TranslationPack);

    source.id = "changed-pack";
    source.en.composer.send = "Changed";
    Object.assign(source.en.composer, { cancel: "Cancel" });
    source.dom[0]!.source = "Changed";
    source.dom[0]!.attributes.push("alt");
    source.dom.push({
      source: "Cancelar",
      target: "Cancel",
      scope: ".composer",
      mode: "exact",
      attributes: ["title"],
    });

    expect(registry.resolveEntry("en", "composer", "send")).toEqual({
      value: "Send",
      packId: "mutable-pack",
    });
    expect(registry.resolve("en", "composer", "cancel")).toBeUndefined();
    expect(registry.getDomRules("en")).toEqual([
      {
        source: "Enviar",
        target: "Send",
        scope: ".composer",
        mode: "exact",
        attributes: ["title"],
      },
    ]);
  });

  it("counts empty packs and returns frozen stats snapshots", () => {
    const registry = new TranslationPackRegistry(createDiagnostics());
    registry.register({
      id: "empty-pack",
      target: { package: "example" },
      en: {},
      dom: [],
    });

    const stats = registry.getStats();
    expect(stats).toEqual({ packs: 1, localeOverrides: 0, domRules: 0 });
    expect(Object.isFrozen(stats)).toBe(true);
    expect(() => {
      (stats as { packs: number }).packs = 99;
    }).toThrow();
    expect(registry.getStats()).toEqual({
      packs: 1,
      localeOverrides: 0,
      domRules: 0,
    });
  });

  it("does not expose mutable translation entry internals", () => {
    const registry = new TranslationPackRegistry(createDiagnostics());
    registry.register({
      id: "immutable-pack",
      target: { package: "example" },
      en: { composer: { send: "Send" } },
    });

    const entry = registry.resolveEntry("en", "composer", "send");
    expect(entry).toEqual({ value: "Send", packId: "immutable-pack" });
    expect(Object.isFrozen(entry)).toBe(true);
    expect(() => {
      (entry as { value: string }).value = "Changed";
    }).toThrow();
    expect(registry.resolveEntry("en", "composer", "send")).toEqual({
      value: "Send",
      packId: "immutable-pack",
    });
  });

  it("returns deeply frozen DOM rule snapshots without exposing the registry array", () => {
    const registry = new TranslationPackRegistry(createDiagnostics());
    registry.register({
      id: "dom-pack",
      target: { package: "example" },
      en: {},
      dom: [
        {
          source: "Enviar",
          target: "Send",
          scope: ".composer",
          attributes: ["title"],
        },
      ],
    });

    const rules = registry.getDomRules("en");
    expect(Object.isFrozen(rules)).toBe(true);
    expect(Object.isFrozen(rules[0])).toBe(true);
    expect(Object.isFrozen(rules[0]?.attributes)).toBe(true);
    expect(Object.isFrozen(registry.getDomRules("fr"))).toBe(true);
    expect(() => {
      (rules as unknown[]).push({});
    }).toThrow();
    expect(() => {
      (rules[0] as { source: string }).source = "Changed";
    }).toThrow();
    expect(() => {
      (rules[0]?.attributes as string[]).push("alt");
    }).toThrow();
    expect(registry.getDomRules("en")).toEqual([
      {
        source: "Enviar",
        target: "Send",
        scope: ".composer",
        attributes: ["title"],
      },
    ]);
  });
});
