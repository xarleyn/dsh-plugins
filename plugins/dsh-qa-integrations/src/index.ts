import type { Context } from "@deepseek-ai/cordis";
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
  type QaIntegrationsConfig,
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
import { createIntegrationTools, INTEGRATION_TOOL_NAMES } from "./tools.js";
import type {
  CredentialInput,
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
  };
}

/** The `.json` sibling of a `.db` path: what a deployment upgraded from. */
function legacySiblingOf(filePath: string): string | undefined {
  return filePath.endsWith(".db")
    ? `${filePath.slice(0, -".db".length)}.json`
    : undefined;
}

/** Host remote, broker owner, and registration point for read-only tools. */
export class QaIntegrations extends TypertRemoteService {
  static inject = inject;
  static Config = ConfigSchema;

  readonly broker: IntegrationBroker;
  private readonly logger: PluginLogger;
  private readonly enabled: boolean;
  /** Providers by id; the service-credential registry resolves through them. */
  private readonly providerRegistry: IntegrationProviderRegistry;
  /** Absent unless the deployment configured managed service credentials. */
  private readonly serviceCredentials: ServiceCredentialRegistry | undefined;
  private readonly defaultForNewConnections: boolean;
  private readonly providerSummaries: readonly IntegrationProviderSummary[];
  private readonly configuredInstances: readonly IntegrationInstanceSummary[];
  /** The Confluence sites this deployment dials, for the connect form. */
  private readonly configuredConfluenceSites: readonly IntegrationInstanceSummary[];
  /** The Jira Cloud sites this deployment allows, in config order. */
  private readonly configuredJiraSites: readonly IntegrationInstanceSummary[];
  /** The TeamCity server this deployment dials, or null when it mounts none. */
  private readonly configuredServer: IntegrationInstanceSummary | null;
  /** The Test IT installations this deployment allows, in config order. */
  private readonly configuredTestitInstances: readonly IntegrationInstanceSummary[];
  /** The Weblate instances this deployment allows, in config order. */
  private readonly configuredWeblateInstances: readonly IntegrationInstanceSummary[];

  constructor(ctx: IntegrationsContext, rawConfig: QaIntegrationsConfig = {}) {
    super(ctx, "qaIntegrations", { namespace: "qaIntegrations" });
    const config = resolveConfig(rawConfig);
    this.enabled = config.enabled;
    this.logger = getPluginLogger({
      pluginId: "dsh-qa-integrations",
      consoleSink: createHostLoggerSink(ctx.logger),
    });
    const repository = new IntegrationRepository(config.dataPath, {
      auditRetentionDays: config.auditRetentionDays,
    });
    // A deployment upgrading from the JSON store keeps its connections: the
    // file is imported, verified and renamed aside before the broker serves.
    repository.importLegacyFile(legacySiblingOf(config.dataPath));
    // A provider that split one capability into two names the pair here; the
    // store stays provider-agnostic and the composition root is where the
    // knowledge of a provider belongs.
    repository.expandCapabilities({
      [GITLAB_LEGACY_CI_CAPABILITY]: GITLAB_CI_SPLIT_CAPABILITIES,
    });
    const secrets = new SecretStore(
      new DockerSecretKeyProvider(
        config.masterKeyPath,
        config.masterKeyVersion,
      ),
    );
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
    // Profiles are resolved to a portal here, at load: deployment configuration
    // that names a provider instance nobody configured fails loudly instead of
    // leaving users with a checkbox that cannot work.
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
      ? config.confluence.instances.map((instance) => ({
          id: instance.id,
          label: instance.label,
          baseUrl: instance.baseUrl,
          service: this.serviceBinding("confluence", instance.id),
        }))
      : [];
    this.configuredInstances = config.gitlab.enabled
      ? config.gitlab.instances.map((instance) => ({
          id: instance.id,
          label: instance.label,
          baseUrl: instance.baseUrl,
          service: this.serviceBinding("gitlab", instance.id),
        }))
      : [];
    this.configuredJiraSites = config.jira.enabled
      ? config.jira.sites.map((site) => ({
          id: site.id,
          label: site.label,
          baseUrl: site.baseUrl,
          service: this.serviceBinding("jira", site.id),
        }))
      : [];
    this.configuredTestitInstances = config.testit.enabled
      ? config.testit.instances.map((instance) => ({
          id: instance.id,
          label: instance.label,
          baseUrl: instance.baseUrl,
          service: this.serviceBinding("testit", instance.id),
        }))
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
      ? config.weblate.instances.map((instance) => ({
          id: instance.id,
          label: instance.label,
          baseUrl: instance.baseUrl,
          service: this.serviceBinding("weblate", instance.id),
        }))
      : [];
    this.broker = new IntegrationBroker(
      repository,
      secrets,
      providers,
      this.logger,
      {
        serviceCredentials: this.serviceCredentials,
        defaultForNewConnections: this.defaultForNewConnections,
      },
    );

    if (config.enabled) {
      const removeAdmission = ctx.qaSurface.registerPrincipalScopedTools(
        INTEGRATION_TOOL_NAMES,
      );
      const removers = createIntegrationTools({
        broker: this.broker,
        principalForSession: (sessionId) =>
          ctx.qaSurface.principalForSession(sessionId),
      }).map((definition) => ctx.tools.register(definition));
      ctx.effect(
        () => () => {
          for (const remove of removers.reverse()) remove();
          removeAdmission();
        },
        "dsh-qa-integrations.tools",
      );
    }
    ctx.effect(
      () => async () => this.logger.close(),
      "dsh-qa-integrations.logger",
    );
    this.logger.info(config.enabled ? "plugin.ready" : "plugin.disabled", {
      tools: config.enabled ? [...INTEGRATION_TOOL_NAMES] : [],
    });
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
    return this.run(token, (principal) =>
      this.broker.summary(principal, "bitrix24"),
    );
  }

  @Remote("putBitrix24Credential")
  async putBitrix24Credential(
    token: string,
    input: CredentialInput,
  ): Promise<IntegrationSummary> {
    return this.runAsync(token, (principal) =>
      this.broker.connect(principal, "bitrix24", input),
    );
  }

  @Remote("testBitrix24")
  async testBitrix24(token: string): Promise<IntegrationSummary> {
    return this.runAsync(token, (principal) =>
      this.broker.validate(principal, "bitrix24"),
    );
  }

  @Remote("patchBitrix24Policy")
  patchBitrix24Policy(token: string, patch: PolicyPatch): IntegrationSummary {
    return this.run(token, (principal) =>
      this.broker.patchPolicy(principal, "bitrix24", patch),
    );
  }

  @Remote("disconnectBitrix24")
  disconnectBitrix24(token: string): boolean {
    return this.run(token, (principal) =>
      this.broker.disconnect(principal, "bitrix24"),
    );
  }

  /**
   * Instances this deployment allows. The connect form picks from this list and
   * never takes a hostname, which is what keeps the broker from being pointed at
   * an origin the operator did not configure.
   */
  @Remote("gitlabInstances")
  gitlabInstances(token: string): readonly IntegrationInstanceSummary[] {
    return this.run(token, () => this.configuredInstances);
  }

  @Remote("getGitlab")
  getGitlab(token: string): IntegrationSummary {
    return this.run(token, (principal) =>
      this.broker.summary(principal, "gitlab"),
    );
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
    return this.runAsync(token, (principal) =>
      this.broker.connect(
        principal,
        "gitlab",
        {
          token: input.token,
          options: { instanceId: input.instanceId },
        },
        { useServiceCredential: input.useServiceCredential },
      ),
    );
  }

  @Remote("testGitlab")
  async testGitlab(token: string): Promise<IntegrationSummary> {
    return this.runAsync(token, (principal) =>
      this.broker.validate(principal, "gitlab"),
    );
  }

  @Remote("patchGitlabPolicy")
  patchGitlabPolicy(token: string, patch: PolicyPatch): IntegrationSummary {
    return this.run(token, (principal) =>
      this.broker.patchPolicy(principal, "gitlab", patch),
    );
  }

  @Remote("disconnectGitlab")
  disconnectGitlab(token: string): boolean {
    return this.run(token, (principal) =>
      this.broker.disconnect(principal, "gitlab"),
    );
  }

  /**
   * Sites this deployment allows. The connect form picks from this list and
   * never takes a hostname, which is what keeps the broker from being pointed
   * at an origin the operator did not configure.
   */
  @Remote("confluenceSites")
  confluenceSites(token: string): readonly IntegrationInstanceSummary[] {
    return this.run(token, () => this.configuredConfluenceSites);
  }

  @Remote("getConfluence")
  getConfluence(token: string): IntegrationSummary {
    return this.run(token, (principal) =>
      this.broker.summary(principal, "confluence"),
    );
  }

  /**
   * The account e-mail is not a secret, but it is half of the Basic pair, so it
   * travels with the secret instead of being a separate field: both halves land
   * in one encrypted record, and a token can never be spent as another account.
   */
  @Remote("putConfluenceCredential")
  async putConfluenceCredential(
    token: string,
    input: {
      readonly instanceId: string;
      readonly email: string;
      readonly token: string;
    },
  ): Promise<IntegrationSummary> {
    return this.runAsync(token, (principal) =>
      this.broker.connect(principal, "confluence", {
        token: input.token,
        options: { instanceId: input.instanceId, email: input.email },
      }),
    );
  }

  @Remote("testConfluence")
  async testConfluence(token: string): Promise<IntegrationSummary> {
    return this.runAsync(token, (principal) =>
      this.broker.validate(principal, "confluence"),
    );
  }

  @Remote("patchConfluencePolicy")
  patchConfluencePolicy(token: string, patch: PolicyPatch): IntegrationSummary {
    return this.run(token, (principal) =>
      this.broker.patchPolicy(principal, "confluence", patch),
    );
  }

  @Remote("disconnectConfluence")
  disconnectConfluence(token: string): boolean {
    return this.run(token, (principal) =>
      this.broker.disconnect(principal, "confluence"),
    );
  }

  @Remote("getTeamcity")
  getTeamcity(token: string): IntegrationSummary {
    return this.run(token, (principal) =>
      this.broker.summary(principal, "teamcity"),
    );
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
    return this.runAsync(token, (principal) =>
      this.broker.connect(
        principal,
        "teamcity",
        { token: input.token },
        { useServiceCredential: input.useServiceCredential },
      ),
    );
  }

  /**
   * The address the connect form shows next to the token field, or null when
   * this deployment configured none. Token-gated like the GitLab instance list:
   * a card has to be able to say "nothing to connect to here", and the address
   * of the stand's CI is not something an unauthenticated caller needs.
   */
  @Remote("teamcityServer")
  teamcityServer(token: string): IntegrationInstanceSummary | null {
    return this.run(token, () => this.configuredServer);
  }

  @Remote("testTeamcity")
  async testTeamcity(token: string): Promise<IntegrationSummary> {
    return this.runAsync(token, (principal) =>
      this.broker.validate(principal, "teamcity"),
    );
  }

  @Remote("patchTeamcityPolicy")
  patchTeamcityPolicy(token: string, patch: PolicyPatch): IntegrationSummary {
    return this.run(token, (principal) =>
      this.broker.patchPolicy(principal, "teamcity", patch),
    );
  }

  @Remote("disconnectTeamcity")
  disconnectTeamcity(token: string): boolean {
    return this.run(token, (principal) =>
      this.broker.disconnect(principal, "teamcity"),
    );
  }

  /**
   * Sites this deployment allows. Like the GitLab instance list, the connect
   * form picks from it and never takes a hostname: the Atlassian site a token is
   * spent against is operator configuration, and the e-mail the form collects
   * next to the token is an identity, not a secret.
   */
  @Remote("jiraSites")
  jiraSites(token: string): readonly IntegrationInstanceSummary[] {
    return this.run(token, () => this.configuredJiraSites);
  }

  @Remote("getJira")
  getJira(token: string): IntegrationSummary {
    return this.run(token, (principal) =>
      this.broker.summary(principal, "jira"),
    );
  }

  @Remote("putJiraCredential")
  async putJiraCredential(
    token: string,
    input: {
      readonly siteId: string;
      readonly email: string;
      readonly token: string;
    },
  ): Promise<IntegrationSummary> {
    return this.runAsync(token, (principal) =>
      this.broker.connect(principal, "jira", {
        token: input.token,
        options: { siteId: input.siteId, email: input.email },
      }),
    );
  }

  @Remote("testJira")
  async testJira(token: string): Promise<IntegrationSummary> {
    return this.runAsync(token, (principal) =>
      this.broker.validate(principal, "jira"),
    );
  }

  @Remote("patchJiraPolicy")
  patchJiraPolicy(token: string, patch: PolicyPatch): IntegrationSummary {
    return this.run(token, (principal) =>
      this.broker.patchPolicy(principal, "jira", patch),
    );
  }

  @Remote("disconnectJira")
  disconnectJira(token: string): boolean {
    return this.run(token, (principal) =>
      this.broker.disconnect(principal, "jira"),
    );
  }

  /**
   * Installations this deployment allows. Like the GitLab instance list, the
   * connect form picks from it and never takes a hostname: the Test IT address a
   * token is spent against is operator configuration.
   */
  @Remote("testitInstances")
  testitInstances(token: string): readonly IntegrationInstanceSummary[] {
    return this.run(token, () => this.configuredTestitInstances);
  }

  @Remote("getTestit")
  getTestit(token: string): IntegrationSummary {
    return this.run(token, (principal) =>
      this.broker.summary(principal, "testit"),
    );
  }

  @Remote("putTestitCredential")
  async putTestitCredential(
    token: string,
    input: { readonly instanceId: string; readonly token: string },
  ): Promise<IntegrationSummary> {
    return this.runAsync(token, (principal) =>
      this.broker.connect(principal, "testit", {
        token: input.token,
        options: { instanceId: input.instanceId },
      }),
    );
  }

  @Remote("testTestit")
  async testTestit(token: string): Promise<IntegrationSummary> {
    return this.runAsync(token, (principal) =>
      this.broker.validate(principal, "testit"),
    );
  }

  @Remote("patchTestitPolicy")
  patchTestitPolicy(token: string, patch: PolicyPatch): IntegrationSummary {
    return this.run(token, (principal) =>
      this.broker.patchPolicy(principal, "testit", patch),
    );
  }

  @Remote("disconnectTestit")
  disconnectTestit(token: string): boolean {
    return this.run(token, (principal) =>
      this.broker.disconnect(principal, "testit"),
    );
  }

  /**
   * Instances this deployment allows. The connect form picks from this list and
   * never takes a hostname, which is what keeps the broker from being pointed at
   * an origin the operator did not configure.
   */
  @Remote("weblateInstances")
  weblateInstances(token: string): readonly IntegrationInstanceSummary[] {
    return this.run(token, () => this.configuredWeblateInstances);
  }

  @Remote("getWeblate")
  getWeblate(token: string): IntegrationSummary {
    return this.run(token, (principal) =>
      this.broker.summary(principal, "weblate"),
    );
  }

  @Remote("putWeblateCredential")
  async putWeblateCredential(
    token: string,
    input: { readonly instanceId: string; readonly token: string },
  ): Promise<IntegrationSummary> {
    return this.runAsync(token, (principal) =>
      this.broker.connect(principal, "weblate", {
        token: input.token,
        options: { instanceId: input.instanceId },
      }),
    );
  }

  @Remote("testWeblate")
  async testWeblate(token: string): Promise<IntegrationSummary> {
    return this.runAsync(token, (principal) =>
      this.broker.validate(principal, "weblate"),
    );
  }

  @Remote("patchWeblatePolicy")
  patchWeblatePolicy(token: string, patch: PolicyPatch): IntegrationSummary {
    return this.run(token, (principal) =>
      this.broker.patchPolicy(principal, "weblate", patch),
    );
  }

  @Remote("disconnectWeblate")
  disconnectWeblate(token: string): boolean {
    return this.run(token, (principal) =>
      this.broker.disconnect(principal, "weblate"),
    );
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

export { IntegrationBroker } from "./broker.js";
export {
  ConfigSchema,
  resolveConfig,
  type QaIntegrationsConfig,
  type ResolvedQaIntegrationsConfig,
} from "./config.js";
export {
  MANAGED_SERVICE_CREDENTIALS_DEFAULTS,
  managedServiceCredentialsSchema,
  resolveManagedServiceCredentials,
  type ManagedServiceCredentialProfileConfig,
  type ManagedServiceCredentialProfileInput,
  type ManagedServiceCredentialsConfig,
  type ManagedServiceCredentialsInput,
} from "./service-credentials/config.js";
export {
  evaluateServiceOperation,
  narrowBoundary,
  SERVICE_CEILING,
  type ServiceOperationQuery,
  type ServicePolicyDecision,
} from "./service-credentials/policy.js";
export { ServiceCredentialRegistry } from "./service-credentials/registry.js";
export { operationCapabilityServiceState } from "./service-credentials/state.js";
export { profilePolicyRevision } from "./service-credentials/config.js";
export {
  CREDENTIAL_SOURCES,
  isCredentialSource,
  UNCLASSIFIED_OPERATION,
  type CredentialSource as ManagedCredentialSource,
  type DataSensitivity,
  type OperationEffect,
  type OperationSecurityMetadata,
  type OperationServiceDecision,
  type ResolvedCredentialContext,
  type ResolvedServiceCredential,
  type SafeExternalIdentity,
  type ServiceCredentialHealth,
  type ServiceCredentialProfile,
  type ServiceCredentialStatus,
  type ServiceResourceBoundary,
} from "./service-credentials/types.js";
export { IntegrationError } from "./errors.js";
export {
  BITRIX_CAPABILITIES,
  BITRIX_OPERATIONS,
  BITRIX24_CAPABILITY_INFO,
  bitrix24OperationCapability,
  enabledCapabilities,
  type Bitrix24Capability,
  type Bitrix24CapabilityDefinition,
  type BitrixOperationDefinition,
} from "./providers/bitrix24/catalog.js";
export {
  BITRIX24_DEFAULTS,
  bitrix24ConfigSchema,
  resolveBitrix24Config,
  type Bitrix24Flags,
} from "./providers/bitrix24/config.js";
export {
  Bitrix24Provider,
  parseBitrixWebhook,
} from "./providers/bitrix24/index.js";
export {
  BITRIX_HANDLERS,
  BITRIX_PROJECTIONS,
} from "./providers/bitrix24/operations.js";
export {
  createBitrix24Tools,
  BITRIX24_TOOL_NAMES,
} from "./providers/bitrix24/tools.js";
export {
  GitlabProvider,
  groupAllowed as gitlabGroupAllowed,
  projectAllowed as gitlabProjectAllowed,
} from "./providers/gitlab/index.js";
export {
  GITLAB_CAPABILITIES,
  GITLAB_CAPABILITY_INFO,
  GITLAB_CI_SPLIT_CAPABILITIES,
  GITLAB_LEGACY_CI_CAPABILITY,
  GITLAB_OPERATIONS,
  GITLAB_RESOURCE_KIND,
  capabilitiesForScopes,
  gitlabOperationCapability,
  gitlabOperationMetadata,
  type GitlabCapability,
  type GitlabCapabilityDefinition,
  type GitlabOperationDefinition,
} from "./providers/gitlab/catalog.js";
export {
  GITLAB_DEFAULTS,
  gitlabConfigSchema,
  resolveGitlabConfig,
  type GitlabConfigInput,
  type GitlabFlags,
  type GitlabInstance,
} from "./providers/gitlab/config.js";
export {
  createGitlabTools,
  GITLAB_TOOL_NAMES,
} from "./providers/gitlab/tools.js";
export {
  GitlabTransport,
  credentialFromPlaintext as gitlabCredentialFromPlaintext,
  credentialInstance,
  type GitlabCredential,
} from "./providers/gitlab/transport.js";
export {
  GITLAB_HANDLERS,
  GITLAB_PROJECTIONS,
} from "./providers/gitlab/operations.js";
export { ConfluenceProvider } from "./providers/confluence/index.js";
export {
  adfToText as confluenceAdfToText,
  textBudget,
} from "./providers/confluence/adf.js";
export {
  CONFLUENCE_CAPABILITIES,
  CONFLUENCE_CAPABILITY_INFO,
  CONFLUENCE_OPERATIONS,
  confluenceOperationCapability,
  type ConfluenceCapability,
  type ConfluenceCapabilityDefinition,
  type ConfluenceOperationDefinition,
} from "./providers/confluence/catalog.js";
export {
  CONFLUENCE_DEFAULTS,
  confluenceConfigSchema,
  resolveConfluenceConfig,
  spaceAllowed,
  type ConfluenceFlags,
  type ConfluenceInstance,
} from "./providers/confluence/config.js";
export {
  buildCql,
  cqlLiteral,
  CONTENT_TYPES,
  ORDER_BY,
  type ConfluenceOrder,
  type ConfluenceSearchFilter,
} from "./providers/confluence/cql.js";
export {
  COMMENT_KINDS,
  CONFLUENCE_HANDLERS,
  CONFLUENCE_PROJECTIONS,
  DEFAULT_LIMIT,
  bodyLimit,
  commentChildrenPath,
  commentCollections,
  commentKind,
  commentPath,
  commentReplies,
  isNumericSpace,
  modifiedAfterDate,
  numericId,
  offsetCursor,
  pageLimit,
  plainExcerpt,
  spaceRef,
  upstreamCursor,
  type ConfluenceCommentKind,
  type ConfluenceProjection,
  type ConfluenceProjectionContext,
  type ConfluenceRequest,
} from "./providers/confluence/operations.js";
export {
  createConfluenceTools,
  CONFLUENCE_TOOL_NAMES,
} from "./providers/confluence/tools.js";
export {
  ConfluenceTransport,
  credentialFromPlaintext as confluenceCredentialFromPlaintext,
  credentialInstance as confluenceCredentialInstance,
  type ConfluenceCredential,
} from "./providers/confluence/transport.js";
export {
  TeamcityProvider,
  buildTypeAllowed as teamcityBuildTypeAllowed,
  projectAllowed as teamcityProjectAllowed,
} from "./providers/teamcity/index.js";
export {
  TEAMCITY_CAPABILITIES,
  TEAMCITY_CAPABILITY_INFO,
  TEAMCITY_INSTANCE_ID,
  TEAMCITY_OPERATIONS,
  TEAMCITY_RESOURCE_KIND,
  TEAMCITY_STREAM_OPERATIONS,
  enabledCapabilities as enabledTeamcityCapabilities,
  teamcityOperationCapability,
  teamcityOperationMetadata,
  type TeamCityCapability,
  type TeamCityCapabilityDefinition,
  type TeamCityOperationDefinition,
} from "./providers/teamcity/catalog.js";
export {
  TEAMCITY_DEFAULTS,
  DEFAULT_LOG_LINES,
  resolveTeamCityConfig,
  teamcityConfigSchema,
  type TeamCityConfigInput,
  type TeamCityFlags,
} from "./providers/teamcity/config.js";
export {
  artifactBinaryProblem,
  artifactByteLimit,
  artifactPath,
  textArtifact,
  type ArtifactPath,
} from "./providers/teamcity/artifacts.js";
export {
  LOG_MODES,
  logLines,
  logMode,
  sanitizeLog,
  selectLogWindow,
  trimToBytes,
  type LogMode,
  type LogWindow,
} from "./providers/teamcity/logs.js";
export {
  PRIVATE_CIDRS,
  canonicalServerUrl,
  cidrProblem,
  hostPatternProblem,
  isIpLiteral,
  serverUrlProblem,
  type TeamCityNetworkMode,
  type TeamCityNetworkPolicy,
} from "./providers/teamcity/network.js";
export {
  buildBuildLocator,
  dimension,
  joinDimensions,
  locatorValue,
  nested,
  teamCityDate,
  type BuildLocatorInput,
} from "./providers/teamcity/locators.js";
export {
  TEAMCITY_HANDLERS,
  TEAMCITY_LIMITS,
  TEAMCITY_PROJECTIONS,
  isoDate,
  listLimit,
  type TeamCityProjection,
  type TeamCityRequest,
} from "./providers/teamcity/operations.js";
export {
  TeamCityTransport,
  configuredServer as teamcityConfiguredServer,
  credentialFromPlaintext as teamcityCredentialFromPlaintext,
  type TeamCityCredential,
} from "./providers/teamcity/transport.js";
export {
  createTeamcityTools,
  TEAMCITY_TOOL_NAMES,
} from "./providers/teamcity/tools.js";
export { JiraProvider } from "./providers/jira/index.js";
export {
  JIRA_CAPABILITIES,
  JIRA_CAPABILITY_INFO,
  JIRA_COMPANION_PATHS,
  JIRA_OPERATIONS,
  JIRA_READ_PATHS,
  enabledCapabilities as enabledJiraCapabilities,
  jiraOperationCapability,
  type JiraCapability,
  type JiraCapabilityDefinition,
  type JiraOperationDefinition,
} from "./providers/jira/catalog.js";
export {
  JIRA_DEFAULTS,
  SEARCH_PAGE_CAP,
  jiraConfigSchema,
  jiraSite,
  resolveJiraConfig,
  type JiraFlags,
  type JiraSite,
} from "./providers/jira/config.js";
export {
  adfToText as jiraAdfToText,
  bodyText,
  isAdf,
  type AdfText,
} from "./providers/jira/adf.js";
export {
  buildJql,
  commentLimit,
  commentStart,
  issueKey as jiraIssueKey,
  jqlDateValue,
  jqlLiteral,
  needsUserLookup,
  pageToken,
  projectKey as jiraProjectKey,
  searchLimit,
  textClauses,
  textMatch,
  type CustomFieldClause,
} from "./providers/jira/jql.js";
export {
  ISSUE_INCLUDES,
  JIRA_HANDLERS,
  JIRA_PROJECTIONS,
  SEARCH_FIELDS as JIRA_SEARCH_FIELDS,
  customFieldValue,
  issueFields,
  issueUrl,
  requestedIncludes,
  wantsFieldNames,
  type JiraProjection,
} from "./providers/jira/operations.js";
export {
  JiraTransport,
  basicAuthorization,
  credentialFromPlaintext as jiraCredentialFromPlaintext,
  credentialSite,
  type JiraCredential,
} from "./providers/jira/transport.js";
export { createJiraTools, JIRA_TOOL_NAMES } from "./providers/jira/tools.js";
export { TestitProvider } from "./providers/testit/index.js";
export {
  TESTIT_CAPABILITIES,
  TESTIT_CAPABILITY_INFO,
  TESTIT_OPERATIONS,
  enabledCapabilities as enabledTestitCapabilities,
  testitOperationCapability,
  type TestitCapability,
  type TestitCapabilityDefinition,
  type TestitListKind,
  type TestitOperationDefinition,
} from "./providers/testit/catalog.js";
export {
  TESTIT_DEFAULTS,
  resolveTestitConfig,
  testitConfigSchema,
  testitInstance,
  type TestitFlags,
  type TestitInstance,
} from "./providers/testit/config.js";
export {
  assertReadableSize,
  attachmentBinaryProblem,
  attachmentByteLimit,
  attachmentExtension,
  attachmentName,
} from "./providers/testit/attachments.js";
export {
  RESULT_OUTCOMES,
  TESTIT_HANDLERS,
  TESTIT_LIMITS,
  TESTIT_PROJECTIONS,
  TEST_RUN_STATES,
  WORK_ITEM_ENTITY_TYPES,
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_STATES,
  bounded as testitBounded,
  capped,
  contentBlock as testitContentBlock,
  listLimit as testitListLimit,
  listOffset as testitListOffset,
  paged,
  type TestitProjection,
  type TestitProjectionContext,
  type TestitRequest,
} from "./providers/testit/operations.js";
export {
  TestitTransport,
  credentialFromPlaintext as testitCredentialFromPlaintext,
  credentialInstance as testitCredentialInstance,
  type TestitCredential,
  type TestitPage,
} from "./providers/testit/transport.js";
export {
  createTestitTools,
  TESTIT_TOOL_NAMES,
} from "./providers/testit/tools.js";
export { WeblateProvider } from "./providers/weblate/index.js";
export {
  WEBLATE_CAPABILITIES,
  WEBLATE_CAPABILITY_INFO,
  WEBLATE_OPERATIONS,
  enabledCapabilities as weblateEnabledCapabilities,
  weblateOperationCapability,
  type WeblateCapability,
  type WeblateCapabilityDefinition,
  type WeblateOperationDefinition,
} from "./providers/weblate/catalog.js";
export {
  WEBLATE_DEFAULTS,
  resolveWeblateConfig,
  weblateConfigSchema,
  weblateInstance,
  type WeblateFlags,
  type WeblateInstance,
} from "./providers/weblate/config.js";
export {
  WEBLATE_HANDLERS,
  WEBLATE_PROJECTIONS,
  WEBLATE_UNTRUSTED_OPERATIONS,
  accountFromUsers,
  componentRef,
  projectRef as weblateProjectRef,
  sameOriginUrl,
  translationRef as weblateTranslationRef,
  unitState as weblateUnitState,
  type WeblateProjection,
  type WeblateProjectionContext,
} from "./providers/weblate/operations.js";
export {
  FAILING_CHECK_CLAUSE,
  UNIT_STATE_FILTERS,
  UNIT_TEXT_FIELDS,
  buildUnitQuery,
  exactClause as weblateExactClause,
  quoteQueryValue,
  stateClause as weblateStateClause,
  textClause as weblateTextClause,
  type UnitStateFilter,
  type UnitTextField,
} from "./providers/weblate/query.js";
export {
  WeblateTransport,
  credentialFromPlaintext as weblateCredentialFromPlaintext,
  credentialInstance as weblateCredentialInstance,
  resultsOf,
  type WeblateCredential,
} from "./providers/weblate/transport.js";
export {
  createWeblateTools,
  WEBLATE_TOOL_NAMES,
} from "./providers/weblate/tools.js";
export { IntegrationProviderRegistry } from "./providers/registry.js";
export {
  serviceBoundaryOf,
  serviceResourceDenied,
} from "./providers/shared/service-boundary.js";
export { IntegrationRepository } from "./repository.js";
export {
  DockerSecretKeyProvider,
  MemoryKeyProvider,
  type KeyProvider,
} from "./secrets/key-provider.js";
export { SecretStore } from "./secrets/secret-store.js";
export { createToolKit, type ToolKitOptions } from "./tool-kit.js";
export { createIntegrationTools, INTEGRATION_TOOL_NAMES } from "./tools.js";
export type * from "./types.js";
export {
  BitrixTransport,
  credentialFromPlaintext,
  type BitrixCredential,
} from "./providers/bitrix24/transport.js";
export default QaIntegrations;
