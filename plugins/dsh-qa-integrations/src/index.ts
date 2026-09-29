import type { Context, Fiber } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import {
  createHostLoggerSink,
  getPluginLogger,
  type PluginLogger,
} from "@yadsh/dsh-plugin-log";
import type { QaSurface } from "@yadsh/dsh-qa-surface";
import { IntegrationBroker } from "./broker.js";
import {
  ConfigSchema,
  resolveConfig,
  snapshotConfig,
  type LiveQaIntegrationsConfig,
  type ResolvedQaIntegrationsConfig,
} from "./config.js";
import { IntegrationError, publicIntegrationError } from "./errors.js";
import Bitrix24Provider from "./providers/bitrix24/index.js";
import ConfluenceProvider from "./providers/confluence/index.js";
import type { IntegrationProvider } from "./providers/contract.js";
import {
  GITLAB_CI_SPLIT_CAPABILITIES,
  GITLAB_LEGACY_CI_CAPABILITY,
} from "./providers/gitlab/catalog.js";
import GitlabProvider from "./providers/gitlab/index.js";
import JiraProvider from "./providers/jira/index.js";
import { IntegrationProviderRegistry } from "./providers/registry.js";
import TeamcityProvider from "./providers/teamcity/index.js";
import { networkAllowsNothing } from "./providers/teamcity/config.js";
import { TEAMCITY_INSTANCE_ID } from "./providers/teamcity/catalog.js";
import TestitProvider from "./providers/testit/index.js";
import WeblateProvider from "./providers/weblate/index.js";
import { IntegrationRepository } from "./repository.js";
import { DockerSecretKeyProvider } from "./secrets/key-provider.js";
import { SecretStore } from "./secrets/secret-store.js";
import { ServiceCredentialRegistry } from "./service-credentials/registry.js";
import { createIntegrationTools, integrationToolNames } from "./tools.js";
import type {
  CredentialSource,
  IntegrationInstanceSummary,
  ServiceCredentialHealth,
  IntegrationPrincipal,
  IntegrationProviderId,
  IntegrationProviderSummary,
  IntegrationServiceBoundary,
  IntegrationSummary,
  PolicyPatch,
} from "./types.js";

export const name = "dsh-qa-integrations";
export const inject = ["qaSurface", "tools"] as const;
export const Config = ConfigSchema;

type IntegrationsContext = Context & { readonly qaSurface: QaSurface };

declare module "@deepseek-ai/cordis" {
  interface Context {
    qaIntegrations: QaIntegrations;
  }
}

/** What the settings client needs to render a provider it has never seen. */
function providerSummary(
  provider: IntegrationProvider,
): IntegrationProviderSummary {
  return {
    id: provider.id,
    displayName: provider.displayName,
    enabled: true,
    authModes: ["token"],
    capabilities: provider.capabilities,
    credentialHelp: provider.credentialHelp,
  };
}

/** The `.json` sibling of a `.db` path: what a deployment upgraded from. */
function legacySiblingOf(filePath: string): string | undefined {
  return filePath.endsWith(".db")
    ? `${filePath.slice(0, -".db".length)}.json`
    : undefined;
}

/**
 * One row of a provider's connect-form list: the address a token may be spent
 * against, and the managed credential bound to it when this deployment has one.
 * Every provider's list is this shape, so the shape is stated once; the
 * deployment type travels only for the two products that distinguish the
 * vendor's hosted installation from a self-hosted one, and its absence is what
 * tells the client to read the resolver's own default.
 */
function instanceSummary(
  row: {
    readonly id: string;
    readonly label: string;
    readonly baseUrl: string;
    readonly deploymentType?: "cloud" | "server" | undefined;
  },
  service: { readonly label: string } | null,
): IntegrationInstanceSummary {
  return {
    id: row.id,
    label: row.label,
    baseUrl: row.baseUrl,
    ...(row.deploymentType === undefined
      ? {}
      : { deploymentType: row.deploymentType }),
    service,
  };
}

/** Host remote, broker owner, and registration point for read-only tools. */
export class QaIntegrations extends TypertRemoteService {
  static inject = inject;
  static Config = ConfigSchema;

  readonly broker: IntegrationBroker;
  private readonly logger: PluginLogger;
  private readonly owner: IntegrationsContext;
  private enabled = false;
  /** Providers by id; the service-credential registry resolves through them. */
  private providerRegistry = new IntegrationProviderRegistry();
  /** Absent unless the deployment configured managed service credentials. */
  private serviceCredentials: ServiceCredentialRegistry | undefined;
  private defaultForNewConnections = true;
  private providerSummaries: readonly IntegrationProviderSummary[] = [];
  private configuredInstances: readonly IntegrationInstanceSummary[] = [];
  /** The Confluence sites this deployment dials, for the connect form. */
  private configuredConfluenceSites: readonly IntegrationInstanceSummary[] = [];
  /** The Jira Cloud sites this deployment allows, in config order. */
  private configuredJiraSites: readonly IntegrationInstanceSummary[] = [];
  /** The TeamCity server this deployment dials, or null when it mounts none. */
  private configuredServer: IntegrationInstanceSummary | null = null;
  /** The Test IT installations this deployment allows, in config order. */
  private configuredTestitInstances: readonly IntegrationInstanceSummary[] = [];
  /** The Weblate instances this deployment allows, in config order. */
  private configuredWeblateInstances: readonly IntegrationInstanceSummary[] =
    [];
  /** The Bitrix24 portals this deployment allows, in config order. */
  private configuredBitrix24Portals: readonly IntegrationInstanceSummary[] = [];
  /**
   * The configuration source is the plugin's own profile entry: on a 0.1.7
   * host the entry id *is* the settings namespace, and a field the operator
   * card may edit is a volatile node in `ConfigSchema` rather than a section
   * installed beside it. A composition without a settings surface keeps the
   * same source, so nothing here depends on the surface being reachable.
   */
  private readonly liveConfig: LiveQaIntegrationsConfig;
  /**
   * The connection store and its key live for the whole process: connections
   * and wrapped secrets belong to the boot path, and only derivations of the
   * configuration re-apply while running.
   */
  private readonly repository: IntegrationRepository;
  private readonly secrets: SecretStore;
  private readonly bootDataPath: string;
  private readonly bootMasterKeyPath: string;
  private readonly bootMasterKeyVersion: number;
  /** Removers of the currently mounted admission and tool registrations. */
  private toolRemovers: readonly (() => void)[] = [];
  /** The mounted tool-name list; an unchanged signature never re-registers. */
  private toolsKey = "";

  constructor(ctx: IntegrationsContext, rawConfig: LiveQaIntegrationsConfig) {
    super(ctx, "qaIntegrations", { namespace: "qaIntegrations" });
    this.owner = ctx;
    this.logger = getPluginLogger({
      pluginId: "dsh-qa-integrations",
      consoleSink: createHostLoggerSink(ctx.logger),
    });
    this.liveConfig = rawConfig;
    const boot = resolveConfig(snapshotConfig(rawConfig));
    const repository = new IntegrationRepository(boot.dataPath, {
      auditRetentionDays: boot.auditRetentionDays,
    });
    // A deployment upgrading from the JSON store keeps its connections: the
    // file is imported, verified and renamed aside before the broker serves.
    repository.importLegacyFile(legacySiblingOf(boot.dataPath));
    // A provider that split one capability into two names the pair here; the
    // store stays provider-agnostic and the composition root is where the
    // knowledge of a provider belongs.
    repository.expandCapabilities({
      [GITLAB_LEGACY_CI_CAPABILITY]: GITLAB_CI_SPLIT_CAPABILITIES,
    });
    this.repository = repository;
    this.secrets = new SecretStore(
      new DockerSecretKeyProvider(boot.masterKeyPath, boot.masterKeyVersion),
    );
    this.bootDataPath = boot.dataPath;
    this.bootMasterKeyPath = boot.masterKeyPath;
    this.bootMasterKeyVersion = boot.masterKeyVersion;
    this.broker = new IntegrationBroker(
      repository,
      this.secrets,
      new IntegrationProviderRegistry(),
      this.logger,
      {},
    );
    this.applyConfig(boot);
    this.watchSettings();
    ctx.effect(
      () => () => {
        for (const remove of this.toolRemovers) remove();
        this.toolRemovers = [];
      },
      "dsh-qa-integrations.tools",
    );
    ctx.effect(
      () => async () => this.logger.close(),
      "dsh-qa-integrations.logger",
    );
    // The store owns the SQLite handle and its WAL. A plugin that reloads
    // without closing it leaves the files held for the next instance (the
    // observations that prompted this are the stray `qa-integrations.db*` a
    // local run leaves in the plugin directory).
    ctx.effect(
      () => () => {
        repository.close();
      },
      "dsh-qa-integrations.repository",
    );
  }

  /**
   * Rebuild every configuration-derived surface: the provider registry, the
   * deployment instance lists, the service-credential registry and the tool
   * mount. The store and its key do not travel here — connections and wrapped
   * secrets belong to the boot path, and a card edit that re-points them is
   * answered with a warning instead of a live reopen.
   */
  private applyConfig(config: ResolvedQaIntegrationsConfig): void {
    this.enabled = config.enabled;
    if (
      config.dataPath !== this.bootDataPath ||
      config.masterKeyPath !== this.bootMasterKeyPath ||
      config.masterKeyVersion !== this.bootMasterKeyVersion
    ) {
      this.logger.warn("config.store-path-needs-restart", {
        dataPath: config.dataPath,
        masterKeyPath: config.masterKeyPath,
      });
    }
    const providers = new IntegrationProviderRegistry();
    if (config.bitrix24.enabled) {
      providers.register(new Bitrix24Provider(config));
    }
    if (config.confluence.enabled) {
      providers.register(new ConfluenceProvider(config));
    }
    if (config.gitlab.enabled) {
      providers.register(new GitlabProvider(config));
    }
    if (config.teamcity.enabled) {
      providers.register(new TeamcityProvider(config));
    }
    if (config.jira.enabled) {
      providers.register(new JiraProvider(config));
    }
    if (config.testit.enabled) {
      providers.register(new TestitProvider(config));
    }
    if (config.weblate.enabled) {
      providers.register(new WeblateProvider(config));
    }
    this.providerRegistry = providers;
    this.defaultForNewConnections =
      config.managedServiceCredentials.defaultForNewConnections;
    // Profiles are resolved to a portal here, at apply time: deployment
    // configuration that names a provider instance nobody configured fails
    // loudly instead of leaving users with a checkbox that cannot work.
    this.serviceCredentials = config.managedServiceCredentials.enabled
      ? new ServiceCredentialRegistry(
          config.managedServiceCredentials,
          (providerId, instanceId) => {
            const provider = providers.find(providerId);
            if (provider === undefined) {
              throw new Error(
                `qa-integrations managed service credentials: a profile names provider "${providerId}", which this deployment does not enable`,
              );
            }
            try {
              return provider.instancePortal?.(instanceId);
            } catch {
              return undefined;
            }
          },
        )
      : undefined;
    this.providerSummaries = this.enabled
      ? providers.list().map(providerSummary)
      : [];
    this.configuredConfluenceSites = config.confluence.enabled
      ? config.confluence.instances.map((site) =>
          instanceSummary(site, this.serviceBinding("confluence", site.id)),
        )
      : [];
    this.configuredInstances = config.gitlab.enabled
      ? config.gitlab.instances.map((instance) =>
          instanceSummary(instance, this.serviceBinding("gitlab", instance.id)),
        )
      : [];
    this.configuredJiraSites = config.jira.enabled
      ? config.jira.sites.map((site) =>
          instanceSummary(site, this.serviceBinding("jira", site.id)),
        )
      : [];
    this.configuredTestitInstances = config.testit.enabled
      ? config.testit.instances.map((instance) =>
          instanceSummary(instance, this.serviceBinding("testit", instance.id)),
        )
      : [];
    // The portal a Bitrix24 connection answers on is a hostname, not a URL —
    // the same shape a webhook URL reports, so profile and connection match.
    this.configuredBitrix24Portals = config.bitrix24.enabled
      ? config.bitrix24.instances.map((portal) =>
          instanceSummary(
            { id: portal.id, label: portal.label, baseUrl: portal.portal },
            this.serviceBinding("bitrix24", portal.id),
          ),
        )
      : [];
    this.configuredServer =
      config.teamcity.enabled && config.teamcity.serverUrl !== ""
        ? {
            id: TEAMCITY_INSTANCE_ID,
            label: new URL(config.teamcity.serverUrl).host,
            baseUrl: config.teamcity.serverUrl,
            service: this.serviceBinding("teamcity", TEAMCITY_INSTANCE_ID),
          }
        : null;
    this.configuredWeblateInstances = config.weblate.enabled
      ? config.weblate.instances.map((instance) =>
          instanceSummary(
            instance,
            this.serviceBinding("weblate", instance.id),
          ),
        )
      : [];
    // The broker is one object for the service's lifetime — the mounted tools
    // close over it — so a fresh configuration is swapped in rather than
    // mounted beside the old one.
    this.broker.swap(
      providers,
      this.serviceCredentials,
      this.defaultForNewConnections,
      config.managedServiceCredentials.rateLimit,
    );
    this.syncTools(config);
    if (
      config.teamcity.enabled &&
      networkAllowsNothing(config.teamcity.network)
    ) {
      // A TeamCity deployment whose address policy is empty refuses every
      // connect form. Saying so here saves the operator a support round trip.
      this.logger.warn("teamcity.address-policy-empty", {
        hint: "set teamcity.network.allowedHosts or network.allowedCidrs",
      });
    }
    for (const provider of providers.list()) {
      for (const problem of provider.credentialHelpProblems ?? []) {
        // A help address the deployment got wrong hides its own link and is
        // reported here: the credential field keeps working, which is why this
        // is a warning and not a load failure.
        this.logger.warn("credential-help.override", {
          provider: provider.id,
          problem,
        });
      }
    }
  }

  /**
   * Mount the tools the configuration asks for. The mounted surface changes only
   * when the plugin, its one write capability, or the managed service credential
   * flips, so an unrelated card edit never churns the Host tool registry.
   */
  private syncTools(config: ResolvedQaIntegrationsConfig): void {
    // The providers this configuration kept: switching one off takes its tools
    // away from the model too, so a disabled integration leaves nothing mounted
    // that every call could only refuse.
    const enabledProviders = this.providerRegistry
      .list()
      .map((provider) => provider.id);
    const managedCeiling = config.managedServiceCredentials.enabled;
    const toolOptions = {
      bitrix24CrmCommentWrite: config.bitrix24.crmCommentWrite,
      enabledProviders,
      // Which readings the ceiling refuses is in the tool descriptions, so the
      // slice decides what the model is told about them.
      managedServiceCredentialsEnabled: managedCeiling,
    };
    const names = config.enabled ? integrationToolNames(toolOptions) : [];
    // The key carries the slice because a description is part of the mounted
    // surface: without it, toggling the managed credential would leave the old
    // warnings — or their absence — in the Host registry.
    const signature = `${names.join(",")}|ceiling=${managedCeiling}`;
    if (signature === this.toolsKey) return;
    for (const remove of this.toolRemovers) remove();
    this.toolRemovers = [];
    this.toolsKey = signature;
    if (names.length === 0) {
      this.logger.info("plugin.disabled", { tools: [] });
      return;
    }
    const removeAdmission =
      this.owner.qaSurface.registerPrincipalScopedTools(names);
    const removers = createIntegrationTools({
      broker: this.broker,
      principalForSession: (sessionId) =>
        this.owner.qaSurface.principalForSession(sessionId),
      ...toolOptions,
    }).map((definition) => this.owner.tools.register(definition));
    this.toolRemovers = [removeAdmission, ...removers];
    this.logger.info("plugin.ready", { tools: [...names] });
  }

  /**
   * Keep the running service in step with the settings namespace this entry
   * owns. There is nothing to install: the namespace *is* the profile entry,
   * and the Host serves whatever `ConfigSchema` marks `.volatile()`. Two things
   * are left to do — decline the generated page the Host would otherwise draw
   * for it, because this plugin ships its own operator card, and re-apply when
   * a committed edit lands on the live references. The read is structural and
   * optional: a Host without a mounted settings provider keeps this plugin
   * fully working.
   */
  private watchSettings(): void {
    this.owner.inject(["settings"], (settingsCtx) => {
      const settings = (
        settingsCtx as unknown as { settings?: SettingsSurface }
      ).settings;
      if (settings === undefined) return;
      settingsCtx.effect(() =>
        settings.configure({ auto: false }, this.owner.fiber),
      );
    });
    // The Loader commits a card edit into this entry's volatile references and
    // tells the owning fiber, and only the owning fiber, that they moved. The
    // event belongs to the Loader's own types, which this package does not
    // depend on, so it is reached through the same structural face as the
    // optional settings service above.
    (this.owner as unknown as VolatileUpdateFace).on(
      "loader/volatile-update",
      () => {
        this.reapply();
      },
    );
  }

  /**
   * Re-resolve the source after a committed settings change and rebuild what
   * derives from it. The Host validates an edit against `ConfigSchema` before
   * it persists, so the resolvers here only refuse what a schema node cannot
   * express — a TeamCity host pattern that matches nothing, an instance list
   * with a duplicate id. Such a value keeps the running state and is logged
   * rather than half-applied.
   */
  private reapply(): void {
    let next: ResolvedQaIntegrationsConfig;
    try {
      next = resolveConfig(snapshotConfig(this.liveConfig));
    } catch (error) {
      this.logger.warn("config.rejected", {
        message: String((error as Error).message),
      });
      return;
    }
    this.applyConfig(next);
    this.logger.info("config.reloaded", {
      enabled: next.enabled,
      providers: this.providerSummaries.map((provider) => provider.id),
    });
  }

  @Remote("describe")
  describe(): {
    readonly enabled: boolean;
    readonly providers: readonly IntegrationProviderId[];
  } {
    return {
      enabled: this.enabled,
      providers: this.providerSummaries.map((provider) => provider.id),
    };
  }

  @Remote("providers")
  providers(token: string): readonly IntegrationProviderSummary[] {
    return this.run(token, () => this.broker.listProviders());
  }

  @Remote("list")
  list(token: string): readonly IntegrationSummary[] {
    return this.run(token, (principal) => this.broker.list(principal));
  }

  @Remote("getBitrix24")
  getBitrix24(token: string): IntegrationSummary {
    return this.summaryOf(token, "bitrix24");
  }

  @Remote("putBitrix24Credential")
  async putBitrix24Credential(
    token: string,
    input: {
      readonly instanceId: string;
      readonly token: string;
      /** Whether the connect form asked for the managed credential instead. */
      readonly useServiceCredential?: boolean | undefined;
    },
  ): Promise<IntegrationSummary> {
    return this.putCredentialOf(token, "bitrix24", {
      token: input.token,
      options: { instanceId: input.instanceId },
      useServiceCredential: input.useServiceCredential,
    });
  }

  @Remote("bitrix24Instances")
  bitrix24Instances(token: string): readonly IntegrationInstanceSummary[] {
    return this.endpointsOf(token, this.configuredBitrix24Portals);
  }

  @Remote("testBitrix24")
  async testBitrix24(token: string): Promise<IntegrationSummary> {
    return this.validateOf(token, "bitrix24");
  }

  @Remote("patchBitrix24Policy")
  patchBitrix24Policy(token: string, patch: PolicyPatch): IntegrationSummary {
    return this.patchPolicyOf(token, "bitrix24", patch);
  }

  @Remote("disconnectBitrix24")
  disconnectBitrix24(token: string): boolean {
    return this.disconnectOf(token, "bitrix24");
  }

  @Remote("gitlabInstances")
  gitlabInstances(token: string): readonly IntegrationInstanceSummary[] {
    return this.endpointsOf(token, this.configuredInstances);
  }

  @Remote("getGitlab")
  getGitlab(token: string): IntegrationSummary {
    return this.summaryOf(token, "gitlab");
  }

  @Remote("putGitlabCredential")
  async putGitlabCredential(
    token: string,
    input: {
      readonly instanceId: string;
      readonly token: string;
      /** Whether the connect form asked for the managed credential instead. */
      readonly useServiceCredential?: boolean | undefined;
    },
  ): Promise<IntegrationSummary> {
    return this.putCredentialOf(token, "gitlab", {
      token: input.token,
      options: { instanceId: input.instanceId },
      useServiceCredential: input.useServiceCredential,
    });
  }

  @Remote("testGitlab")
  async testGitlab(token: string): Promise<IntegrationSummary> {
    return this.validateOf(token, "gitlab");
  }

  @Remote("patchGitlabPolicy")
  patchGitlabPolicy(token: string, patch: PolicyPatch): IntegrationSummary {
    return this.patchPolicyOf(token, "gitlab", patch);
  }

  @Remote("disconnectGitlab")
  disconnectGitlab(token: string): boolean {
    return this.disconnectOf(token, "gitlab");
  }

  @Remote("confluenceSites")
  confluenceSites(token: string): readonly IntegrationInstanceSummary[] {
    return this.endpointsOf(token, this.configuredConfluenceSites);
  }

  @Remote("getConfluence")
  getConfluence(token: string): IntegrationSummary {
    return this.summaryOf(token, "confluence");
  }

  /**
   * The account e-mail is not a secret, but it is half of the Basic pair, so it
   * travels with the secret instead of being a separate field: both halves land
   * in one encrypted record, and a token can never be spent as another account.
   * A Server / Data Center instance authenticates with a personal access token
   * alone, so its connect sends no e-mail and the instance's declared
   * deployment type is what makes that shape acceptable.
   */
  @Remote("putConfluenceCredential")
  async putConfluenceCredential(
    token: string,
    input: {
      readonly instanceId: string;
      /** Absent on a Server / Data Center connect, which needs no account. */
      readonly email?: string | undefined;
      readonly token: string;
      /** Whether the connect form asked for the managed credential instead. */
      readonly useServiceCredential?: boolean | undefined;
    },
  ): Promise<IntegrationSummary> {
    return this.putCredentialOf(token, "confluence", {
      token: input.token,
      options: {
        instanceId: input.instanceId,
        ...(input.email === undefined ? {} : { email: input.email }),
      },
      useServiceCredential: input.useServiceCredential,
    });
  }

  @Remote("testConfluence")
  async testConfluence(token: string): Promise<IntegrationSummary> {
    return this.validateOf(token, "confluence");
  }

  @Remote("patchConfluencePolicy")
  patchConfluencePolicy(token: string, patch: PolicyPatch): IntegrationSummary {
    return this.patchPolicyOf(token, "confluence", patch);
  }

  @Remote("disconnectConfluence")
  disconnectConfluence(token: string): boolean {
    return this.disconnectOf(token, "confluence");
  }

  @Remote("getTeamcity")
  getTeamcity(token: string): IntegrationSummary {
    return this.summaryOf(token, "teamcity");
  }

  /**
   * The TeamCity address is operator configuration, so the connect form sends
   * the token alone: a user cannot point the broker at a host of their choosing,
   * and the address a token is spent against is re-read from the deployment on
   * every call.
   */
  @Remote("putTeamcityCredential")
  async putTeamcityCredential(
    token: string,
    input: {
      readonly token: string;
      /** Whether the connect form asked for the managed credential instead. */
      readonly useServiceCredential?: boolean | undefined;
    },
  ): Promise<IntegrationSummary> {
    return this.putCredentialOf(token, "teamcity", {
      token: input.token,
      useServiceCredential: input.useServiceCredential,
    });
  }

  /**
   * The address the connect form shows next to the token field, or null when
   * this deployment configured none. Token-gated like the GitLab instance list:
   * a card has to be able to say "nothing to connect to here", and the address
   * of the stand's CI is not something an unauthenticated caller needs.
   */
  @Remote("teamcityServer")
  teamcityServer(token: string): IntegrationInstanceSummary | null {
    return this.endpointsOf(token, this.configuredServer);
  }

  @Remote("testTeamcity")
  async testTeamcity(token: string): Promise<IntegrationSummary> {
    return this.validateOf(token, "teamcity");
  }

  @Remote("patchTeamcityPolicy")
  patchTeamcityPolicy(token: string, patch: PolicyPatch): IntegrationSummary {
    return this.patchPolicyOf(token, "teamcity", patch);
  }

  @Remote("disconnectTeamcity")
  disconnectTeamcity(token: string): boolean {
    return this.disconnectOf(token, "teamcity");
  }

  @Remote("jiraSites")
  jiraSites(token: string): readonly IntegrationInstanceSummary[] {
    return this.endpointsOf(token, this.configuredJiraSites);
  }

  @Remote("getJira")
  getJira(token: string): IntegrationSummary {
    return this.summaryOf(token, "jira");
  }

  @Remote("putJiraCredential")
  async putJiraCredential(
    token: string,
    input: {
      readonly siteId: string;
      /**
       * Absent on a Server / Data Center connect: a personal access token
       * authenticates as its own bearer and needs no account.
       */
      readonly email?: string | undefined;
      readonly token: string;
      /** Whether the connect form asked for the managed credential instead. */
      readonly useServiceCredential?: boolean | undefined;
    },
  ): Promise<IntegrationSummary> {
    return this.putCredentialOf(token, "jira", {
      token: input.token,
      // The broker resolves the profile by `instanceId`; Jira names its
      // instances `siteId` on the wire.
      options: {
        instanceId: input.siteId,
        ...(input.email === undefined ? {} : { email: input.email }),
      },
      useServiceCredential: input.useServiceCredential,
    });
  }

  @Remote("testJira")
  async testJira(token: string): Promise<IntegrationSummary> {
    return this.validateOf(token, "jira");
  }

  @Remote("patchJiraPolicy")
  patchJiraPolicy(token: string, patch: PolicyPatch): IntegrationSummary {
    return this.patchPolicyOf(token, "jira", patch);
  }

  @Remote("disconnectJira")
  disconnectJira(token: string): boolean {
    return this.disconnectOf(token, "jira");
  }

  @Remote("testitInstances")
  testitInstances(token: string): readonly IntegrationInstanceSummary[] {
    return this.endpointsOf(token, this.configuredTestitInstances);
  }

  @Remote("getTestit")
  getTestit(token: string): IntegrationSummary {
    return this.summaryOf(token, "testit");
  }

  @Remote("putTestitCredential")
  async putTestitCredential(
    token: string,
    input: {
      readonly instanceId: string;
      readonly token: string;
      /** Whether the connect form asked for the managed credential instead. */
      readonly useServiceCredential?: boolean | undefined;
    },
  ): Promise<IntegrationSummary> {
    return this.putCredentialOf(token, "testit", {
      token: input.token,
      options: { instanceId: input.instanceId },
      useServiceCredential: input.useServiceCredential,
    });
  }

  @Remote("testTestit")
  async testTestit(token: string): Promise<IntegrationSummary> {
    return this.validateOf(token, "testit");
  }

  @Remote("patchTestitPolicy")
  patchTestitPolicy(token: string, patch: PolicyPatch): IntegrationSummary {
    return this.patchPolicyOf(token, "testit", patch);
  }

  @Remote("disconnectTestit")
  disconnectTestit(token: string): boolean {
    return this.disconnectOf(token, "testit");
  }

  @Remote("weblateInstances")
  weblateInstances(token: string): readonly IntegrationInstanceSummary[] {
    return this.endpointsOf(token, this.configuredWeblateInstances);
  }

  @Remote("getWeblate")
  getWeblate(token: string): IntegrationSummary {
    return this.summaryOf(token, "weblate");
  }

  @Remote("putWeblateCredential")
  async putWeblateCredential(
    token: string,
    input: {
      readonly instanceId: string;
      readonly token: string;
      /** Whether the connect form asked for the managed credential instead. */
      readonly useServiceCredential?: boolean | undefined;
    },
  ): Promise<IntegrationSummary> {
    return this.putCredentialOf(token, "weblate", {
      token: input.token,
      options: { instanceId: input.instanceId },
      useServiceCredential: input.useServiceCredential,
    });
  }

  @Remote("testWeblate")
  async testWeblate(token: string): Promise<IntegrationSummary> {
    return this.validateOf(token, "weblate");
  }

  @Remote("patchWeblatePolicy")
  patchWeblatePolicy(token: string, patch: PolicyPatch): IntegrationSummary {
    return this.patchPolicyOf(token, "weblate", patch);
  }

  @Remote("disconnectWeblate")
  disconnectWeblate(token: string): boolean {
    return this.disconnectOf(token, "weblate");
  }

  /**
   * Whether this deployment offers managed service credentials at all, and
   * whether a new connection starts on one. Token-gated like every other card
   * call: the answer describes the deployment, not the caller.
   */
  @Remote("managedServiceCredentials")
  managedServiceCredentials(token: string): {
    readonly enabled: boolean;
    readonly defaultForNewConnections: boolean;
  } {
    return this.run(token, () => ({
      enabled: this.serviceCredentials !== undefined,
      defaultForNewConnections: this.defaultForNewConnections,
    }));
  }

  /**
   * Switch one provider of the calling principal between their own credential
   * and the deployment's. The provider id is validated against the registry, and
   * the profile is resolved server-side, so no caller can name a credential.
   */
  @Remote("credentialSource")
  async credentialSource(
    token: string,
    input: {
      readonly provider: IntegrationProviderId;
      readonly source: CredentialSource;
    },
  ): Promise<IntegrationSummary> {
    return this.runAsync(token, (principal) =>
      this.broker.setCredentialSource(principal, input.provider, input.source),
    );
  }

  /**
   * Narrow what this connection may read inside the profile's allowlist. A
   * selection outside that allowlist is dropped rather than stored, so this can
   * only ever remove.
   */
  @Remote("serviceBoundary")
  serviceBoundary(
    token: string,
    input: {
      readonly provider: IntegrationProviderId;
      readonly selection: IntegrationServiceBoundary | null;
    },
  ): IntegrationSummary {
    return this.run(token, (principal) =>
      this.broker.setServiceSelection(
        principal,
        input.provider,
        input.selection,
      ),
    );
  }

  /**
   * Probe the managed credential of one provider instance. Answers a health
   * status, never the secret and never the upstream identity it carries.
   */
  @Remote("serviceHealth")
  serviceHealth(
    token: string,
    input: {
      readonly provider: IntegrationProviderId;
      readonly instanceId: string;
    },
  ): Promise<ServiceCredentialHealth | null> {
    return this.runAsync(token, () =>
      this.broker.serviceCredentialHealth(input.provider, input.instanceId),
    );
  }

  /** The safe alias of the managed credential bound to one instance, if any. */
  private serviceBinding(
    providerId: IntegrationProviderId,
    instanceId: string,
  ): { readonly label: string } | null {
    const registry = this.serviceCredentials;
    if (registry === undefined) return null;
    let portal: string | undefined;
    try {
      portal = this.providerRegistry
        .find(providerId)
        ?.instancePortal?.(instanceId);
    } catch {
      return null;
    }
    if (portal === undefined || portal === "") return null;
    const profile = registry.find(providerId, portal);
    return profile?.enabled === true ? { label: profile.label } : null;
  }

  /**
   * The six calls one provider's connect card makes, and the fields that card
   * spends. What a provider owns is the address list it offers and the fields
   * its form collects; the questions the card asks the broker — what is bound,
   * does the credential still reach the upstream, narrow its policy, let it go —
   * are the same seven times over, and a copy per provider is where the seventh
   * starts answering one of them differently.
   */
  private summaryOf(
    token: string,
    provider: IntegrationProviderId,
  ): IntegrationSummary {
    return this.run(token, (principal) =>
      this.broker.summary(principal, provider),
    );
  }

  private async validateOf(
    token: string,
    provider: IntegrationProviderId,
  ): Promise<IntegrationSummary> {
    return this.runAsync(token, (principal) =>
      this.broker.validate(principal, provider),
    );
  }

  private patchPolicyOf(
    token: string,
    provider: IntegrationProviderId,
    patch: PolicyPatch,
  ): IntegrationSummary {
    return this.run(token, (principal) =>
      this.broker.patchPolicy(principal, provider, patch),
    );
  }

  private disconnectOf(
    token: string,
    provider: IntegrationProviderId,
  ): boolean {
    return this.run(token, (principal) =>
      this.broker.disconnect(principal, provider),
    );
  }

  /**
   * The endpoints this deployment declared for one provider. A connect form
   * picks from this list and never takes a hostname, which is what keeps the
   * broker from being pointed at an origin the operator did not configure.
   * TeamCity answers with the single server or `null`, so the row shape is the
   * caller's.
   */
  private endpointsOf<T>(token: string, endpoints: T): T {
    return this.run(token, () => endpoints);
  }

  /** Spend one connect form's fields on a provider's credential. */
  private async putCredentialOf(
    token: string,
    provider: IntegrationProviderId,
    input: {
      readonly token: string;
      readonly options?: Readonly<Record<string, string>> | undefined;
      readonly useServiceCredential?: boolean | undefined;
    },
  ): Promise<IntegrationSummary> {
    return this.runAsync(token, (principal) =>
      this.broker.connect(
        principal,
        provider,
        input.options === undefined
          ? { token: input.token }
          : { token: input.token, options: input.options },
        { useServiceCredential: input.useServiceCredential },
      ),
    );
  }

  private requirePrincipal(token: string): IntegrationPrincipal {
    if (!this.enabled) {
      throw new IntegrationError(
        "ProviderUnavailable",
        "QA integrations are disabled",
      );
    }
    const principal = (
      this.ctx as IntegrationsContext
    ).qaSurface.principalForToken(token);
    if (principal === undefined) {
      throw new IntegrationError(
        "PrincipalNotResolved",
        "A valid QA account is required",
      );
    }
    return principal;
  }

  private run<T>(
    token: string,
    operation: (principal: IntegrationPrincipal) => T,
  ): T {
    try {
      return operation(this.requirePrincipal(token));
    } catch (error) {
      throw publicIntegrationError(error);
    }
  }

  private async runAsync<T>(
    token: string,
    operation: (principal: IntegrationPrincipal) => Promise<T>,
  ): Promise<T> {
    try {
      return await operation(this.requirePrincipal(token));
    } catch (error) {
      throw publicIntegrationError(error);
    }
  }
}

/**
 * The published names of this package are listed once, in `public-api.ts`;
 * re-exported here so the entry module stays the one thing a consumer resolves.
 */
export * from "./public-api.js";

export default QaIntegrations;

/** Structural face of the optional Host settings service, read defensively. */
interface SettingsSurface {
  configure(presentation: { auto?: boolean }, owner?: Fiber): () => void;
}

/**
 * Structural face of the Loader event that announces a volatile config commit.
 * The declaration lives in the Loader's own package, which this plugin does not
 * depend on; the listener is owned by this fiber either way, so it leaves with
 * the fiber and needs no disposer of its own.
 */
interface VolatileUpdateFace {
  on(
    name: "loader/volatile-update",
    listener: (paths: readonly (readonly string[])[]) => void,
  ): unknown;
}
