/**
 * The expert catalog: what the plugin stores, exposes and reports.
 *
 * The "what exists" half of the plugin entry, cut out of it by #425: the
 * durable store the definitions and the memory records live in, the agent tools
 * handed to the runtime, and the projections the tools, the management UI and
 * the Remote contract read off them. Whether a catalog entry is acceptable is
 * the other half, in `validate.ts`; `index.ts` is the wiring that keeps the two
 * of them answering for one service.
 */
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { Context } from "@deepseek-ai/cordis";
import type {
  SubagentProvider,
  SubagentRun,
  SubagentStartRequest,
} from "@deepseek-ai/dsh-subagent";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import type { ResolvedConfig } from "./config.js";
import type { ExpertRunInput, SubagentsFace } from "./host/execution.js";
import { DomainExpertsError, errorMessageOf } from "./host/errors.js";
import type {
  DomainMemoryProvider,
  MemoryProviderRegistry,
} from "./host/memory/registry.js";
import type { MemoryTable } from "./host/memory/shared.js";
import {
  SQLITE_MEMORY_PROVIDER_ID,
  createSqliteMemoryProvider,
  type SqliteMemoryProvider,
} from "./host/memory/sqlite.js";
import { STORE_CLOSED_VERDICT, delegationVerdictOf } from "./host/policy.js";
import { DomainRegistry } from "./host/registry.js";
import {
  resolveExpert,
  type MemoryOwner,
  type ResolverDependencies,
} from "./host/resolver.js";
import { summarizeDomain } from "./host/schema.js";
import {
  domainsTableOf,
  memoryTableOf,
  type DomainExpertsStorage,
} from "./host/storage.js";
import { createDomainExpertTool } from "./host/tools/domain-expert.js";
import { createDomainMemoryTool } from "./host/tools/domain-memory.js";
import { createListDomainsTool } from "./host/tools/list-domains.js";
import type {
  DelegationVerdict,
  ToolDependencies,
} from "./host/tools/shared.js";
import type {
  DomainDefinition,
  DomainExpertRequest,
  DomainListing,
  DomainSummary,
  MemoryNamespaceView,
  MemoryRecord,
  ResolvedExpertProfile,
  ResolvedMemoryEntry,
  ToolInfo,
} from "./types.js";

/** The npm identity every tool of this catalog reports as its provider. */
const PACKAGE_ID = "@yadsh/dsh-domain-experts";

/**
 * Session id as the agent registry types it.
 *
 * Derived from the context itself instead of importing the host session
 * package: that package augments `Context.sessions` for the host, and loading
 * it here would merge with the browser face in this package's single
 * typecheck program.
 */
export type AgentId = Parameters<Context["agents"]["get"]>[0];

/** The registry surface the catalog runs against; keeps `ctx.agents` structural. */
export interface AgentsFace {
  get(id: AgentId): Agent | undefined;
  list(): readonly Agent[];
}

/** The durable half of the catalog: the definitions and their memory. */
export interface StorageHandles {
  readonly storage: DomainExpertsStorage;
  readonly domains: DomainRegistry;
  readonly memory: MemoryTable;
}

/**
 * A memory table that resolves its backing store on first use, so the built-in
 * provider can be registered before storage opens.
 */
export function deferredMemoryTable(resolve: () => MemoryTable): MemoryTable {
  return {
    get: (key) => resolve().get(key),
    entries: () => resolve().entries(),
    put: (key, value) => resolve().put(key, value),
    delete: (key) => resolve().delete(key),
  };
}

/**
 * The SQLite memory provider the deployment asked for, or `undefined`.
 *
 * Opening its database for a deployment that keeps its memory in the storage
 * unit would create a file nothing reads, so the provider — and with it the
 * one-time import from the unit — exists only when it is the configured one.
 */
export function memoryProviderOf(
  config: ResolvedConfig,
  logger: PluginLogger,
): SqliteMemoryProvider | undefined {
  return config.defaultMemoryProvider === SQLITE_MEMORY_PROVIDER_ID
    ? createSqliteMemoryProvider({
        filePath: config.memoryDbPath,
        logger,
      })
    : undefined;
}

export interface CatalogStoresOptions {
  /** The durable unit the catalog is kept in. */
  openUnit(): Promise<DomainExpertsStorage>;
  logger: PluginLogger;
  /**
   * The SQLite memory provider, present only when the deployment asks for it.
   *
   * The catalog holds it for the two moments that belong to the store: the
   * one-time import that rides on the open, and the close on unload that has to
   * happen even when the unit never came up.
   */
  readonly sqlite?: SqliteMemoryProvider | undefined;
}

/**
 * The catalog's durable store, opened at most once.
 *
 * A storage failure is reported, never thrown at load time: the plugin keeps
 * serving its tools and UI, and every domain operation answers
 * `STORAGE_UNAVAILABLE` with the underlying message. A corrupt record aborts
 * the open loudly (the storage layer names the table and key) instead of
 * being skipped, and the domains become reachable again once the deployment
 * fixes it and restarts.
 */
export class CatalogStores {
  private readonly options: CatalogStoresOptions;
  private promise: Promise<StorageHandles> | undefined;
  private current: StorageHandles | undefined;

  constructor(options: CatalogStoresOptions) {
    this.options = options;
  }

  /** The open store, or `undefined` while the one-time open has not finished. */
  get handles(): StorageHandles | undefined {
    return this.current;
  }

  /**
   * The store, waiting for the one-time open when it is still running.
   *
   * The open is lazy and memoized, so a caller that checked `handles`
   * synchronously would race it on the first tool call after a start.
   */
  async opened(): Promise<StorageHandles> {
    this.promise ??= this.open();
    return this.promise;
  }

  /**
   * The open store and the enabled domain one call addresses by id.
   *
   * Both halves are the store's own contract: a caller asking for a domain has
   * to wait for the lazy open rather than refuse the call that raced it, and
   * only an enabled domain is something an expert may be run as.
   */
  async addressed(domainId: string): Promise<{
    handles: StorageHandles;
    definition: DomainDefinition;
  }> {
    const handles = await this.opened();
    return {
      handles,
      definition: handles.domains.requireEnabled(domainId.trim()),
    };
  }

  /** The enabled definition of one domain, waiting for the store the same way. */
  async definition(domainId: string): Promise<DomainDefinition> {
    return (await this.addressed(domainId)).definition;
  }

  /**
   * The memory table of an already-open store.
   *
   * The deferred face the built-in provider was handed has no promise to wait
   * for: it answers on the calling thread, so a store that is not open yet is
   * the refusal it reports.
   */
  requireMemoryTable(): MemoryTable {
    const handles = this.current;
    if (handles === undefined) {
      throw new DomainExpertsError(
        "STORAGE_UNAVAILABLE",
        "Domain storage is not open yet; retry once the plugin has finished starting.",
      );
    }
    return handles.memory;
  }

  /** Drop the store and release whatever the deployment opened beside it. */
  async close(): Promise<void> {
    const handles = this.current;
    this.current = undefined;
    this.promise = undefined;
    // The provider's own database: opened at load, so it closes on unload even
    // when the storage unit never came up.
    this.options.sqlite?.close();
    if (handles === undefined) return;
    try {
      await handles.storage.close();
    } catch (error) {
      this.options.logger.warn("domain-experts/storage-close-failed", {
        error: errorMessageOf(error),
      });
    }
  }

  private async open(): Promise<StorageHandles> {
    try {
      const storage = await this.options.openUnit();
      const handles: StorageHandles = {
        storage,
        domains: new DomainRegistry(domainsTableOf(storage)),
        memory: memoryTableOf(storage),
      };
      this.importMemory(handles);
      this.current = handles;
      this.options.logger.info("domain-experts/storage-open", {
        domains: handles.domains.list().length,
      });
      return handles;
    } catch (error) {
      this.options.logger.error("domain-experts/storage-failed", {
        error: errorMessageOf(error),
      });
      throw new DomainExpertsError(
        "STORAGE_UNAVAILABLE",
        `Domain storage could not be opened: ${errorMessageOf(error)}`,
        { cause: error },
      );
    }
  }

  /**
   * Copy the storage unit's memory into the SQLite provider, once per database.
   *
   * The unit keeps its records: that copy is how a deployment switches back,
   * and a memory the operator cannot point at afterwards is not a migration but
   * a loss. A failed verification throws, the transaction behind it rolls back,
   * and this open is reported as `STORAGE_UNAVAILABLE` rather than serving an
   * expert from a database that might be missing something.
   */
  private importMemory(handles: StorageHandles): void {
    const provider = this.options.sqlite;
    if (provider === undefined) return;
    const report = provider.importFromUnit(handles.memory);
    this.options.logger.info("domain-experts/memory-migrated", {
      outcome: report.outcome,
      records: report.records,
      namespaces: report.namespaces,
      file: provider.filePath,
    });
  }
}

/** The definitions the tools may call, as the lightweight listing they show. */
export function domainListings(
  definitions: readonly DomainDefinition[],
): readonly DomainListing[] {
  return definitions
    .filter((definition) => definition.enabled)
    .map((definition) => ({
      id: definition.id,
      name: definition.name,
      description: definition.description,
    }));
}

/**
 * Whether one expert may hand its task to another, read off the catalog.
 *
 * Both sides are looked up by id and a missing one is the target's problem, not
 * a refusal to answer; while the store is still closed there is nothing to
 * compare, and `policy.ts` names that verdict.
 */
export function delegationVerdictFrom(
  handles: StorageHandles | undefined,
  callerDomainId: string,
  targetDomainId: string,
): DelegationVerdict {
  if (handles === undefined) return STORE_CLOSED_VERDICT;
  return delegationVerdictOf(
    handles.domains.get(callerDomainId),
    callerDomainId,
    handles.domains.get(targetDomainId),
    targetDomainId,
  );
}

/**
 * The namespaces the selected memory provider holds.
 *
 * None while the store is closed: the built-in provider answers from the
 * catalog's own memory table, so a closed store really has nothing to list,
 * while a third-party provider registered beside it is not the catalog's to
 * report on.
 */
export function memoryNamespacesOf(
  handles: StorageHandles | undefined,
  providers: MemoryProviderRegistry,
  providerId: string,
): readonly string[] {
  return handles === undefined
    ? []
    : (providers.get(providerId)?.listNamespaces() ?? []);
}

/** One expert's profile with nobody behind it: the shape the UI inspects. */
export function expertProfile(
  deps: ResolverDependencies,
  definition: DomainDefinition,
  memoryOwner: MemoryOwner,
): Promise<ResolvedExpertProfile> {
  return resolveExpert(deps, {
    definition,
    workspaceDir: "",
    callerDomain: null,
    depth: 1,
    memoryOwner,
  });
}

/** Every entry of the catalog, listed the way the management screen reads it. */
export async function domainSummaries(
  domains: DomainRegistry,
  deps: ResolverDependencies,
  memoryOwner: MemoryOwner,
): Promise<readonly DomainSummary[]> {
  const summaries: DomainSummary[] = [];
  for (const definition of domains.list()) {
    const profile = await expertProfile(deps, definition, memoryOwner);
    // Report the tools the expert will actually see, not just the ones the
    // user configured: an expert always keeps the plugin's own tools.
    summaries.push({
      ...summarizeDomain(definition, profile.degradations.length),
      tools: profile.tools.filter((tool) => tool.available).length,
    });
  }
  return summaries;
}

/** The agent tools of the catalog, keyed by the name the runtime registers. */
export function expertToolDefinitions(
  deps: ToolDependencies,
): Map<string, ToolDefinition> {
  return new Map([
    ["domain_expert", createDomainExpertTool(deps)],
    ["domain_experts_list", createListDomainsTool(deps)],
    ["domain_memory", createDomainMemoryTool(deps)],
  ]);
}

/**
 * Make the tools live, or withdraw them.
 *
 * One tool that refuses to register is reported and skipped: the catalog stays
 * reachable through the tools that did come up, and the log names the one that
 * did not. Returns the disposers to keep, or `undefined` when `wanted` matches
 * the availability the service already has and nothing has to happen.
 */
export function syncToolAvailability(options: {
  readonly wanted: boolean;
  readonly available: boolean;
  readonly disposers: readonly (() => void)[];
  readonly tools: ReadonlyMap<string, ToolDefinition>;
  register(definition: ToolDefinition): () => void;
  logger: PluginLogger;
}): { available: boolean; disposers: (() => void)[] } | undefined {
  if (options.wanted === options.available) return undefined;
  for (const dispose of options.disposers) dispose();
  if (!options.wanted) {
    options.logger.info("domain-experts/tools-withdrawn", {});
    return { available: false, disposers: [] };
  }
  const disposers: (() => void)[] = [];
  for (const [toolName, definition] of options.tools) {
    try {
      disposers.push(options.register(definition));
    } catch (error) {
      options.logger.error("domain-experts/tool-register-failed", {
        tool: toolName,
        error: errorMessageOf(error),
      });
    }
  }
  options.logger.info("domain-experts/tools-registered", {
    count: disposers.length,
  });
  return { available: true, disposers };
}

/** What the catalog exposes as the provenance line of each of its tools. */
export function catalogTools(toolNames: Iterable<string>): readonly ToolInfo[] {
  return [...toolNames].map((name) => ({ name, provider: PACKAGE_ID }));
}

/** The subagent runtime, taken from the host context. */
export function subagentsFaceOf(runtime: Context["subagents"]): SubagentsFace {
  return {
    getProvider: (providerName: string): SubagentProvider | undefined =>
      runtime.getProvider(providerName),
    start: (
      providerName: string,
      request: SubagentStartRequest,
    ): Promise<SubagentRun> => runtime.start(providerName, request),
    ...(typeof runtime.startContinuable === "function"
      ? {
          startContinuable: runtime.startContinuable.bind(
            runtime,
          ) as NonNullable<SubagentsFace["startContinuable"]>,
        }
      : {}),
  };
}

/** The agent registry, taken from the host context. */
export function agentsFaceOf(registry: Context["agents"]): AgentsFace {
  return {
    get: (id: AgentId): Agent | undefined => registry.get(id),
    list: (): readonly Agent[] => registry.list(),
  };
}

/**
 * Pick the parent for a test run: the addressed session when it has a live
 * agent, otherwise the most recent top-level live agent. A test run is a
 * real subagent, so it appears in the session tree like any other.
 */
export function testParentOf(
  agents: AgentsFace,
  parentSessionId: string,
): Agent | undefined {
  const requested = parentSessionId.trim();
  if (requested !== "") {
    const found = agents.get(requested as AgentId);
    if (found !== undefined) return found;
  }
  let newest: Agent | undefined;
  for (const agent of agents.list()) {
    if (agent.session.header.origin === "subagent") continue;
    if (
      newest === undefined ||
      agent.session.header.createdAt > newest.session.header.createdAt
    ) {
      newest = agent;
    }
  }
  return newest;
}

/**
 * The request a test run answers: the task alone, investigated in the
 * foreground, with no caller context and no expected output shape.
 */
function testRunRequest(task: string): DomainExpertRequest {
  return {
    task: task.trim(),
    context: "",
    output: "",
    mode: "investigate",
    background: false,
  };
}

/**
 * The run input one test starts from: a real subagent under a live parent, so
 * it shows up in the session tree like any other expert child.
 */
export function testRunInput(
  parent: Agent,
  definition: DomainDefinition,
  task: string,
): ExpertRunInput {
  return {
    parent,
    definition,
    request: testRunRequest(task),
    signal: new AbortController().signal,
    callerDomain: null,
  };
}

/**
 * The memory an expert may read, as the inspector shows it: one row per
 * namespace, and its records newest-first under the requested cap.
 */
export async function memoryProjection(
  provider: DomainMemoryProvider,
  targets: readonly ResolvedMemoryEntry[],
  limit: number,
): Promise<{
  readonly namespaces: readonly MemoryNamespaceView[];
  readonly records: readonly MemoryRecord[];
}> {
  const cap = limit > 0 ? Math.min(Math.trunc(limit), 500) : 200;
  const namespaces: MemoryNamespaceView[] = [];
  const records: MemoryRecord[] = [];
  for (const entry of targets) {
    const found = await provider.inspect(entry.namespace);
    namespaces.push({
      namespace: entry.namespace,
      access: entry.access,
      records: found.length,
    });
    records.push(...found);
  }
  return {
    namespaces,
    records: records
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, cap),
  };
}
