import {
  EXPERT_MODES,
  defaultMemoryNamespace,
  type CrossDomainMode,
  type DomainDefinition,
  type DomainDegradation,
  type DomainExpertRequest,
  type DomainScope,
  type ExpertMode,
  type MemoryRecord,
  type ResolvedDelegationEntry,
  type ResolvedExpertProfile,
  type ResolvedMemoryEntry,
  type ResolvedProviderEntry,
  type ResolvedResourceEntry,
  type ResolvedToolEntry,
} from "../types.js";
import { degradation } from "./errors.js";
import type { MemoryProviderRegistry } from "./memory/registry.js";
import { BASE_POLICY, composePersona, composeTask } from "./persona.js";
import type { DomainRegistry } from "./registry.js";
import type { ScopeProviderRegistry } from "./scopes/registry.js";
import type { WorkerRegistry } from "./workers/registry.js";

/** Tools the plugin registers itself and always keeps visible to an expert. */
export const EXPERT_INFRASTRUCTURE_TOOLS: readonly string[] = [
  "domain_expert",
  "domain_memory",
];

/**
 * Names accepted in a tool policy that map onto a real registered tool.
 *
 * `domain_delegate` is the design's word for expert-to-expert delegation;
 * this plugin realizes it through the same `domain_expert` tool, which
 * enforces the caller's cross-domain policy. The alias exists so a
 * configuration written against the design vocabulary is not reported as
 * degraded — but only the real name may reach the runtime's tool filter,
 * which rejects unknown names loudly.
 */
export const TOOL_ALIASES: Readonly<Record<string, string>> = {
  domain_delegate: "domain_expert",
};

/** Persona preview when no task has been supplied yet. */
const PREVIEW_REQUEST: DomainExpertRequest = {
  task: "(preview: the task text is supplied when the expert is run)",
  context: "",
  output: "",
  mode: "investigate",
  background: false,
};

export interface ResolveInput {
  readonly definition: DomainDefinition;
  /** Absolute session working directory; `''` when the caller has none. */
  readonly workspaceDir: string;
  /** Domain that started this expert, for the delegation chain. */
  readonly callerDomain: string | null;
  /** Delegation depth of the child that will run this profile. */
  readonly depth: number;
}

export interface ResolverDependencies {
  readonly domains: DomainRegistry;
  readonly scopeProviders: ScopeProviderRegistry;
  readonly memoryProviders: MemoryProviderRegistry;
  readonly workers: WorkerRegistry;
  readonly memoryProviderId: string;
  readonly recallLimit: number;
}

/**
 * Resolve a domain definition into everything a child needs, plus the honest
 * picture the inspector renders. One function serves both so the run path and
 * the UI cannot disagree about what is enforced.
 */
export async function resolveExpert(
  dependencies: ResolverDependencies,
  input: ResolveInput,
  request: DomainExpertRequest = PREVIEW_REQUEST,
): Promise<ResolvedExpertProfile> {
  const { definition } = input;
  const degradations: DomainDegradation[] = [];

  const selectedWorkers = dependencies.workers.selectedFor(
    definition.tools.allow,
    definition.tools.deny,
  );
  const fixtures: FixturePayload = {
    domain: definition,
    workspaceDir: input.workspaceDir,
    depth: input.depth,
    callerDomain: input.callerDomain,
  };

  const resources: ResolvedResourceEntry[] = [];
  const external: Record<string, string> = {};
  const providers: ResolvedProviderEntry[] = [];

  for (const provider of dependencies.scopeProviders.list()) {
    const config = definition.scope.providers[provider.id] ?? "";
    providers.push(dependencies.scopeProviders.entryOf(provider.id, config));
    try {
      provider.validate(config);
    } catch (error) {
      degradations.push(
        degradation(
          "SCOPE_PROVIDER_MISSING",
          `Scope provider "${provider.id}" refused its configuration: ${
            error instanceof Error ? error.message : String(error)
          }`,
          [provider.id],
        ),
      );
      continue;
    }
    const output = await provider.apply({
      ...fixtures,
      config,
      enforcedBy: dependencies.workers.enforcersOf(
        selectedWorkers,
        provider.id,
      ),
    });
    resources.push(...output.resources);
    if (output.external !== "") external[provider.id] = output.external;
  }

  for (const id of Object.keys(definition.scope.providers)) {
    if (dependencies.scopeProviders.get(id) !== undefined) continue;
    providers.push(
      dependencies.scopeProviders.entryOf(
        id,
        definition.scope.providers[id] ?? "",
      ),
    );
    degradations.push(
      degradation(
        "SCOPE_PROVIDER_MISSING",
        `Domain "${definition.id}" configures scope provider "${id}", but no provider with that id is registered; that configuration is inert.`,
        [id],
      ),
    );
  }
  if (resources.length === 0 && hasFilesystemScope(definition)) {
    // The filesystem provider is built in, so this only happens if a
    // deployment removed it. Say so instead of showing an empty scope.
    degradations.push(
      degradation(
        "SCOPE_PROVIDER_MISSING",
        "The built-in filesystem scope provider is not registered; filesystem restrictions are not read.",
        ["filesystem"],
      ),
    );
  }

  const memory = memoryEntries(definition);
  const memoryProvider = dependencies.memoryProviders.get(
    dependencies.memoryProviderId,
  );
  if (memoryProvider === undefined) {
    degradations.push(
      degradation(
        "MEMORY_PROVIDER_MISSING",
        `Memory provider "${dependencies.memoryProviderId}" is not registered; the expert runs without recalled notes.`,
        [dependencies.memoryProviderId],
      ),
    );
  }

  const tools = toolEntries(
    definition,
    dependencies,
    selectedWorkers,
    degradations,
  );
  const toolFilter = {
    allow: filterNamesOf(tools),
    deny: [...definition.tools.deny],
  };

  const delegation = delegationSummary(definition, dependencies, degradations);

  const memorySnippets = await recall(
    dependencies,
    memoryProvider,
    memory,
    request,
  );

  const scope: DomainScope = {
    domainId: definition.id,
    filesystem: definition.scope.filesystem,
    knowledge: {
      include: [...definition.scope.documentation.include],
      exclude: [...definition.scope.documentation.exclude],
    },
    external,
    memory: {
      namespace:
        memory.find((entry) => entry.access === "read-write")?.namespace ??
        defaultMemoryNamespace(definition.id),
      sharedNamespaces: memory
        .filter((entry) => entry.access === "read-only")
        .map((entry) => entry.namespace),
    },
  };

  const personaInput = {
    definition,
    resources,
    memory,
    memorySnippets,
    delegation,
    request,
    callerDomain: input.callerDomain,
    depth: input.depth,
  };
  const persona = composePersona(personaInput);
  const task = composeTask(personaInput);

  return {
    domainId: definition.id,
    name: definition.name,
    description: definition.description,
    enabled: definition.enabled,
    basePolicy: BASE_POLICY,
    customInstructions: definition.persona.instructions,
    persona,
    task,
    scope,
    resources,
    memory,
    tools,
    toolFilter,
    delegation,
    model: definition.model,
    providers,
    degradations,
    depthBudget: definition.delegation.maxDepth,
    resolvedAt: Date.now(),
  };
}

interface FixturePayload {
  readonly domain: DomainDefinition;
  readonly workspaceDir: string;
  readonly depth: number;
  readonly callerDomain: string | null;
}

function hasFilesystemScope(definition: DomainDefinition): boolean {
  const { primary, sharedReadOnly, denied } = definition.scope.filesystem;
  return primary.length + sharedReadOnly.length + denied.length > 0;
}

/**
 * Namespace access for one expert: its own namespace read/write, its shared
 * namespaces read-only, and — only in `direct-read` mode — the foreign
 * namespaces it explicitly listed.
 */
export function memoryEntries(
  definition: DomainDefinition,
): readonly ResolvedMemoryEntry[] {
  const own =
    definition.memory.namespace.trim() === ""
      ? defaultMemoryNamespace(definition.id)
      : definition.memory.namespace;
  const entries: ResolvedMemoryEntry[] = [
    {
      namespace: own,
      access: "read-write",
      enforcement: "enforced",
      provider: "namespace",
      note: "Private to this domain; the storage key layout keeps other namespaces out of reach.",
    },
  ];
  const readOnly = new Set(definition.memory.sharedReadOnly);
  if (definition.delegation.crossDomainMode === "direct-read") {
    for (const namespace of definition.delegation.directRead)
      readOnly.add(namespace);
  }
  for (const namespace of readOnly) {
    if (namespace === own) continue;
    entries.push({
      namespace,
      access: "read-only",
      enforcement: "enforced",
      provider: "namespace",
      note:
        definition.delegation.directRead.includes(namespace) &&
        !definition.memory.sharedReadOnly.includes(namespace)
          ? "Direct cross-domain read explicitly configured for this expert."
          : "Shared namespace; writes are refused.",
    });
  }
  return entries;
}

/** Namespaces an expert may read, in the order they are presented. */
export function readableNamespaces(
  entries: readonly ResolvedMemoryEntry[],
): readonly string[] {
  return entries.map((entry) => entry.namespace);
}

function toolEntries(
  definition: DomainDefinition,
  dependencies: ResolverDependencies,
  selectedWorkers: ReturnType<WorkerRegistry["selectedFor"]>,
  degradations: DomainDegradation[],
): readonly ResolvedToolEntry[] {
  const entries = new Map<string, ResolvedToolEntry>();
  const selectedByTool = new Map(
    selectedWorkers
      .filter((worker) => worker.tool !== "")
      .map((worker) => [worker.tool, worker]),
  );

  for (const name of definition.tools.allow) {
    const alias = TOOL_ALIASES[name];
    if (alias !== undefined) {
      entries.set(name, {
        name,
        kind: "infrastructure",
        available: true,
        note: `Alias of "${alias}", which is provided by this plugin.`,
      });
      continue;
    }
    const worker = dependencies.workers.get(name) ?? selectedByTool.get(name);
    if (worker !== undefined) {
      entries.set(name, {
        name,
        kind: "worker",
        available: true,
        note: `${worker.title}${
          worker.enforces.length > 0
            ? `; enforces ${worker.enforces.join(", ")}`
            : ""
        }`,
      });
      continue;
    }
    entries.set(name, {
      name,
      kind: "tool",
      available: true,
      note: "Global tool; the harness validates the name when the child starts.",
    });
  }

  for (const name of definition.tools.deny) {
    if (entries.has(name)) entries.delete(name);
  }

  const unavailable: string[] = [];
  for (const worker of dependencies.workers.list()) {
    if (!definition.tools.allow.includes(worker.id)) continue;
    if (worker.tool === "") {
      unavailable.push(worker.id);
      entries.set(worker.id, {
        name: worker.id,
        kind: "worker",
        available: false,
        note: `${worker.title} is registered without a tool binding and cannot be selected.`,
      });
    }
  }
  if (unavailable.length > 0) {
    degradations.push(
      degradation(
        "WORKER_UNAVAILABLE",
        `Worker${unavailable.length > 1 ? "s" : ""} ${unavailable
          .map((id) => `"${id}"`)
          .join(
            ", ",
          )} ${unavailable.length > 1 ? "are" : "is"} configured without a tool binding and cannot be selected.`,
        unavailable,
      ),
    );
  }

  for (const name of EXPERT_INFRASTRUCTURE_TOOLS) {
    if (definition.tools.deny.includes(name)) continue;
    entries.set(name, {
      name,
      kind: "infrastructure",
      available: true,
      note: "Provided by this plugin and always available to an expert.",
    });
  }

  const unverified = [...entries.values()]
    .filter((entry) => entry.kind === "tool")
    .map((entry) => entry.name);
  if (unverified.length > 0) {
    degradations.push(
      degradation(
        "TOOL_UNVERIFIED",
        `Tool${unverified.length > 1 ? "s" : ""} ${unverified
          .map((name) => `"${name}"`)
          .join(
            ", ",
          )} ${unverified.length > 1 ? "are" : "is"} not a registered worker; the name is passed to the harness as-is.`,
        unverified,
      ),
    );
  }

  return [...entries.values()].sort((left, right) =>
    left.name.localeCompare(right.name, "en"),
  );
}

/** Tool names that may reach the runtime's tool filter. */
export function filterNamesOf(
  entries: readonly ResolvedToolEntry[],
): readonly string[] {
  const names = new Set<string>();
  for (const entry of entries) {
    if (!entry.available) continue;
    names.add(TOOL_ALIASES[entry.name] ?? entry.name);
  }
  return [...names].sort((left, right) => left.localeCompare(right, "en"));
}

function delegationSummary(
  definition: DomainDefinition,
  dependencies: ResolverDependencies,
  degradations: DomainDegradation[],
): ResolvedExpertProfile["delegation"] {
  const mode: CrossDomainMode = definition.delegation.allowCrossDomain
    ? definition.delegation.crossDomainMode
    : "disabled";
  const peers: ResolvedDelegationEntry[] = [];
  const missing: string[] = [];

  for (const target of definition.delegation.targets) {
    const peer = dependencies.domains.get(target);
    if (peer === undefined || !peer.enabled) missing.push(target);
  }
  for (const domain of dependencies.domains.list()) {
    if (domain.id === definition.id) continue;
    if (!domain.enabled) continue;
    if (
      definition.delegation.targets.length > 0 &&
      !definition.delegation.targets.includes(domain.id)
    ) {
      continue;
    }
    peers.push({
      domainId: domain.id,
      mode,
      allowed: mode !== "disabled",
    });
  }
  if (missing.length > 0) {
    degradations.push(
      degradation(
        "DELEGATION_TARGET_MISSING",
        `Delegation target${missing.length > 1 ? "s" : ""} ${missing
          .map((id) => `"${id}"`)
          .join(
            ", ",
          )} ${missing.length > 1 ? "are" : "is"} missing or disabled.`,
        missing,
      ),
    );
  }

  return {
    mode,
    allowCrossDomain: definition.delegation.allowCrossDomain,
    targets: [...definition.delegation.targets],
    maxDepth: definition.delegation.maxDepth,
    maxParallel: definition.delegation.maxParallel,
    peers,
  };
}

async function recall(
  dependencies: ResolverDependencies,
  provider: ReturnType<MemoryProviderRegistry["get"]>,
  entries: readonly ResolvedMemoryEntry[],
  request: DomainExpertRequest,
): Promise<readonly MemoryRecord[]> {
  const query = `${request.task} ${request.context}`.trim();
  if (provider === undefined || query === "" || request === PREVIEW_REQUEST)
    return [];
  const namespaces = entries.map((entry) => entry.namespace);
  if (namespaces.length === 0) return [];
  try {
    return await provider.retrieve({
      namespaces,
      query,
      limit: dependencies.recallLimit,
    });
  } catch {
    // Recall is an enhancement: an unavailable backend must not fail the run.
    return [];
  }
}

/** Normalize a mode from untrusted input (tool args, imports). */
export function normalizeExpertMode(value: unknown): ExpertMode {
  return typeof value === "string" &&
    (EXPERT_MODES as readonly string[]).includes(value)
    ? (value as ExpertMode)
    : "investigate";
}
