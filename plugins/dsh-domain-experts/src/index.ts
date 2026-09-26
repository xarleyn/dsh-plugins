import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-settings";
import type {} from "@deepseek-ai/dsh-storage-domain";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
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
import {
  CatalogStores,
  agentsFaceOf,
  catalogTools,
  delegationVerdictFrom,
  deferredMemoryTable,
  memoryNamespacesOf,
  domainListings,
  domainSummaries,
  expertProfile,
  expertToolDefinitions,
  memoryProviderOf,
  subagentsFaceOf,
  syncToolAvailability,
  testParentOf,
  testRunInput,
  type StorageHandles,
} from "./catalog.js";
import { AuditRing } from "./host/audit.js";
import {
  RunTracker,
  runExpert,
  type ExecutionDependencies,
  type ExpertRunInput,
} from "./host/execution.js";
import { createMemoryAdmin, type MemoryAdmin } from "./host/memory/admin.js";
import { createBuiltinMemoryProvider } from "./host/memory/builtin.js";
import {
  MemoryProviderRegistry,
  type DomainMemoryProvider,
} from "./host/memory/registry.js";
import type { SqliteMemoryProvider } from "./host/memory/sqlite.js";
import { parallelBudgetOf } from "./host/policy.js";
import { PrincipalIdentities } from "./host/qa-principal.js";
import type { ResolverDependencies } from "./host/resolver.js";
import { createFilesystemProvider } from "./host/scopes/filesystem.js";
import { ScopeProviderRegistry } from "./host/scopes/registry.js";
import { domainExpertsSpec } from "./host/storage.js";
import type { ToolDependencies } from "./host/tools/shared.js";
import { WorkerRegistry } from "./host/workers/registry.js";
import {
  accepted,
  clearDomainMemory,
  domainDeleteRefusal,
  domainDraft,
  domainGetRefusal,
  domainListRefusal,
  domainWriteRefusal,
  draftInspection,
  draftInspectionRefusal,
  expertRunRefusal,
  guarded,
  inspectDomainMemory,
  missingTestParent,
  scopeRefusal,
  type MemoryAccess,
} from "./validate.js";
import type {
  AuditListResult,
  CatalogResult,
  DomainDefinition,
  DomainDeleteResult,
  DomainExpertResult,
  DomainGetResult,
  DomainListResult,
  DomainWriteResult,
  DraftInspectionResult,
  ExpertRunResult,
  MemoryClearResult,
  MemoryInspectResult,
  ResolvedScopeResult,
} from "./types.js";

export const name = "domain-experts";
export const inject = ["tools", "agents", "subagents", "storageDomain"];
export const Config = ConfigSchema;

declare module "@deepseek-ai/cordis" {
  interface Context {
    domainExperts: DomainExpertsService;
  }
}

/**
 * Domain experts: a host-plane service, three agent tools and a management UI.
 *
 * The service owns nothing the runtime already owns. Expert children are
 * ordinary DSH subagents started through `ctx.subagents`; the plugin only
 * composes the request (persona, tool mask, depth cap) and reports what it
 * could and could not enforce.
 *
 * What it serves — the store, the tools and the projections of the expert
 * catalog — is `catalog.ts`; the verdicts on one of its entries are
 * `validate.ts`. This file is the wiring: the service, its registries, the
 * settings seam it answers to and the Remote contract the client calls.
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
  private readonly tools: Map<string, ToolDefinition>;
  private toolDisposers: (() => void)[] = [];
  private readonly stores: CatalogStores;
  private readonly memoryTable = deferredMemoryTable(() =>
    this.stores.requireMemoryTable(),
  );
  /** The backend the deployment moved its memory out of the unit to, if any. */
  private readonly sqliteMemory: SqliteMemoryProvider | undefined;
  private toolAvailability = false;
  /** Whose memory a call reaches: the account of its session, or none. */
  private readonly principals: PrincipalIdentities;
  /**
   * Operator-facing memory maintenance (design §15).
   *
   * Not a `@Remote` on purpose: this writes into the store that feeds every
   * expert's prompt, so it is reached from another plugin's host-plane service,
   * behind that plugin's own permission check. Its dependencies resolve through
   * `this` on each call, so a deployment that switches provider or adds a domain
   * is answered from the new state rather than a snapshot of the first one.
   */
  readonly memoryAdmin: MemoryAdmin;

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
    this.sqliteMemory = memoryProviderOf(resolved, this.logger);
    if (this.sqliteMemory !== undefined) {
      this.memoryProviders.register(this.sqliteMemory);
    }
    this.stores = new CatalogStores({
      openUnit: () => ctx.storageDomain.open(domainExpertsSpec),
      logger: this.logger,
      sqlite: this.sqliteMemory,
    });
    this.memoryAdmin = createMemoryAdmin({
      definitions: async () => (await this.stores.opened()).domains.list(),
      provider: () => this.memoryProvider(),
      logger: this.logger,
    });
    this.principals = new PrincipalIdentities({
      logger: this.logger,
      surface: () => ctx.get("qaSurface"),
      config: () => this.config(),
    });
    this.tools = expertToolDefinitions(this.toolDependencies());
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
        void this.stores.close();
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

  // ------------------------------------------------------------------- tools

  /** Register or withdraw the agent tools as `enabled` flips. */
  private applyEnabled(): void {
    const next = syncToolAvailability({
      available: this.toolAvailability,
      disposers: this.toolDisposers,
      logger: this.logger,
      register: (definition) => this.ctx.tools.register(definition),
      tools: this.tools,
      wanted: this.config().enabled,
    });
    if (next === undefined) return;
    this.toolAvailability = next.available;
    this.toolDisposers = next.disposers;
  }

  private toolDependencies(): ToolDependencies {
    return {
      list: async () =>
        domainListings((await this.stores.opened()).domains.list()),
      requireDefinition: (id) => this.requireDefinition(id),
      run: (input) => this.runExpertSafely(input),
      activeRun: (sessionId) => this.tracker.find(sessionId),
      delegationVerdict: (callerDomainId, targetDomainId) =>
        delegationVerdictFrom(
          this.stores.handles,
          callerDomainId,
          targetDomainId,
        ),
      parallelBudget: (callerSessionId) =>
        parallelBudgetOf(
          this.tracker.countForCaller(callerSessionId),
          this.tracker.find(callerSessionId)?.maxParallel ??
            this.config().defaultMaxParallel,
        ),
      memory: () => this.memoryProvider(),
      logger: this.logger,
    };
  }

  /** The memory provider the deployment selected. */
  private memoryProvider(): DomainMemoryProvider {
    return this.memoryProviders.require(this.config().defaultMemoryProvider);
  }

  /** What the service supplies before one expert's memory is answered. */
  private get memoryAccess(): MemoryAccess {
    return {
      domain: (domainId) => this.requireDefinition(domainId),
      provider: () => this.memoryProvider(),
      owner: () => this.principals.unattributedOwner(),
    };
  }

  // ---------------------------------------------------------------- resolver

  private resolverDependencies(handles: StorageHandles): ResolverDependencies {
    return {
      domains: handles.domains,
      scopeProviders: this.scopeProviders,
      memoryProviders: this.memoryProviders,
      workers: this.workers,
      memoryProviderId: this.config().defaultMemoryProvider,
      recallLimit: this.config().recallLimit,
    };
  }

  /** What one expert run reads off the live service. */
  private executionDependencies(
    handles: StorageHandles,
  ): ExecutionDependencies {
    return {
      resolver: this.resolverDependencies(handles),
      subagents: subagentsFaceOf(this.ctx.subagents),
      subagentProvider: this.config().subagentProvider,
      tracker: this.tracker,
      audits: this.audits,
      logger: this.logger,
      now: Date.now,
      perUserMemory: this.principals.perUserMemory(),
      principalOf: (sessionId) => this.principals.principalOf(sessionId),
    };
  }

  /**
   * The persisted definition of one enabled domain.
   *
   * Waiting for the store is part of the contract, not a formality; the rule and
   * the reason for it are `CatalogStores.addressed`.
   */
  private async requireDefinition(id: string): Promise<DomainDefinition> {
    return await this.stores.definition(id);
  }

  private async runExpertSafely(
    input: ExpertRunInput,
  ): Promise<DomainExpertResult> {
    const handles = await this.stores.opened();
    return await runExpert(this.executionDependencies(handles), input);
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
    return guarded(async () => {
      const handles = await this.stores.opened();
      return accepted({
        profile: await expertProfile(
          this.resolverDependencies(handles),
          await this.requireDefinition(domainId),
          this.principals.unattributedOwner(),
        ),
      });
    }, scopeRefusal);
  }

  // -------------------------------------------------------- remote contract

  @Remote("listDomains")
  async listDomains(): Promise<DomainListResult> {
    return guarded(async () => {
      const handles = await this.stores.opened();
      return accepted({
        domains: await domainSummaries(
          handles.domains,
          this.resolverDependencies(handles),
          this.principals.unattributedOwner(),
        ),
      });
    }, domainListRefusal);
  }

  @Remote("getDomain")
  async getDomain(domainId: string): Promise<DomainGetResult> {
    return guarded(async () => {
      const handles = await this.stores.opened();
      return accepted({ domain: handles.domains.get(domainId.trim()) ?? null });
    }, domainGetRefusal);
  }

  @Remote("draftDomain")
  draftDomain(domainId: string): DomainWriteResult {
    return domainDraft(domainId.trim(), this.config(), Date.now());
  }

  @Remote("inspectDraft")
  async inspectDraft(
    definition: DomainDefinition,
  ): Promise<DraftInspectionResult> {
    return guarded(async () => {
      const handles = await this.stores.opened();
      return draftInspection(handles.domains.inspectDraft(definition));
    }, draftInspectionRefusal);
  }

  @Remote("createDomain")
  async createDomain(definition: DomainDefinition): Promise<DomainWriteResult> {
    return guarded(async () => {
      const handles = await this.stores.opened();
      return accepted({ domain: await handles.domains.create(definition) });
    }, domainWriteRefusal);
  }

  @Remote("updateDomain")
  async updateDomain(definition: DomainDefinition): Promise<DomainWriteResult> {
    return guarded(async () => {
      const handles = await this.stores.opened();
      return accepted({ domain: await handles.domains.update(definition) });
    }, domainWriteRefusal);
  }

  @Remote("setDomainEnabled")
  async setDomainEnabled(
    domainId: string,
    enabled: boolean,
  ): Promise<DomainWriteResult> {
    return guarded(async () => {
      const handles = await this.stores.opened();
      return accepted({
        domain: await handles.domains.setEnabled(domainId.trim(), enabled),
      });
    }, domainWriteRefusal);
  }

  @Remote("deleteDomain")
  async deleteDomain(domainId: string): Promise<DomainDeleteResult> {
    return guarded(async () => {
      const handles = await this.stores.opened();
      return accepted({
        deleted: await handles.domains.remove(domainId.trim()),
      });
    }, domainDeleteRefusal);
  }

  @Remote("resolveScope")
  resolveScope(domainId: string): Promise<ResolvedScopeResult> {
    return this.resolveDomainScope(domainId);
  }

  @Remote("catalog")
  catalog(): CatalogResult {
    return accepted({
      scopeProviders: this.scopeProviders.info(),
      memoryProviders: this.memoryProviders.info(),
      workers: this.workers.info(),
      tools: catalogTools(this.tools.keys()),
      memoryNamespaces: memoryNamespacesOf(
        this.stores.handles,
        this.memoryProviders,
        this.config().defaultMemoryProvider,
      ),
    });
  }

  @Remote("inspectMemory")
  async inspectMemory(
    domainId: string,
    namespace: string,
    limit: number,
  ): Promise<MemoryInspectResult> {
    return inspectDomainMemory(this.memoryAccess, domainId, namespace, limit);
  }

  @Remote("clearMemory")
  async clearMemory(
    domainId: string,
    namespace: string,
  ): Promise<MemoryClearResult> {
    return clearDomainMemory(
      this.memoryAccess,
      domainId,
      namespace,
      this.logger,
    );
  }

  @Remote("testExpert")
  async testExpert(
    domainId: string,
    task: string,
    parentSessionId: string,
  ): Promise<ExpertRunResult> {
    return guarded(async () => {
      const { handles, definition } = await this.stores.addressed(domainId);
      const parent = testParentOf(
        agentsFaceOf(this.ctx.agents),
        parentSessionId,
      );
      if (parent === undefined) {
        throw missingTestParent();
      }
      return accepted({
        result: await runExpert(
          this.executionDependencies(handles),
          testRunInput(parent, definition, task),
        ),
      });
    }, expertRunRefusal);
  }

  @Remote("recentAudits")
  recentAudits(limit: number): AuditListResult {
    return accepted({ entries: this.audits.recent(limit > 0 ? limit : 50) });
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
  memoryOwnerOf,
  resolveExpert,
  DEPLOYMENT_MEMORY_OWNER,
  EXPERT_INFRASTRUCTURE_TOOLS,
  TOOL_ALIASES,
  type MemoryOwner,
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
export {
  createSqliteMemoryProvider,
  SQLITE_MEMORY_PROVIDER_ID,
  type MemoryImportReport,
  type SqliteMemoryProvider,
  type SqliteMemoryProviderOptions,
} from "./host/memory/sqlite.js";
// The scorer and the record builder travel with the provider they keep honest:
// a third-party memory provider added through `registerMemoryProvider` has to
// answer with the same records in the same order, and cannot be held to that by
// a contract it has to reimplement.
export {
  buildMemoryRecord,
  clampLimit,
  compareRecords,
  compareScored,
  countHits,
  searchTextOf,
  tokenize,
  type MemoryTable,
} from "./host/memory/shared.js";
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
