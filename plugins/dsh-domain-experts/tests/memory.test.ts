import { describe, expect, it } from "vitest";
import {
  BUILTIN_MEMORY_PROVIDER_ID,
  createBuiltinMemoryProvider,
  memoryKeyOf,
} from "../src/host/memory/builtin.js";
import { MemoryProviderRegistry } from "../src/host/memory/registry.js";
import { fixedClock, memoryRecordTableOf } from "./helpers/fakes.js";

function providerOf() {
  const table = memoryRecordTableOf();
  const provider = createBuiltinMemoryProvider(table, fixedClock());
  return { table, provider };
}

describe("builtin memory: writes", () => {
  it("stores a record under its namespace and key", async () => {
    const { table, provider } = providerOf();
    const record = await provider.remember("domain/payments", "cutoff", "The 14:00 batch is the cutoff.", ["settlement"]);
    expect(record.namespace).toBe("domain/payments");
    expect(record.key).toBe("cutoff");
    expect(record.tags).toEqual(["settlement"]);
    expect(table.get(memoryKeyOf("domain/payments", "cutoff"))).toEqual(record);
  });

  it("keeps createdAt across a rewrite and advances updatedAt", async () => {
    const { provider } = providerOf();
    const first = await provider.remember("domain/payments", "cutoff", "first");
    const second = await provider.remember("domain/payments", "cutoff", "second");
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
    expect(second.text).toBe("second");
  });

  it("refuses an empty key or empty text", async () => {
    const { provider } = providerOf();
    await expect(provider.remember("domain/payments", "  ", "text")).rejects.toThrowError(
      /non-empty key/u,
    );
    await expect(provider.remember("domain/payments", "key", "   ")).rejects.toThrowError(
      /non-empty text/u,
    );
  });

  it("deduplicates tags and drops blanks", async () => {
    const { provider } = providerOf();
    const record = await provider.remember("domain/payments", "k", "t", ["a", "a", " ", "b"]);
    expect(record.tags).toEqual(["a", "b"]);
  });
});

describe("builtin memory: namespace isolation", () => {
  it("never returns a record from another namespace", async () => {
    const { provider } = providerOf();
    await provider.remember("domain/payments", "shared-looking", "payments only");
    await provider.remember("domain/inventory", "inventory-secret", "inventory only");

    const payments = await provider.inspect("domain/payments");
    expect(payments.map((record) => record.key)).toEqual(["shared-looking"]);

    const scoped = await provider.retrieve({
      namespaces: ["domain/payments"],
      query: "inventory",
      limit: 10,
    });
    expect(scoped).toEqual([]);
  });

  it("refuses to delete a record through a foreign namespace key", async () => {
    const { provider } = providerOf();
    await provider.remember("domain/inventory", "secret", "not yours");
    await expect(provider.forget("domain/payments", "secret")).resolves.toBe(false);
    expect(await provider.inspect("domain/inventory")).toHaveLength(1);
  });

  it("clears only the requested namespace", async () => {
    const { provider } = providerOf();
    await provider.remember("domain/payments", "a", "1");
    await provider.remember("domain/payments", "b", "2");
    await provider.remember("domain/inventory", "c", "3");
    await expect(provider.clear("domain/payments")).resolves.toBe(2);
    expect(await provider.inspect("domain/payments")).toEqual([]);
    expect(await provider.inspect("domain/inventory")).toHaveLength(1);
  });

  it("lists namespaces that actually hold records", async () => {
    const { provider } = providerOf();
    await provider.remember("shared/product", "glossary", "terms");
    await provider.remember("domain/payments", "cutoff", "14:00");
    expect(provider.listNamespaces()).toEqual(["domain/payments", "shared/product"]);
  });
});

describe("builtin memory: retrieval", () => {
  it("ranks by term hits then recency", async () => {
    const { provider } = providerOf();
    await provider.remember("domain/payments", "one", "settlement batch");
    await provider.remember("domain/payments", "two", "settlement batch timeout");
    const found = await provider.retrieve({
      namespaces: ["domain/payments"],
      query: "settlement batch timeout",
      limit: 10,
    });
    expect(found[0]?.key).toBe("two");
  });

  it("searches tags as well as text", async () => {
    const { provider } = providerOf();
    await provider.remember("domain/payments", "k", "unrelated", ["settlement"]);
    const found = await provider.retrieve({
      namespaces: ["domain/payments"],
      query: "settlement",
      limit: 10,
    });
    expect(found).toHaveLength(1);
  });

  it("returns everything, most recent first, when the query is empty", async () => {
    const { provider } = providerOf();
    await provider.remember("domain/payments", "old", "a");
    await provider.remember("domain/payments", "new", "b");
    const found = await provider.retrieve({
      namespaces: ["domain/payments"],
      query: "",
      limit: 10,
    });
    expect(found.map((record) => record.key)).toEqual(["new", "old"]);
  });

  it("honours several namespaces at once", async () => {
    const { provider } = providerOf();
    await provider.remember("domain/payments", "a", "shared term");
    await provider.remember("shared/engineering", "b", "shared term");
    const found = await provider.retrieve({
      namespaces: ["domain/payments", "shared/engineering"],
      query: "shared term",
      limit: 10,
    });
    expect(found).toHaveLength(2);
  });

  it("caps the limit", async () => {
    const { provider } = providerOf();
    for (let index = 0; index < 5; index += 1) {
      await provider.remember("domain/payments", `k${String(index)}`, "term");
    }
    const found = await provider.retrieve({
      namespaces: ["domain/payments"],
      query: "term",
      limit: 2,
    });
    expect(found).toHaveLength(2);
  });
});

describe("memory provider registry", () => {
  it("reports the built-in provider", () => {
    const registry = new MemoryProviderRegistry();
    const dispose = registry.register(createBuiltinMemoryProvider(memoryRecordTableOf()));
    expect(registry.info()).toEqual([
      { id: BUILTIN_MEMORY_PROVIDER_ID, title: "Built-in storage", builtin: true },
    ]);
    dispose();
    expect(registry.list()).toEqual([]);
  });

  it("refuses a duplicate id and a malformed id", () => {
    const registry = new MemoryProviderRegistry();
    registry.register(createBuiltinMemoryProvider(memoryRecordTableOf()));
    expect(() => registry.register(createBuiltinMemoryProvider(memoryRecordTableOf()))).toThrowError(
      /already registered/u,
    );
    expect(() =>
      registry.register({ ...createBuiltinMemoryProvider(memoryRecordTableOf()), id: "Bad Id" }),
    ).toThrowError(/must match/u);
  });

  it("refuses a missing provider with a stable code", () => {
    const registry = new MemoryProviderRegistry();
    try {
      registry.require("openviking");
    } catch (error) {
      expect((error as { code: string }).code).toBe("MEMORY_PROVIDER_MISSING");
    }
  });
});
