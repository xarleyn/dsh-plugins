import { describe, expect, it } from "vitest";
import { TranslationPackRegistry } from "../src/registry/translation-registry.js";
import type { TranslationPack } from "../src/types.js";
import { createDiagnostics } from "./registry.helpers.js";

describe("TranslationPackRegistry", () => {
  it("resolves registered English translations by exact locale, namespace, and key", () => {
    const registry = new TranslationPackRegistry(createDiagnostics());
    const pack = {
      id: "core",
      target: { package: "example" },
      en: { composer: { send: "Send" } },
    } as const satisfies TranslationPack;

    registry.register(pack);

    expect(registry.resolve("en", "composer", "send")).toBe("Send");
    expect(registry.resolve("EN", "composer", "send")).toBeUndefined();
    expect(registry.resolve("en", "Composer", "send")).toBeUndefined();
    expect(registry.resolve("en", "composer", "Send")).toBeUndefined();
    expect(registry.resolve("fr", "composer", "send")).toBeUndefined();
  });

  it("reports the owning pack for an exact translation hit", () => {
    const registry = new TranslationPackRegistry(createDiagnostics());
    registry.register({
      id: "composer-pack",
      target: { package: "example" },
      en: { composer: { send: "Send" } },
    });

    expect(registry.resolveEntry("en", "composer", "send")).toEqual({
      value: "Send",
      packId: "composer-pack",
    });
    expect(registry.resolveEntry("en", "composer", "missing")).toBeUndefined();
  });

  it("indexes and counts nonconflicting packs, namespaces, and keys", () => {
    const registry = new TranslationPackRegistry(createDiagnostics());
    registry.register({
      id: "first",
      target: { package: "first-package" },
      en: {
        composer: { send: "Send", cancel: "Cancel" },
        history: { clear: "Clear history" },
      },
    });
    registry.register({
      id: "second",
      target: { package: "second-package" },
      en: { settings: { save: "Save" } },
    });

    expect(registry.resolve("en", "composer", "send")).toBe("Send");
    expect(registry.resolve("en", "composer", "cancel")).toBe("Cancel");
    expect(registry.resolve("en", "history", "clear")).toBe("Clear history");
    expect(registry.resolve("en", "settings", "save")).toBe("Save");
    expect(registry.getStats()).toEqual({
      packs: 2,
      localeOverrides: 4,
      domRules: 0,
    });
  });

  it("keeps the first exact override and diagnoses later collisions", () => {
    const diagnostics = createDiagnostics();
    const registry = new TranslationPackRegistry(diagnostics);
    registry.register({
      id: "first-pack",
      target: { package: "first-package" },
      en: { composer: { send: "Send first" } },
    });
    registry.register({
      id: "second-pack",
      target: { package: "second-package" },
      en: { composer: { send: "Send second" } },
    });

    expect(registry.resolveEntry("en", "composer", "send")).toEqual({
      value: "Send first",
      packId: "first-pack",
    });
    expect(registry.getStats()).toEqual({
      packs: 2,
      localeOverrides: 1,
      domRules: 0,
    });
    expect(diagnostics.snapshot()).toHaveLength(1);
    expect(diagnostics.snapshot()[0]).toMatchObject({
      level: "error",
      code: "duplicate_override",
    });
    for (const detail of [
      "en",
      "composer",
      "send",
      "first-pack",
      "second-pack",
    ]) {
      expect(diagnostics.snapshot()[0]?.message).toContain(detail);
    }
  });

  it("diagnoses duplicate pack ids and ignores the entire later pack", () => {
    const diagnostics = createDiagnostics();
    const registry = new TranslationPackRegistry(diagnostics);
    registry.register({
      id: "same-id",
      target: { package: "first-package" },
      en: { first: { key: "First" } },
      dom: [{ source: "Uno", target: "One", scope: ".first" }],
    });
    registry.register({
      id: "same-id",
      target: { package: "second-package" },
      en: { second: { key: "Second" } },
      dom: [{ source: "Dos", target: "Two", scope: "global" }],
    });

    expect(registry.resolve("en", "first", "key")).toBe("First");
    expect(registry.resolve("en", "second", "key")).toBeUndefined();
    expect(registry.getDomRules("en")).toEqual([
      { source: "Uno", target: "One", scope: ".first" },
    ]);
    expect(registry.getStats()).toEqual({
      packs: 1,
      localeOverrides: 1,
      domRules: 1,
    });
    expect(diagnostics.snapshot()).toEqual([
      {
        level: "error",
        code: "duplicate_pack_id",
        message: expect.stringContaining("same-id"),
      },
    ]);
  });

  it("reads a duplicate id once without touching the duplicate pack payload", () => {
    const diagnostics = createDiagnostics();
    const registry = new TranslationPackRegistry(diagnostics);
    registry.register({
      id: "duplicate-id",
      target: { package: "example" },
      en: { first: { key: "First" } },
    });
    const reads = { id: 0, en: 0, dom: 0 };
    const duplicate = {
      get id(): string {
        reads.id += 1;
        return "duplicate-id";
      },
      get en(): never {
        reads.en += 1;
        throw new Error("duplicate translations must not be read");
      },
      get dom(): never {
        reads.dom += 1;
        throw new Error("duplicate DOM rules must not be read");
      },
    } as unknown as TranslationPack;

    expect(() => registry.register(duplicate)).not.toThrow();
    expect(reads).toEqual({ id: 1, en: 0, dom: 0 });
    expect(registry.getStats()).toEqual({
      packs: 1,
      localeOverrides: 1,
      domRules: 0,
    });
    expect(diagnostics.snapshot()).toEqual([
      {
        level: "error",
        code: "duplicate_pack_id",
        message: expect.stringContaining("duplicate-id"),
      },
    ]);
  });
});
