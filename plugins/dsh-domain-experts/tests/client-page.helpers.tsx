import { render, type RenderResult } from "@testing-library/react";
import {
  DomainExpertsPage,
  type DomainExpertsApi,
} from "../src/client/DomainExpertsPage.js";
import type { ApiOutcome } from "../src/client/remote.js";
import {
  emptyDomainDraft,
  type CatalogInfo,
  type DomainDefinition,
  type DomainSummary,
  type ResolvedExpertProfile,
} from "../src/types.js";

export const CATALOG: CatalogInfo = {
  scopeProviders: [
    {
      id: "filesystem",
      title: "Filesystem",
      enforcement: "advisory",
      builtin: true,
    },
  ],
  memoryProviders: [
    { id: "builtin", title: "Built-in storage", builtin: true },
  ],
  workers: [
    {
      id: "code_worker",
      title: "Code worker",
      capabilities: [],
      enforces: ["filesystem"],
      builtin: false,
    },
  ],
  tools: [{ name: "domain_expert", provider: "@yadsh/dsh-domain-experts" }],
  memoryNamespaces: [],
};

export const SUMMARY: DomainSummary = {
  id: "payments",
  name: "Payments",
  description: "Payment processing and settlement.",
  enabled: true,
  icon: "",
  color: "",
  primaryPaths: 1,
  sharedPaths: 1,
  memoryNamespaces: 1,
  tools: 2,
  degradations: 0,
  updatedAt: 10,
};

export const DEFINITION: DomainDefinition = {
  ...emptyDomainDraft("payments", 10),
  name: "Payments",
  description: "Payment processing and settlement.",
  persona: { instructions: "Prefer the ledger." },
  scope: {
    filesystem: {
      primary: ["services/payments/**"],
      sharedReadOnly: ["packages/common/**"],
      denied: [],
    },
    documentation: { include: [], exclude: [] },
    providers: {},
  },
};

export const PROFILE: ResolvedExpertProfile = {
  domainId: "payments",
  name: "Payments",
  description: "Payment processing and settlement.",
  enabled: true,
  basePolicy: "You are the designated expert for one domain.",
  customInstructions: "Prefer the ledger.",
  persona:
    "You are the designated expert for one domain.\n## Scope\n- services/payments/**",
  scope: {
    domainId: "payments",
    filesystem: {
      primary: ["services/payments/**"],
      sharedReadOnly: [],
      denied: [],
    },
    knowledge: { include: [], exclude: [] },
    external: {},
    memory: { namespace: "domain/payments", sharedNamespaces: [] },
  },
  resources: [
    {
      path: "services/payments/**",
      class: "primary",
      enforcement: "enforced",
      enforcedBy: ["code_worker"],
      provider: "filesystem",
      note: "Owned by this domain.",
    },
    {
      path: "packages/common/**",
      class: "shared",
      enforcement: "advisory",
      enforcedBy: [],
      provider: "filesystem",
      note: "Cross-domain resource.",
    },
  ],
  memory: [
    {
      namespace: "domain/payments",
      access: "read-write",
      enforcement: "enforced",
      provider: "namespace",
      note: "",
    },
  ],
  tools: [
    {
      name: "domain_expert",
      kind: "infrastructure",
      available: true,
      note: "Provided by this plugin.",
    },
    {
      name: "code_worker",
      kind: "worker",
      available: true,
      note: "Code worker; enforces filesystem",
    },
  ],
  toolFilter: { allow: ["domain_expert", "code_worker"], deny: [] },
  delegation: {
    mode: "expert-only",
    allowCrossDomain: true,
    targets: [],
    maxDepth: 3,
    maxParallel: 3,
    peers: [{ domainId: "inventory", mode: "expert-only", allowed: true }],
  },
  model: DEFINITION.model,
  providers: [],
  degradations: [],
  depthBudget: 3,
  resolvedAt: 20,
};

export function ok<T>(data: T): ApiOutcome<T> {
  return { ok: true, data };
}

export function apiOf(
  overrides: Partial<DomainExpertsApi> = {},
): DomainExpertsApi {
  return {
    listDomains: () => Promise.resolve(ok({ domains: [SUMMARY] })),
    getDomain: () => Promise.resolve(ok({ domain: DEFINITION })),
    draftDomain: () => Promise.resolve(ok({ domain: DEFINITION })),
    inspectDraft: () =>
      Promise.resolve(
        ok({
          ok: true,
          code: "",
          message: "",
          definition: DEFINITION,
          issues: [],
        }),
      ),
    createDomain: () => Promise.resolve(ok({ domain: DEFINITION })),
    updateDomain: () => Promise.resolve(ok({ domain: DEFINITION })),
    setDomainEnabled: () => Promise.resolve(ok({ domain: DEFINITION })),
    deleteDomain: () => Promise.resolve(ok({ deleted: true })),
    resolveScope: () => Promise.resolve(ok({ profile: PROFILE })),
    catalog: () => Promise.resolve(ok(CATALOG)),
    inspectMemory: () =>
      Promise.resolve(
        ok({
          ok: true,
          code: "",
          message: "",
          namespaces: [
            { namespace: "domain/payments", access: "read-write", records: 1 },
          ],
          records: [
            {
              namespace: "domain/payments",
              key: "cutoff",
              text: "Settlement closes at 14:00.",
              tags: [],
              createdAt: 1,
              updatedAt: 2,
            },
          ],
        }),
      ),
    clearMemory: () => Promise.resolve(ok({ cleared: 1 })),
    testExpert: () =>
      Promise.resolve(
        ok({
          result: {
            summary: "The batch aborts.",
            status: "completed",
            findings: [],
          },
        }),
      ),
    ...overrides,
  };
}

export function renderPage(
  overrides: Partial<DomainExpertsApi> = {},
): RenderResult {
  return render(
    <DomainExpertsPage
      api={apiOf(overrides)}
      currentSessionId={() => "session-1"}
    />,
  );
}
