import { describe, expect, it } from "vitest";
import { DomainRegistry } from "../src/host/registry.js";
import { ScopeProviderRegistry } from "../src/host/scopes/registry.js";
import type { ScopeProviderFormEdit } from "../src/types.js";
import {
  formProvider,
  futureFormProvider,
  headlessProvider,
} from "./fixtures/scope-provider-fixture.js";
import { catalogOf, domainOf } from "./helpers/fakes.js";

const opaque = ' { "experimental" : [1, 2] } ';
const legacy =
  '{"collection":"guide","unknown":{"large":9007199254740993,"decimal":1.123456789012345678901},"keep":true}';

function fixture(config = legacy) {
  const providers = new ScopeProviderRegistry();
  const unregister = providers.register(formProvider);
  providers.register(headlessProvider);
  providers.register(futureFormProvider);
  const draft = domainOf("inventory");
  const domain = {
    ...draft,
    scope: {
      ...draft.scope,
      providers: {
        "demo-docs": config,
        "headless-docs": opaque,
        "missing-docs": "legacy opaque payload",
        " legacy provider id ": "archived configuration",
        "future-form": opaque,
      },
    },
  };
  const domains = new DomainRegistry(catalogOf([[domain.id, domain]]));
  function save(
    fields: ScopeProviderFormEdit["fields"],
    revision = 3,
    providerId = "demo-docs",
  ) {
    return domains.update(domain, (draft, existing) =>
      providers.prepareEditorDraft(draft, existing, [
        { providerId, revision, fields },
      ]),
    );
  }
  return { providers, domains, domain, unregister, save };
}

describe("provider-owned forms", () => {
  it("projects registered schemas and a read-only marker for a future form; unregister removes it", () => {
    const { providers, unregister } = fixture();
    expect(providers.info()).toMatchObject([
      { id: "demo-docs", form: formProvider.configForm },
      { id: "future-form", form: { version: 9, fields: [] } },
      { id: "headless-docs", form: null },
    ]);
    unregister();
    expect(providers.info().map(({ id }) => id)).toEqual([
      "future-form",
      "headless-docs",
    ]);
  });

  it("writes all changes together and preserves unknown fields, precision and schema-less documents", async () => {
    const { domain, save } = fixture();
    const updated = await save([
      { key: "collection", value: "handbook" },
      { key: "depth", value: "4" },
      { key: "includeDrafts", value: "false" },
      { key: "mode", value: "titles" },
    ]);
    const configs = updated.scope.providers;
    expect(configs).toEqual({
      ...domain.scope.providers,
      "demo-docs": expect.any(String),
    });
    expect(JSON.parse(configs["demo-docs"]!)).toMatchObject({
      collection: "handbook",
      keep: true,
      schemaVersion: 2,
      depth: 4,
      includeDrafts: false,
      mode: "titles",
    });
    expect(configs["demo-docs"]).toContain(
      '"unknown":{"large":9007199254740993,"decimal":1.123456789012345678901}',
    );
  });

  it("keeps the latest opaque documents when another operator updates them before saving", async () => {
    const { domain, domains, save } = fixture();
    const concurrent = domains.update({
      ...domain,
      scope: {
        ...domain.scope,
        providers: {
          ...domain.scope.providers,
          "headless-docs": "new opaque bytes",
        },
      },
    });
    const updated = await save([{ key: "collection", value: "handbook" }]);
    await concurrent;
    expect(updated.scope.providers["headless-docs"]).toBe("new opaque bytes");
  });

  it("requires the provider JSON and schema revision that the form was opened with", async () => {
    const { domain, domains, save } = fixture();
    await expect(
      save([{ key: "collection", value: "handbook" }], 1),
    ).rejects.toMatchObject({ code: "PROVIDER_CONFIG_STALE" });
    await domains.update({
      ...domain,
      scope: {
        ...domain.scope,
        providers: {
          ...domain.scope.providers,
          "demo-docs": '{"collection":"concurrent"}',
        },
      },
    });
    await expect(
      save([{ key: "collection", value: "handbook" }]),
    ).rejects.toMatchObject({ code: "PROVIDER_CONFIG_STALE" });
    expect(domains.get(domain.id)?.scope.providers["demo-docs"]).toBe(
      '{"collection":"concurrent"}',
    );
  });

  it.each([
    [{ key: "depth", value: "2.5" }],
    [{ key: "mode", value: "fabricated" }],
    [{ key: "unknown", value: "changed" }],
    [{ key: "collection", value: "reserved" }],
    [{ key: "collection", value: "" }],
  ])(
    "rejects invalid or provider-rejected edits without writing any definition",
    async (edit) => {
      const { domain, domains, save } = fixture();
      await expect(save([edit])).rejects.toMatchObject({
        code: "PROVIDER_CONFIG_INVALID",
      });
      expect(domains.get(domain.id)).toBe(domain);
    },
  );

  it("allows unrelated edits while unsupported and unregistered configurations remain opaque", async () => {
    const { domain, domains, providers, save } = fixture(
      '{"schemaVersion":999,"collection":"from a later format"}',
    );
    await expect(
      save([{ key: "collection", value: "handbook" }]),
    ).rejects.toMatchObject({ code: "PROVIDER_CONFIG_READ_ONLY" });
    for (const providerId of ["future-form", "headless-docs", "missing-docs"]) {
      const revision = providerId === "future-form" ? 1 : 3;
      await expect(
        save([{ key: "collection", value: "handbook" }], revision, providerId),
      ).rejects.toMatchObject({ code: "PROVIDER_CONFIG_READ_ONLY" });
    }
    const saved = await domains.update(
      { ...domain, name: "Updated domain" },
      (draft, existing) => providers.prepareEditorDraft(draft, existing, []),
    );
    expect(saved.name).toBe("Updated domain");
    expect(saved.scope.providers).toEqual(domain.scope.providers);
  });
});
