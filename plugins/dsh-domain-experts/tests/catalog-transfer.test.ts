import { describe, expect, it, vi } from "vitest";
import type { DomainDefinition } from "../src/types.js";
import { DomainRegistry } from "../src/host/registry.js";
import {
  catalogStoreOf,
  type DomainExpertsStorage,
} from "../src/host/storage.js";
import {
  catalogGlobalOf,
  catalogOf,
  domainOf,
  domainTableOf,
  memoryRecordTableOf,
} from "./helpers/fakes.js";

function registry(...entries: DomainDefinition[]): DomainRegistry {
  return new DomainRegistry(
    catalogOf(entries.map((domain) => [domain.id, domain])),
    () => 9_000,
  );
}

describe("portable catalog", () => {
  it("exports stable JSON and round trips the supported fields and domain IDs", async () => {
    const draft = domainOf("payments");
    const source = registry(
      domainOf("payments", {
        name: "Payments",
        description: "Payment flows",
        enabled: false,
        persona: { instructions: "Read the design before reviewing." },
        scope: {
          ...draft.scope,
          filesystem: { primary: ["src/**"], denied: [], sharedReadOnly: [] },
          documentation: { include: ["invoice guide"], exclude: [] },
          providers: { "local-docs": '{"credential":"demo-private-value"}' },
        },
        memory: {
          namespace: "domain/payments",
          sharedReadOnly: ["shared/handbook"],
        },
        tools: { allow: ["read_document"], deny: ["write_document"] },
        delegation: { ...draft.delegation, targets: ["inventory"] },
        model: {
          inherit: false,
          provider: "demo-provider",
          model: "demo-reviewer",
          reasoningEffort: "high",
          maxTokens: 1024,
        },
      }),
      domainOf("inventory"),
    );
    const text = source.exportCatalog();
    expect(JSON.parse(text)).toMatchObject({
      format: "dsh-domain-catalog",
      version: 1,
      domains: [{ id: "inventory" }, { id: "payments" }],
    });
    expect(text).not.toMatch(
      /providers|credential|demo-private-value|createdAt|updatedAt/u,
    );

    const target = registry();
    const { token } = target.previewImport(text, "merge");
    expect(target.list()).toEqual([]);
    await expect(target.applyImport(text, "merge", token)).resolves.toBe(2);
    expect(target.exportCatalog()).toBe(text);
    expect(target.get("payments")?.scope.providers).toEqual({});
  });

  it("previews merge conflicts and replacement removals before modifying the catalog", async () => {
    const original = domainOf("payments");
    const installed = registry(
      domainOf("payments", {
        description: "Installed",
        scope: { ...original.scope, providers: { "local-docs": "{}" } },
      }),
      domainOf("legacy"),
    );
    const text = registry(
      domainOf("payments", { description: "Replacement" }),
      domainOf("inventory"),
    ).exportCatalog();
    const merge = installed.previewImport(text, "merge");
    expect(merge.changes).toEqual([
      { id: "inventory", action: "add" },
      { id: "payments", action: "keep" },
    ]);
    expect(installed.knownIds()).toEqual(["legacy", "payments"]);
    await expect(
      installed.applyImport(text, "merge", merge.token),
    ).resolves.toBe(1);
    expect(installed.get("payments")?.description).toBe("Installed");

    const replace = installed.previewImport(text, "replace");
    expect(replace.changes).toEqual([
      { id: "inventory", action: "unchanged" },
      { id: "legacy", action: "remove" },
      { id: "payments", action: "update" },
    ]);
    await expect(
      installed.applyImport(text, "replace", replace.token),
    ).resolves.toBe(2);
    expect(installed.knownIds()).toEqual(["inventory", "payments"]);
    expect(installed.get("payments")).toMatchObject({
      description: "Replacement",
      scope: { providers: { "local-docs": "{}" } },
      createdAt: original.createdAt,
      updatedAt: 9_000,
    });
  });

  it("rejects malformed, duplicate, unsupported and non-portable entries without changing state", () => {
    const target = registry(domainOf("inventory"));
    const text = target.exportCatalog();
    const parsed = JSON.parse(text) as { domains: unknown[] };
    const [domain] = parsed.domains;
    for (const document of [
      "{",
      JSON.stringify({ ...parsed, format: "invalid-catalog", domains: [] }),
      text.replace('"version": 1', '"version": 999'),
      JSON.stringify({
        format: "dsh-domain-catalog",
        version: 1,
        domains: [domain, domain],
      }),
      text.replace('"id": "inventory"', '"id": "shared"'),
      text.replace(
        '"name": "inventory"',
        '"name": "inventory", "password": "demo"',
      ),
    ]) {
      expect(() => target.previewImport(document, "replace")).toThrow();
      expect(target.exportCatalog()).toBe(text);
    }
  });

  it("refuses credential-like free text without echoing it or altering the source definition", () => {
    const secretText =
      "Review endpoint https://demo:demo-secret@example.invalid";
    const original = registry(
      domainOf("inventory", {
        persona: { instructions: secretText },
      }),
    );
    expect(() => original.exportCatalog()).toThrow(
      expect.objectContaining({ code: "CATALOG_SENSITIVE_CONTENT" }),
    );
    expect(original.get("inventory")?.persona.instructions).toBe(secretText);
    const clean = registry(domainOf("inventory")).exportCatalog();
    expect(() =>
      registry().previewImport(
        clean.replace(
          '"instructions": ""',
          '"instructions": ' + JSON.stringify(secretText),
        ),
        "merge",
      ),
    ).toThrow(expect.objectContaining({ code: "CATALOG_SENSITIVE_CONTENT" }));
  });

  it("binds a preview to the exact file, mode, registry and last committed state", async () => {
    const target = registry(domainOf("inventory"));
    const text = registry(domainOf("payments")).exportCatalog();
    const { token } = target.previewImport(text, "replace");
    for (const operation of [
      target.applyImport(text + " ", "replace", token),
      target.applyImport(text, "merge", token),
      registry(domainOf("inventory")).applyImport(text, "replace", token),
    ]) {
      await expect(operation).rejects.toMatchObject({
        code: "CATALOG_PREVIEW_STALE",
      });
    }
    const pendingEdit = target.setEnabled("inventory", false);
    const pendingApply = target.applyImport(text, "replace", token);
    await pendingEdit;
    await expect(pendingApply).rejects.toMatchObject({
      code: "CATALOG_PREVIEW_STALE",
    });
    expect(target.knownIds()).toEqual(["inventory"]);
    expect(target.get("inventory")?.enabled).toBe(false);
  });

  it("keeps a legacy table and private memory readable until one catalog commit succeeds", async () => {
    const global = catalogGlobalOf();
    const tables = {
      domains: domainTableOf([["inventory", domainOf("inventory")]]),
      memory: memoryRecordTableOf(),
    };
    await tables.memory.put("domain/inventory::note", {
      namespace: "domain/inventory",
      key: "note",
      text: "Private note",
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    });
    const write = vi
      .fn(global.set)
      .mockRejectedValueOnce(new Error("disk full"));
    const storage = {
      global: { ...global, set: write },
      table: (name: keyof typeof tables) => tables[name],
    } as unknown as DomainExpertsStorage;
    const target = new DomainRegistry(catalogStoreOf(storage));
    const text = registry(
      domainOf("payments"),
      domainOf("returns"),
    ).exportCatalog();
    const { token } = target.previewImport(text, "replace");
    await expect(target.applyImport(text, "replace", token)).rejects.toThrow(
      "disk full",
    );
    expect(write).toHaveBeenCalledTimes(1);
    expect(global.get().domains).toBeNull();
    expect(target.knownIds()).toEqual(["inventory"]);
    await expect(target.applyImport(text, "replace", token)).resolves.toBe(3);
    const reopened = new DomainRegistry(catalogStoreOf(storage));
    expect(reopened.knownIds()).toEqual(["payments", "returns"]);
    expect(tables.domains.get("inventory")?.id).toBe("inventory");
    expect(tables.memory.get("domain/inventory::note")?.text).toBe(
      "Private note",
    );
    expect(reopened.exportCatalog()).not.toContain("Private note");
  });
});
