import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-settings";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type {} from "@deepseek-ai/dsh-storage-domain";
import type {
  SubagentProvider,
  SubagentRun,
  SubagentStartRequest,
} from "@deepseek-ai/dsh-subagent";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import {
  createHostLoggerSink,
  getPluginLogger,
  type PluginLogger,
} from "@yadsh/dsh-plugin-log";
import {
  ConfigSchema,
  SETTINGS_NAMESPACE,
  resolveConfig,
  type Config as PluginConfig,
  type ResolvedConfig,
} from "./config.js";
import { AuditRing } from "./host/audit.js";
import { DomainExpertsError, errorMessageOf } from "./host/errors.js";
import {
  RunTracker,
  runExpert,
  type ExpertRunInput,
  type SubagentsFace,
} from "./host/execution.js";
import {
  createBuiltinMemoryProvider,
  type MemoryTable,
} from "./host/memory/builtin.js";
import { MemoryProviderRegistry } from "./host/memory/registry.js";
import { delegationVerdictOf, parallelBudgetOf } from "./host/policy.js";
import { DomainRegistry } from "./host/registry.js";
import { summarizeDomain } from "./host/schema.js";
import {
  memoryEntries,
  resolveExpert,
  type ResolverDependencies,
} from "./host/resolver.js";
import { createFilesystemProvider } from "./host/scopes/filesystem.js";
import { ScopeProviderRegistry } from "./host/scopes/registry.js";
import {
  domainExpertsSpec,
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
import { WorkerRegistry } from "./host/workers/registry.js";
import type {
  AuditListResult,
  CatalogResult,
  DomainDefinition,
  DomainDeleteResult,
  DomainExpertResult,
  DomainGetResult,
  DomainListResult,
  DomainListing,
  DomainSummary,
  DomainWriteResult,
  DraftInspectionResult,
  ExpertRunResult,
  MemoryClearResult,
  MemoryInspectResult,
  ResolvedScopeResult,
  ValidationIssueView,
} from "./types.js";
import { emptyDomainDraft } from "./types.js";

export const name = "domain-experts";
export const inject = ["tools", "agents", "subagents", "storageDomain"];
export const Config = ConfigSchema;

declare module "@deepseek-ai/cordis" {
  interface Context {
    domainExperts: DomainExpertsService;
  }
}

/**
 * A memory table that resolves its backing store on first use, so the built-in
 * provider can be registered before storage opens.
 */
function deferredMemoryTable(resolve: () => MemoryTable): MemoryTable {
  return {
    get: (key) => resolve().get(key),
    entries: () => resolve().entries(),
    put: (key, value) => resolve().put(key, value),
    delete: (key) => resolve().delete(key),
  };
}

interface StorageHandles {
  readonly storage: DomainExpertsStorage;
  readonly domains: DomainRegistry;
  readonly memory: MemoryTable;
}

/**
 * Session id as the agent registry types it.
 *
 * Derived from the service itself instead of importing the host session
 * package: that package augments `Context.sessions` for the host, and loading
 * it here would merge with the browser face in this package's single
 * typecheck program.
 */
type AgentId = Parameters<Context["agents"]["get"]>[0];

/** The registry surface used by the service; keeps `ctx.agents` structural. */
interface AgentsFace {
  get(id: AgentId): Agent | undefined;
  list(): readonly Agent[];
}

/**
 * Domain experts: a host-plane service, three agent tools and a management UI.
 *
 * The service owns nothing the runtime already owns. Expert children are
 * ordinary DSH subagents started through `ctx.subagents`; the plugin only
 * composes the request (persona, tool mask, depth cap) and reports what it
 * could and could not enforce.
 */
export class DomainExpertsService extends TypertRemoteService {
  static inject = inject;
  static Config = ConfigSchema;

  private readonly logger: PluginLogger;
  private readonly entry: PluginConfig;
  private source: () => PluginConfig;
  private readonly scopeProviders = new ScopeProviderRegistry();
  private readonly memoryProviders = new MemoryProviderRegistry();
  private readonly workers = new WorkerRegistry();
  private readonly audits: AuditRing;
  private readonly tracker = new RunTracker();
  private readonly tools = new Map<string, ToolDefinition>();
  private toolDisposers: (() => void)[] = [];
  private storagePromise: Promise<StorageHandles> | undefined;
  private storageHandles: StorageHandles | undefined;
  private readonly memoryTable = deferredMemoryTable(() =>
    this.requireMemoryTable(),
  );
  private toolAvailability = false;

  constructor(ctx: Context, entry: PluginConfig = {}) {
    super(ctx, "domainExperts", { namespace: "domainExperts" });
    this.entry = entry;
    this.source = () => entry;
    this.logger = getPluginLogger({
      pluginId: `dsh-${name}`,
      consoleSink: createHostLoggerSink(ctx.logger),
    });
    const resolved = this.config();
    this.audits = new AuditRing(resolved.auditLimit);

    // Built-in providers arrive with the plugin; a third party adds its own
    // through the public registration methods below. The memory provider is
    // registered here rather than at open time so that its availability is a
    // plugin-lifetime fact and the catalog cannot change under a running UI —
    // only its backing table waits for storage.
    this.scopeProviders.register(createFilesystemProvider());
    this.memoryProviders.register(
      createBuiltinMemoryProvider(this.memoryTable, () => Date.now()),
    );

    this.registerTools();
    this.applyEnabled();

    // Settings are an optional seam: without a settings service the plugin
    // runs on its composition entry exactly as composed.
    ctx.inject(["settings"], (settingsCtx) => {
      settingsCtx.settings.installSection(
        ctx,
        SETTINGS_NAMESPACE,
        ConfigSchema,
        entry,
        {
          setSource: (source) => {
            this.source = source;
          },
          onChange: () => {
            this.applyEnabled();
          },
        },
      );
    });

    ctx.effect(
      () => () => {
        void this.closeStorage();
      },
      "domain-experts.storage",
    );
    this.logger.info("domain-experts/ready", {
      enabled: resolved.enabled,
      provider: resolved.subagentProvider,
    });
  }

  private config(): ResolvedConfig {
    return resolveConfig(this.source());
  }

  // ---------------------------------------------------------------- storage

  /**
   * Open durable storage at most once.
   *
   * A storage failure is reported, never thrown at load time: the plugin keeps
   * serving its tools and UI, and every domain operation answers
   * `STORAGE_UNAVAILABLE` with the underlying message. A corrupt record aborts
   * the open loudly (the storage layer names the table and key) instead of
   * being skipped, and the domains become reachable again once the deployment
   * fixes it and restarts.
   */
  private async storage(): Promise<StorageHandles> {
    this.storagePromise ??= this.openStorage();
    return this.storagePromise;
  }

  private async openStorage(): Promise<StorageHandles> {
    try {
      const storage = await this.ctx.storageDomain.open(domainExpertsSpec);
      const handles: StorageHandles = {
        storage,
        domains: new DomainRegistry(domainsTableOf(storage)),
        memory: memoryTableOf(storage),
      };
      this.storageHandles = handles;
      this.logger.info("domain-experts/storage-open", {
        domains: handles.domains.list().length,
      });
      return handles;
    } catch (error) {
      this.logger.error("domain-experts/storage-failed", {
        error: errorMessageOf(error),
      });
      throw new DomainExpertsError(
        "STORAGE_UNAVAILABLE",
        `Domain storage could not be opened: ${errorMessageOf(error)}`,
        { cause: error },
      );
    }
  }

  private async closeStorage(): Promise<void> {
    const handles = this.storageHandles;
    this.storageHandles = undefined;
    this.storagePromise = undefined;
    if (handles === undefined) return;
    try {
      await handles.storage.close();
    } catch (error) {
      this.logger.warn("domain-experts/storage-close-failed", {
        error: errorMessageOf(error),
      });
    }
  }

  /** Storage plus the registries, or the STORAGE_UNAVAILABLE refusal. */
  private async opened(): Promise<StorageHandles> {
    return await this.storage();
  }

  private requireMemoryTable(): MemoryTable {
    const handles = this.storageHandles;
    if (handles === undefined) {
      throw new DomainExpertsError(
        "STORAGE_UNAVAILABLE",
        "Domain storage is not open yet; retry once the plugin has finished starting.",
      );
    }
    return handles.memory;
  }

  // ------------------------------------------------------------------- tools

  private registerTools(): void {
    this.tools.set(
      "domain_expert",
      createDomainExpertTool(this.toolDependencies()),
    );
    this.tools.set(
      "domain_experts_list",
      createListDomainsTool(this.toolDependencies()),
    );
    this.tools.set(
      "domain_memory",
      createDomainMemoryTool(this.toolDependencies()),
    );
  }

  /** Register or withdraw the agent tools as `enabled` flips. */
  private applyEnabled(): void {
    const wanted = this.config().enabled;
    if (wanted === this.toolAvailability) return;
    this.toolAvailability = wanted;
    for (const dispose of this.toolDisposers) dispose();
    this.toolDisposers = [];
    if (!wanted) {
      this.logger.info("domain-experts/tools-withdrawn", {});
      return;
    }
    for (const [toolName, definition] of this.tools) {
      try {
        this.toolDisposers.push(this.ctx.tools.register(definition));
        void toolName;
      } catch (error) {
        this.logger.error("domain-experts/tool-register-failed", {
          tool: toolName,
          error: errorMessageOf(error),
        });
      }
    }
    this.logger.info("domain-experts/tools-registered", {
      count: this.toolDisposers.length,
    });
  }

  private toolDependencies(): ToolDependencies {
    return {
      list: () => this.listings(),
      requireDefinition: (id) => this.requireDefinition(id),
      run: (input) => this.runExpertSafely(input),
      activeRun: (sessionId) => this.tracker.find(sessionId),
      delegationVerdict: (callerDomainId, targetDomainId) =>
        this.delegationVerdict(callerDomainId, targetDomainId),
      parallelBudget: (callerSessionId) =>
        parallelBudgetOf(
          this.tracker.countForCaller(callerSessionId),
          this.tracker.find(callerSessionId)?.maxParallel ??
            this.config().defaultMaxParallel,
        ),
      memory: () =>
        this.memoryProviders.require(this.config().defaultMemoryProvider),
      logger: this.logger,
    };
  }

  // ---------------------------------------------------------------- resolver

  private resolverDependencies(domains: DomainRegistry): ResolverDependencies {
    return {
      domains,
      scopeProviders: this.scopeProviders,
      memoryProviders: this.memoryProviders,
      workers: this.workers,
      memoryProviderId: this.config().defaultMemoryProvider,
      recallLimit: this.config().recallLimit,
    };
  }

  /**
   * The persisted definition, waiting for the one-time storage open.
   *
   * The open is lazy and memoized, so the first tool call after a start races
   * it: a synchronous handle check refuses "not open yet" for exactly that
   * call, and every later call of a failed open repeats the refusal forever
   * without naming the cause. Awaiting the open keeps the racing call correct
   * and lets a failed open surface its underlying `STORAGE_UNAVAILABLE`
   * message.
   */
  private async requireDefinition(id: string): Promise<DomainDefinition> {
    const handles = await this.storage();
    return handles.domains.requireEnabled(id.trim());
  }

  private async listings(): Promise<readonly DomainListing[]> {
    const handles = await this.storage();
    return handles.domains
      .list()
      .filter((definition) => definition.enabled)
      .map((definition) => ({
        id: definition.id,
        name: definition.name,
        description: definition.description,
      }));
  }

  private delegationVerdict(
    callerDomainId: string,
    targetDomainId: string,
  ): DelegationVerdict {
    const handles = this.storageHandles;
    if (handles === undefined) {
      return {
        allowed: false,
        mode: "disabled",
        targets: [],
        message:
          "Domain storage is not open, so cross-domain policy cannot be evaluated.",
      };
    }
    return delegationVerdictOf(
      handles.domains.get(callerDomainId),
      callerDomainId,
      handles.domains.get(targetDomainId),
      targetDomainId,
    );
  }

  private async runExpertSafely(
    input: ExpertRunInput,
  ): Promise<DomainExpertResult> {
    const handles = await this.opened();
    return await runExpert(
      {
        resolver: this.resolverDependencies(handles.domains),
        subagents: this.subagentsFace(),
        subagentProvider: this.config().subagentProvider,
        tracker: this.tracker,
        audits: this.audits,
        logger: this.logger,
        now: Date.now,
      },
      input,
    );
  }

  private subagentsFace(): SubagentsFace {
    const runtime = this.ctx.subagents;
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

  private agentsFace(): AgentsFace {
    const registry = this.ctx.agents;
    return {
      get: (id: AgentId): Agent | undefined => registry.get(id),
      list: (): readonly Agent[] => registry.list(),
    };
  }

  // -------------------------------------------------------- extension seams

  /** Register a scope provider (design §35). */
  registerScopeProvider(
    provider: Parameters<ScopeProviderRegistry["register"]>[0],
  ): () => void {
    return this.scopeProviders.register(provider);
  }

  /** Register a memory backend (design §35). */
  registerMemoryProvider(
    provider: Parameters<MemoryProviderRegistry["register"]>[0],
  ): () => void {
    return this.memoryProviders.register(provider);
  }

  /** Register a functional worker (design §35). */
  registerWorker(
    worker: Parameters<WorkerRegistry["register"]>[0],
  ): () => void {
    return this.workers.register(worker);
  }

  /** The resolved scope of one expert, without running it. */
  async resolveDomainScope(domainId: string): Promise<ResolvedScopeResult> {
    try {
      const handles = await this.opened();
      const definition = handles.domains.requireEnabled(domainId.trim());
      const profile = await resolveExpert(
        this.resolverDependencies(handles.domains),
        {
          definition,
          workspaceDir: "",
          callerDomain: null,
          depth: 1,
        },
      );
      return { ok: true, code: "", message: "", profile };
    } catch (error) {
      return {
        ok: false,
        code: error instanceof DomainExpertsError ? error.code : "INTERNAL",
        message: errorMessageOf(error),
        profile: null,
      };
    }
  }

  // -------------------------------------------------------- remote contract

  @Remote("listDomains")
  async listDomains(): Promise<DomainListResult> {
    try {
      const handles = await this.opened();
      const summaries: DomainSummary[] = [];
      for (const definition of handles.domains.list()) {
        const profile = await resolveExpert(
          this.resolverDependencies(handles.domains),
          {
            definition,
            workspaceDir: "",
            callerDomain: null,
            depth: 1,
          },
        );
        // Report the tools the expert will actually see, not just the ones the
        // user configured: an expert always keeps the plugin's own tools.
        summaries.push({
          ...summarizeDomain(definition, profile.degradations.length),
          tools: profile.tools.filter((tool) => tool.available).length,
        });
      }
      return { ok: true, code: "", message: "", domains: summaries };
    } catch (error) {
      return {
        ok: false,
        code: error instanceof DomainExpertsError ? error.code : "INTERNAL",
        message: errorMessageOf(error),
        domains: [],
      };
    }
  }

  @Remote("getDomain")
  async getDomain(domainId: string): Promise<DomainGetResult> {
    try {
      const handles = await this.opened();
      return {
        ok: true,
        code: "",
        message: "",
        domain: handles.domains.get(domainId.trim()) ?? null,
      };
    } catch (error) {
      return {
        ok: false,
        code: error instanceof DomainExpertsError ? error.code : "INTERNAL",
        message: errorMessageOf(error),
        domain: null,
      };
    }
  }

  @Remote("draftDomain")
  draftDomain(domainId: string): DomainWriteResult {
    const resolved = this.config();
    const draft = emptyDomainDraft(domainId.trim(), Date.now());
    return {
      ok: true,
      code: "",
      message: "",
      domain: {
        ...draft,
        memory: { ...draft.memory, namespace: `domain/${domainId.trim()}` },
        delegation: {
          ...draft.delegation,
          maxDepth: resolved.defaultMaxDepth,
          crossDomainMode: resolved.defaultCrossDomainMode,
        },
      },
    };
  }

  @Remote("inspectDraft")
  async inspectDraft(
    definition: DomainDefinition,
  ): Promise<DraftInspectionResult> {
    try {
      const handles = await this.opened();
      const inspection = handles.domains.inspectDraft(definition);
      return {
        ok: true,
        code: "",
        message: inspection.message,
        definition: inspection.definition,
        issues: inspection.issues.map((issue): ValidationIssueView => ({
          severity: issue.severity,
          field: issue.field,
          message: issue.message,
        })),
      };
    } catch (error) {
      return {
        ok: false,
        code: error instanceof DomainExpertsError ? error.code : "INTERNAL",
        message: errorMessageOf(error),
        definition: null,
        issues: [],
      };
    }
  }

  @Remote("createDomain")
  async createDomain(definition: DomainDefinition): Promise<DomainWriteResult> {
    try {
      const handles = await this.opened();
      const created = await handles.domains.create(definition);
      return { ok: true, code: "", message: "", domain: created };
    } catch (error) {
      return this.writeFailure(error);
    }
  }

  @Remote("updateDomain")
  async updateDomain(definition: DomainDefinition): Promise<DomainWriteResult> {
    try {
      const handles = await this.opened();
      const updated = await handles.domains.update(definition);
      return { ok: true, code: "", message: "", domain: updated };
    } catch (error) {
      return this.writeFailure(error);
    }
  }

  @Remote("setDomainEnabled")
  async setDomainEnabled(
    domainId: string,
    enabled: boolean,
  ): Promise<DomainWriteResult> {
    try {
      const handles = await this.opened();
      const updated = await handles.domains.setEnabled(
        domainId.trim(),
        enabled,
      );
      return { ok: true, code: "", message: "", domain: updated };
    } catch (error) {
      return this.writeFailure(error);
    }
  }

  @Remote("deleteDomain")
  async deleteDomain(domainId: string): Promise<DomainDeleteResult> {
    try {
      const handles = await this.opened();
      const deleted = await handles.domains.remove(domainId.trim());
      return { ok: true, code: "", message: "", deleted };
    } catch (error) {
      return {
        ok: false,
        code: error instanceof DomainExpertsError ? error.code : "INTERNAL",
        message: errorMessageOf(error),
        deleted: false,
      };
    }
  }

  @Remote("resolveScope")
  resolveScope(domainId: string): Promise<ResolvedScopeResult> {
    return this.resolveDomainScope(domainId);
  }

  @Remote("catalog")
  catalog(): CatalogResult {
    const handles = this.storageHandles;
    return {
      ok: true,
      code: "",
      message: "",
      scopeProviders: this.scopeProviders.info(),
      memoryProviders: this.memoryProviders.info(),
      workers: this.workers.info(),
      tools: [...this.tools.keys()].map((toolName) => ({
        name: toolName,
        provider: `@yadsh/dsh-domain-experts`,
      })),
      memoryNamespaces: handles === undefined ? [] : this.builtinNamespaces(),
    };
  }

  private builtinNamespaces(): readonly string[] {
    const provider = this.memoryProviders.get(
      this.config().defaultMemoryProvider,
    );
    return provider?.listNamespaces() ?? [];
  }

  @Remote("inspectMemory")
  async inspectMemory(
    domainId: string,
    namespace: string,
    limit: number,
  ): Promise<MemoryInspectResult> {
    try {
      const handles = await this.opened();
      const definition = handles.domains.requireEnabled(domainId.trim());
      const entries = memoryEntries(definition);
      const requested = namespace.trim();
      const target = entries.filter(
        (entry) => requested === "" || entry.namespace === requested,
      );
      if (requested !== "" && target.length === 0) {
        throw new DomainExpertsError(
          "MEMORY_SCOPE_DENIED",
          `Namespace "${requested}" does not belong to domain "${definition.id}".`,
          { refs: [requested] },
        );
      }
      const provider = this.memoryProviders.require(
        this.config().defaultMemoryProvider,
      );
      const cap = limit > 0 ? Math.min(Math.trunc(limit), 500) : 200;
      const records: MemoryInspectResult["records"][number][] = [];
      const namespaces: MemoryInspectResult["namespaces"][number][] = [];
      for (const entry of target) {
        const found = await provider.inspect(entry.namespace);
        namespaces.push({
          namespace: entry.namespace,
          access: entry.access,
          records: found.length,
        });
        records.push(...found);
      }
      return {
        ok: true,
        code: "",
        message: "",
        namespaces,
        records: records
          .sort((left, right) => right.updatedAt - left.updatedAt)
          .slice(0, cap),
      };
    } catch (error) {
      return {
        ok: false,
        code: error instanceof DomainExpertsError ? error.code : "INTERNAL",
        message: errorMessageOf(error),
        namespaces: [],
        records: [],
      };
    }
  }

  @Remote("clearMemory")
  async clearMemory(
    domainId: string,
    namespace: string,
  ): Promise<MemoryClearResult> {
    try {
      const handles = await this.opened();
      const definition = handles.domains.requireEnabled(domainId.trim());
      const writable = memoryEntries(definition).find(
        (entry) => entry.access === "read-write",
      );
      const requested =
        namespace.trim() === ""
          ? (writable?.namespace ?? "")
          : namespace.trim();
      if (writable === undefined || requested !== writable.namespace) {
        throw new DomainExpertsError(
          "MEMORY_SCOPE_DENIED",
          `Only the private namespace of domain "${definition.id}" can be cleared.`,
          { refs: [requested] },
        );
      }
      const provider = this.memoryProviders.require(
        this.config().defaultMemoryProvider,
      );
      const cleared = await provider.clear(requested);
      this.logger.info("domain-experts/memory-cleared", {
        domain: definition.id,
        namespace: requested,
        cleared,
      });
      return { ok: true, code: "", message: "", cleared };
    } catch (error) {
      return {
        ok: false,
        code: error instanceof DomainExpertsError ? error.code : "INTERNAL",
        message: errorMessageOf(error),
        cleared: 0,
      };
    }
  }

  @Remote("testExpert")
  async testExpert(
    domainId: string,
    task: string,
    parentSessionId: string,
  ): Promise<ExpertRunResult> {
    try {
      const handles = await this.opened();
      const definition = handles.domains.requireEnabled(domainId.trim());
      const parent = this.resolveTestParent(parentSessionId);
      if (parent === undefined) {
        throw new DomainExpertsError(
          "TASK_REJECTED",
          "Running a test needs a live session to act as the caller's parent. Open a chat, or use the domain_expert tool from a conversation.",
        );
      }
      const result = await runExpert(
        {
          resolver: this.resolverDependencies(handles.domains),
          subagents: this.subagentsFace(),
          subagentProvider: this.config().subagentProvider,
          tracker: this.tracker,
          audits: this.audits,
          logger: this.logger,
          now: Date.now,
        },
        {
          parent,
          definition,
          request: {
            task: task.trim(),
            context: "",
            output: "",
            mode: "investigate",
            background: false,
          },
          signal: new AbortController().signal,
          callerDomain: null,
        },
      );
      return { ok: true, code: "", message: "", result };
    } catch (error) {
      return {
        ok: false,
        code: error instanceof DomainExpertsError ? error.code : "INTERNAL",
        message: errorMessageOf(error),
        result: null,
      };
    }
  }

  /**
   * Pick the parent for a test run: the addressed session when it has a live
   * agent, otherwise the most recent top-level live agent. A test run is a
   * real subagent, so it appears in the session tree like any other.
   */
  private resolveTestParent(parentSessionId: string): Agent | undefined {
    const agents = this.agentsFace();
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

  @Remote("recentAudits")
  recentAudits(limit: number): AuditListResult {
    return {
      ok: true,
      code: "",
      message: "",
      entries: this.audits.recent(limit > 0 ? limit : 50),
    };
  }

  private writeFailure(error: unknown): DomainWriteResult {
    return {
      ok: false,
      code: error instanceof DomainExpertsError ? error.code : "INTERNAL",
      message: errorMessageOf(error),
      domain: null,
    };
  }
}

export {
  ConfigSchema,
  SETTINGS_NAMESPACE,
  resolveConfig,
  DEFAULT_MEMORY_PROVIDER,
  DEFAULT_SUBAGENT_PROVIDER,
} from "./config.js";
export type {
  Config as DomainExpertsConfig,
  ResolvedConfig,
} from "./config.js";
export { DomainExpertsError, isDomainExpertsError } from "./host/errors.js";
export { AuditRing } from "./host/audit.js";
export { RunTracker, runExpert } from "./host/execution.js";
export { delegationVerdictOf, parallelBudgetOf } from "./host/policy.js";
export { DomainRegistry } from "./host/registry.js";
export { composePersona, BASE_POLICY, ANSWER_FORMAT } from "./host/persona.js";
export {
  memoryEntries,
  resolveExpert,
  EXPERT_INFRASTRUCTURE_TOOLS,
  TOOL_ALIASES,
  type ResolverDependencies,
  type ResolveInput,
} from "./host/resolver.js";
export {
  decidePath,
  globMatches,
  compileGlob,
  pathRulesOf,
  isWriteAllowed,
  type PathDecision,
} from "./host/scopes/path-guard.js";
export {
  createFilesystemProvider,
  resolveWithinRoot,
  resolveAllWithinRoot,
  FILESYSTEM_PROVIDER_ID,
} from "./host/scopes/filesystem.js";
export {
  ScopeProviderRegistry,
  type DomainScopeProvider,
} from "./host/scopes/registry.js";
export {
  MemoryProviderRegistry,
  type DomainMemoryProvider,
} from "./host/memory/registry.js";
export {
  createBuiltinMemoryProvider,
  memoryKeyOf,
  BUILTIN_MEMORY_PROVIDER_ID,
} from "./host/memory/builtin.js";
export { WorkerRegistry, type DomainWorker } from "./host/workers/registry.js";
export { parseExpertAnswer, textOfBlocks } from "./host/result.js";
export {
  memoryRecordSchema,
  domainRecordSchema,
  validateDomainDefinition,
  parseDomainDefinition,
  normalizeDomainDefinition,
} from "./host/schema.js";
export type * from "./types.js";
export default DomainExpertsService;
