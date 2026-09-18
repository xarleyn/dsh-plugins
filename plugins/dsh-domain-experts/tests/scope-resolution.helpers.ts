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

export const CODE_WORKER: DomainWorker = {
  id: "code_worker",
  title: "Code worker",
  capabilities: ["read-files"],
  enforces: ["filesystem"],
  tool: "code_worker",
};

export const PAYMENTS = domainOf("payments", {
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

export interface Fixture {
  readonly dependencies: ResolverDependencies;
  readonly workers: WorkerRegistry;
  readonly scopeProviders: ScopeProviderRegistry;
  readonly memoryProviders: MemoryProviderRegistry;
  readonly domains: DomainRegistry;
}

export function fixtureOf(definitions: readonly DomainDefinition[]): Fixture {
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

export async function resolve(
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
