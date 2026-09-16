import { describe, expect, it } from "vitest";
import type { ResolverDependencies } from "../src/host/resolver.js";
import { DomainRegistry } from "../src/host/registry.js";
import { createBuiltinMemoryProvider } from "../src/host/memory/builtin.js";
import { MemoryProviderRegistry } from "../src/host/memory/registry.js";
import { resolveExpert } from "../src/host/resolver.js";
import { createFilesystemProvider } from "../src/host/scopes/filesystem.js";
import { ScopeProviderRegistry } from "../src/host/scopes/registry.js";
import {
  WorkerRegistry,
  type DomainWorker,
} from "../src/host/workers/registry.js";
import type { DomainDefinition } from "../src/types.js";
import {
  domainOf,
  domainTableOf,
  fixedClock,
  memoryRecordTableOf,
} from "./helpers/fakes.js";

const CODE_WORKER: DomainWorker = {
  id: "code_worker",
  title: "Code worker",
  capabilities: ["read-files"],
  enforces: ["filesystem"],
  tool: "code_worker",
};

const PAYMENTS = domainOf("payments", {
  name: "Payments",
  description: "Payment processing and settlement.",
  scope: {
    filesystem: {
      primary: ["services/payments/**"],
      sharedReadOnly: ["packages/common/**"],
      denied: ["services/inventory/**"],
    },
    documentation: {
      include: ["docs/payments/**"],
      exclude: ["docs/legacy/**"],
    },
    providers: {},
  },
  memory: { namespace: "domain/payments", sharedReadOnly: ["shared/product"] },
  tools: { allow: ["code_worker"], deny: [] },
});

interface Fixture {
  readonly dependencies: ResolverDependencies;
  readonly workers: WorkerRegistry;
  readonly scopeProviders: ScopeProviderRegistry;
  readonly memoryProviders: MemoryProviderRegistry;
  readonly domains: DomainRegistry;
}

function fixtureOf(definitions: readonly DomainDefinition[]): Fixture {
  const clock = fixedClock();
  const domains = new DomainRegistry(
    domainTableOf(
      definitions.map((definition) => [definition.id, definition] as const),
    ),
    clock,
  );
  const scopeProviders = new ScopeProviderRegistry();
  scopeProviders.register(createFilesystemProvider());
  const memoryProviders = new MemoryProviderRegistry();
  memoryProviders.register(
    createBuiltinMemoryProvider(memoryRecordTableOf(), clock),
  );
  const workers = new WorkerRegistry();
  return {
    dependencies: {
      domains,
      scopeProviders,
      memoryProviders,
      workers,
      memoryProviderId: "builtin",
      recallLimit: 5,
    },
    workers,
    scopeProviders,
    memoryProviders,
    domains,
  };
}

async function resolve(
  fixture: Fixture,
  definition: DomainDefinition,
  callerDomain: string | null = null,
  depth = 1,
) {
  return await resolveExpert(fixture.dependencies, {
    definition,
    workspaceDir: "/repo",
    callerDomain,
    depth,
  });
}

describe("scope resolution: filesystem resources", () => {
  it("lists the three resource classes", async () => {
    const fixture = fixtureOf([PAYMENTS]);
    const profile = await resolve(fixture, PAYMENTS);
    expect(
      profile.resources.map((resource) => [resource.class, resource.path]),
    ).toEqual([
      ["primary", "services/payments/**"],
      ["shared", "packages/common/**"],
      ["denied", "services/inventory/**"],
    ]);
  });

  it("reports advisory enforcement while no worker applies the scope", async () => {
    const fixture = fixtureOf([PAYMENTS]);
    const profile = await resolve(fixture, PAYMENTS);
    expect(
      profile.resources.every(
        (resource) => resource.enforcement === "advisory",
      ),
    ).toBe(true);
    expect(profile.providers[0]).toMatchObject({
      id: "filesystem",
      registered: true,
    });
  });

  it("reports enforced as soon as a selected worker claims it", async () => {
    const fixture = fixtureOf([PAYMENTS]);
    fixture.workers.register(CODE_WORKER);
    const profile = await resolve(fixture, PAYMENTS);
    expect(
      profile.resources.every(
        (resource) => resource.enforcement === "enforced",
      ),
    ).toBe(true);
    expect(profile.resources[0]?.enforcedBy).toEqual(["code_worker"]);
  });

  it("stays advisory when the enforcing worker is denied", async () => {
    const fixture = fixtureOf([
      domainOf("payments", {
        ...PAYMENTS,
        tools: { allow: ["code_worker"], deny: ["code_worker"] },
      }),
    ]);
    fixture.workers.register(CODE_WORKER);
    const profile = await resolve(fixture, fixture.domains.require("payments"));
    expect(
      profile.resources.every(
        (resource) => resource.enforcement === "advisory",
      ),
    ).toBe(true);
  });

  it("carries the knowledge scope into the resolved scope", async () => {
    const fixture = fixtureOf([PAYMENTS]);
    const profile = await resolve(fixture, PAYMENTS);
    expect(profile.scope.knowledge).toEqual({
      include: ["docs/payments/**"],
      exclude: ["docs/legacy/**"],
    });
  });
});

describe("scope resolution: memory namespaces", () => {
  it("grants read/write on the private namespace and read-only on shared ones", async () => {
    const fixture = fixtureOf([PAYMENTS]);
    const profile = await resolve(fixture, PAYMENTS);
    expect(
      profile.memory.map((entry) => [entry.namespace, entry.access]),
    ).toEqual([
      ["domain/payments", "read-write"],
      ["shared/product", "read-only"],
    ]);
    expect(profile.scope.memory).toEqual({
      namespace: "domain/payments",
      sharedNamespaces: ["shared/product"],
    });
  });

  it("adds explicitly configured foreign namespaces in direct-read mode only", async () => {
    const base = domainOf("payments", {
      ...PAYMENTS,
      delegation: {
        ...PAYMENTS.delegation,
        crossDomainMode: "direct-read",
        directRead: ["domain/inventory"],
      },
    });
    const fixture = fixtureOf([base]);
    const profile = await resolve(fixture, base);
    expect(profile.memory.map((entry) => entry.namespace)).toEqual([
      "domain/payments",
      "shared/product",
      "domain/inventory",
    ]);

    const expertOnly = {
      ...base,
      delegation: { ...base.delegation, crossDomainMode: "expert-only" },
    };
    const second = await resolve(fixture, expertOnly as DomainDefinition);
    expect(second.memory.map((entry) => entry.namespace)).toEqual([
      "domain/payments",
      "shared/product",
    ]);
  });

  it("degrades when the configured memory provider is absent", async () => {
    const fixture = fixtureOf([PAYMENTS]);
    const profile = await resolveExpert(
      { ...fixture.dependencies, memoryProviderId: "openviking" },
      { definition: PAYMENTS, workspaceDir: "", callerDomain: null, depth: 1 },
    );
    expect(profile.degradations.map((item) => item.code)).toContain(
      "MEMORY_PROVIDER_MISSING",
    );
  });
});

describe("scope resolution: tools", () => {
  it("always offers the plugin's own tools", async () => {
    const fixture = fixtureOf([PAYMENTS]);
    const profile = await resolve(fixture, PAYMENTS);
    const names = profile.tools.map((tool) => tool.name);
    expect(names).toContain("domain_expert");
    expect(names).toContain("domain_memory");
    expect(profile.toolFilter.allow).toContain("domain_expert");
    expect(profile.toolFilter.allow).toContain("domain_memory");
  });

  it("maps the design's domain_delegate alias onto the real tool", async () => {
    const definition = domainOf("payments", {
      tools: { allow: ["domain_delegate"], deny: [] },
    });
    const fixture = fixtureOf([definition]);
    const profile = await resolve(fixture, definition);
    expect(profile.toolFilter.allow).toContain("domain_expert");
    expect(profile.toolFilter.allow).not.toContain("domain_delegate");
    expect(
      profile.tools.find((tool) => tool.name === "domain_delegate")?.note,
    ).toContain("Alias");
  });

  it("flags an unverifiable tool name but keeps it in the filter", async () => {
    const definition = domainOf("payments", {
      tools: { allow: ["bash"], deny: [] },
    });
    const fixture = fixtureOf([definition]);
    const profile = await resolve(fixture, definition);
    expect(profile.toolFilter.allow).toContain("bash");
    expect(profile.degradations.map((item) => item.code)).toContain(
      "TOOL_UNVERIFIED",
    );
  });

  it("removes a denied tool from the filter and the visible list", async () => {
    const definition = domainOf("payments", {
      tools: { allow: ["bash", "code_worker"], deny: ["bash"] },
    });
    const fixture = fixtureOf([definition]);
    fixture.workers.register(CODE_WORKER);
    const profile = await resolve(fixture, definition);
    expect(profile.toolFilter.allow).not.toContain("bash");
    expect(profile.toolFilter.allow).toContain("code_worker");
    expect(profile.tools.map((tool) => tool.name)).not.toContain("bash");
  });

  it("reports a worker that has no tool binding as unavailable", async () => {
    const definition = domainOf("payments", {
      tools: { allow: ["jira_worker"], deny: [] },
    });
    const fixture = fixtureOf([definition]);
    fixture.workers.register({
      id: "jira_worker",
      title: "Jira worker",
      capabilities: ["search"],
      enforces: [],
      tool: "",
    });
    const profile = await resolve(fixture, definition);
    expect(
      profile.tools.find((tool) => tool.name === "jira_worker")?.available,
    ).toBe(false);
    expect(profile.degradations.map((item) => item.code)).toContain(
      "WORKER_UNAVAILABLE",
    );
  });
});

describe("scope resolution: degradation", () => {
  it("reports an unregistered scope provider and keeps its config inert", async () => {
    const definition = domainOf("payments", {
      scope: {
        ...PAYMENTS.scope,
        providers: { jira: '{"projects":["PAY"]}' },
      },
    });
    const fixture = fixtureOf([definition]);
    const profile = await resolve(fixture, definition);
    expect(profile.degradations.map((item) => item.code)).toContain(
      "SCOPE_PROVIDER_MISSING",
    );
    const jira = profile.providers.find((provider) => provider.id === "jira");
    expect(jira).toMatchObject({ registered: false, enforcement: "advisory" });
  });

  it("calls a registered provider and carries its external scope", async () => {
    const definition = domainOf("payments", {
      scope: { ...PAYMENTS.scope, providers: { wiki: '{"spaces":["PAY"]}' } },
    });
    const fixture = fixtureOf([definition]);
    fixture.scopeProviders.register({
      id: "wiki",
      title: "Wiki",
      enforcement: "advisory",
      builtin: false,
      validate: () => undefined,
      describe: () => "1 space",
      apply: () =>
        Promise.resolve({ resources: [], external: '{"spaces":["PAY"]}' }),
    });
    const profile = await resolve(fixture, definition);
    expect(profile.scope.external["wiki"]).toBe('{"spaces":["PAY"]}');
    expect(
      profile.providers.find((provider) => provider.id === "wiki")?.registered,
    ).toBe(true);
  });

  it("degrades a provider that refuses its own configuration", async () => {
    const definition = domainOf("payments", {
      scope: { ...PAYMENTS.scope, providers: { wiki: "not json" } },
    });
    const fixture = fixtureOf([definition]);
    fixture.scopeProviders.register({
      id: "wiki",
      title: "Wiki",
      enforcement: "advisory",
      builtin: false,
      validate: () => {
        throw new Error("expected a JSON document");
      },
      describe: () => "",
      apply: () => Promise.resolve({ resources: [], external: "" }),
    });
    const profile = await resolve(fixture, definition);
    const degradation = profile.degradations.find(
      (item) => item.code === "SCOPE_PROVIDER_MISSING",
    );
    expect(degradation?.message).toContain("expected a JSON document");
  });
});

describe("scope resolution: delegation", () => {
  it("lists the other enabled domains as peers", async () => {
    const fixture = fixtureOf([
      PAYMENTS,
      domainOf("inventory", { name: "Inventory" }),
      domainOf("platform", { name: "Platform", enabled: false }),
    ]);
    const profile = await resolve(fixture, PAYMENTS);
    expect(profile.delegation.peers.map((peer) => peer.domainId)).toEqual([
      "inventory",
    ]);
    expect(profile.delegation.mode).toBe("expert-only");
  });

  it("restricts peers to the configured target list", async () => {
    const definition = domainOf("payments", {
      ...PAYMENTS,
      delegation: { ...PAYMENTS.delegation, targets: ["inventory"] },
    });
    const fixture = fixtureOf([
      definition,
      domainOf("inventory"),
      domainOf("platform"),
    ]);
    const profile = await resolve(fixture, definition);
    expect(profile.delegation.peers.map((peer) => peer.domainId)).toEqual([
      "inventory",
    ]);
  });

  it("degrades a target that is missing or disabled", async () => {
    const definition = domainOf("payments", {
      ...PAYMENTS,
      delegation: { ...PAYMENTS.delegation, targets: ["inventory"] },
    });
    const fixture = fixtureOf([definition]);
    const profile = await resolve(fixture, definition);
    expect(profile.degradations.map((item) => item.code)).toContain(
      "DELEGATION_TARGET_MISSING",
    );
  });

  it("reports the mode as disabled when cross-domain access is off", async () => {
    const definition = domainOf("payments", {
      ...PAYMENTS,
      delegation: { ...PAYMENTS.delegation, allowCrossDomain: false },
    });
    const fixture = fixtureOf([definition, domainOf("inventory")]);
    const profile = await resolve(fixture, definition);
    expect(profile.delegation.mode).toBe("disabled");
    expect(profile.delegation.peers[0]?.allowed).toBe(false);
  });

  it("carries the depth budget into the profile", async () => {
    const fixture = fixtureOf([PAYMENTS]);
    const profile = await resolve(fixture, PAYMENTS);
    expect(profile.depthBudget).toBe(3);
  });
});

describe("scope resolution: persona wiring", () => {
  it("composes a persona that names the caller domain and the depth", async () => {
    const fixture = fixtureOf([PAYMENTS]);
    const profile = await resolve(fixture, PAYMENTS, "inventory", 2);
    expect(profile.persona).toContain('asked by the "inventory" expert');
    expect(profile.persona).toContain("Delegation depth: 2 of at most 3");
    expect(profile.basePolicy.startsWith("You are the designated expert")).toBe(
      true,
    );
  });

  it("recalls memory into the persona for a real task", async () => {
    const fixture = fixtureOf([PAYMENTS]);
    const provider = fixture.memoryProviders.require("builtin");
    await provider.remember(
      "domain/payments",
      "cutoff",
      "The settlement cutoff is 14:00.",
    );
    const profile = await resolveExpert(
      fixture.dependencies,
      {
        definition: PAYMENTS,
        workspaceDir: "",
        callerDomain: null,
        depth: 1,
      },
      {
        task: "When does settlement close?",
        context: "",
        output: "",
        mode: "answer",
        background: false,
      },
    );
    expect(profile.persona).toContain("The settlement cutoff is 14:00.");
  });

  it("does not recall memory for the preview profile", async () => {
    const fixture = fixtureOf([PAYMENTS]);
    const provider = fixture.memoryProviders.require("builtin");
    await provider.remember(
      "domain/payments",
      "cutoff",
      "The settlement cutoff is 14:00.",
    );
    const profile = await resolve(fixture, PAYMENTS);
    expect(profile.persona).not.toContain("The settlement cutoff is 14:00.");
    expect(profile.persona).toContain("preview");
  });
});
