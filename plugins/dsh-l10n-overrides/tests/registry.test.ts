import { describe, expect, it, vi } from "vitest";
import { Diagnostics } from "../src/registry/diagnostics.js";
import { TranslationPackRegistry } from "../src/registry/translation-registry.js";
import type { TranslationPack } from "../src/types.js";

function createDiagnostics(): Diagnostics {
  return new Diagnostics({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  });
}

interface InvalidPackCase {
  readonly name: string;
  readonly intendedId?: string;
  readonly create: () => unknown;
}

const invalidPackCases: readonly InvalidPackCase[] = [
  {
    name: "an unreadable id",
    create: () =>
      Object.defineProperty({ target: { package: "example" }, en: {} }, "id", {
        enumerable: true,
        get(): never {
          throw new Error("id unavailable");
        },
      }),
  },
  {
    name: "a blank id",
    create: () => ({
      id: "   ",
      target: { package: "example" },
      en: {},
    }),
  },
  {
    name: "an unreadable English dictionary",
    intendedId: "throwing-en",
    create: () =>
      Object.defineProperty(
        { id: "throwing-en", target: { package: "example" } },
        "en",
        {
          enumerable: true,
          get(): never {
            throw new Error("en unavailable");
          },
        },
      ),
  },
  {
    name: "a hostile English dictionary enumeration",
    intendedId: "hostile-en",
    create: () => ({
      id: "hostile-en",
      target: { package: "example" },
      en: new Proxy(
        {},
        {
          ownKeys(): never {
            throw new Error("locale enumeration unavailable");
          },
        },
      ),
    }),
  },
  {
    name: "a hostile namespace dictionary enumeration",
    intendedId: "hostile-namespace",
    create: () => ({
      id: "hostile-namespace",
      target: { package: "example" },
      en: {
        composer: new Proxy(
          {},
          {
            ownKeys(): never {
              throw new Error("namespace enumeration unavailable");
            },
          },
        ),
      },
    }),
  },
  {
    name: "a non-string translation value",
    intendedId: "non-string-value",
    create: () => ({
      id: "non-string-value",
      target: { package: "example" },
      en: { composer: { send: 42 } },
    }),
  },
  {
    name: "an array English dictionary",
    intendedId: "array-en",
    create: () => ({
      id: "array-en",
      target: { package: "example" },
      en: [{ send: "Send" }],
    }),
  },
  {
    name: "an array namespace dictionary",
    intendedId: "array-namespace",
    create: () => ({
      id: "array-namespace",
      target: { package: "example" },
      en: { composer: ["Send"] },
    }),
  },
];

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
