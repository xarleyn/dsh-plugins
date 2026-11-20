import type { Context } from "@deepseek-ai/cordis";
import type { DomainScopeProvider } from "../../src/index.js";

export const formProvider: DomainScopeProvider = {
  id: "demo-docs",
  title: "Demo documentation",
  enforcement: "advisory",
  builtin: false,
  configForm: {
    version: 1,
    revision: 3,
    documentVersion: { key: "schemaVersion", current: 2 },
    fields: [
      {
        key: "collection",
        label: "Collection",
        kind: "text",
        required: true,
        options: [],
      },
      {
        key: "depth",
        label: "Search depth",
        kind: "integer",
        required: false,
        options: [],
      },
      {
        key: "includeDrafts",
        label: "Include drafts",
        kind: "boolean",
        required: false,
        options: [],
      },
      {
        key: "mode",
        label: "Search mode",
        kind: "choice",
        required: false,
        options: [
          { value: "titles", label: "Titles" },
          { value: "full", label: "Full text" },
        ],
      },
    ],
  },
  validate(config) {
    if (config === "") return;
    const value = JSON.parse(config) as { collection?: string };
    if (value.collection === "reserved")
      throw new Error("Reserved collection.");
  },
  describe: () => "Demo scope configuration.",
  apply: () => Promise.resolve({ resources: [], external: "" }),
};

export const headlessProvider: DomainScopeProvider = {
  id: "headless-docs",
  title: "Headless documentation",
  enforcement: "advisory",
  builtin: false,
  validate: () => {},
  describe: () => "Configured outside the form.",
  apply: () => Promise.resolve({ resources: [], external: "" }),
};

export const futureFormProvider: DomainScopeProvider = {
  ...formProvider,
  id: "future-form",
  title: "Future documentation",
  configForm: { version: 9, revision: 1, documentVersion: null, fields: [] },
};

export const name = "scope-provider-fixture";
export const inject = ["domainExperts"];

export function apply(ctx: Context): void {
  for (const provider of [formProvider, headlessProvider, futureFormProvider]) {
    ctx.effect(
      () => ctx.domainExperts.registerScopeProvider(provider),
      `scope-provider-fixture.${provider.id}`,
    );
  }
}
