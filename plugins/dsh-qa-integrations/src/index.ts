import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-settings";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import z from "@deepseek-ai/schemastery";
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
import GitlabProvider from "./providers/gitlab/index.js";
import { IntegrationProviderRegistry } from "./providers/registry.js";
import TeamcityProvider from "./providers/teamcity/index.js";
import { networkAllowsNothing } from "./providers/teamcity/config.js";
import { IntegrationRepository } from "./repository.js";
import { DockerSecretKeyProvider } from "./secrets/key-provider.js";
import { SecretStore } from "./secrets/secret-store.js";
import { QA_INTEGRATIONS_SETTINGS_NAMESPACE } from "./shared/settings.js";
import { createIntegrationTools, INTEGRATION_TOOL_NAMES } from "./tools.js";
import type {
  CredentialInput,
  IntegrationInstanceSummary,
  IntegrationPrincipal,
  IntegrationProviderId,
  IntegrationProviderSummary,
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

/**
 * Schema of the mount-only settings section. The Plugins tab dispatches a card
 * by the namespace its Host serves, so serving it is what puts the Integrations
 * card in "Plugin configuration"; the section itself holds nothing an operator
 * could edit, for the reason spelled out in `shared/settings.ts`.
 */
const MOUNT_SECTION_SCHEMA = z.object({});

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

/** Host remote, broker owner, and registration point for read-only tools. */
export class QaIntegrations extends TypertRemoteService {
  static inject = inject;
  static Config = ConfigSchema;

  readonly broker: IntegrationBroker;
  private readonly logger: PluginLogger;
  private readonly enabled: boolean;
  private readonly providerSummaries: readonly IntegrationProviderSummary[];
  private readonly configuredInstances: readonly IntegrationInstanceSummary[];
  /** The Confluence sites this deployment dials, for the connect form. */
  private readonly configuredSites: readonly IntegrationInstanceSummary[];
  /** The TeamCity server this deployment dials, or null when it mounts none. */
  private readonly configuredServer: IntegrationInstanceSummary | null;

  constructor(ctx: IntegrationsContext, rawConfig: QaIntegrationsConfig = {}) {
    super(ctx, "qaIntegrations", { namespace: "qaIntegrations" });
    const config = resolveConfig(rawConfig);
    this.enabled = config.enabled;
    this.logger = getPluginLogger({
      pluginId: "dsh-qa-integrations",
      consoleSink: createHostLoggerSink(ctx.logger),
    });
    const repository = new IntegrationRepository(config.dataPath);
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
    this.providerSummaries = this.enabled
      ? providers.list().map(providerSummary)
      : [];
    this.configuredSites = config.confluence.enabled
      ? config.confluence.instances.map((instance) => ({
          id: instance.id,
          label: instance.label,
          baseUrl: instance.baseUrl,
        }))
      : [];
    this.configuredInstances = config.gitlab.enabled
      ? config.gitlab.instances.map((instance) => ({
          id: instance.id,
          label: instance.label,
          baseUrl: instance.baseUrl,
        }))
      : [];
    this.configuredServer =
      config.teamcity.enabled && config.teamcity.serverUrl !== ""
        ? {
            id: "teamcity",
            label: new URL(config.teamcity.serverUrl).host,
            baseUrl: config.teamcity.serverUrl,
          }
        : null;
    this.broker = new IntegrationBroker(
      repository,
      secrets,
      providers,
      this.logger,
    );

    // Serving the namespace is what lets the browser half mount its card; the
    // section carries no editable value and therefore no live source.
    ctx.inject(["settings"], (settingsCtx) => {
      settingsCtx.settings.installSection(
        ctx,
        QA_INTEGRATIONS_SETTINGS_NAMESPACE,
        MOUNT_SECTION_SCHEMA,
        {},
        { setSource: () => undefined, onChange: () => undefined },
      );
    });

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
    input: { readonly instanceId: string; readonly token: string },
  ): Promise<IntegrationSummary> {
    return this.runAsync(token, (principal) =>
      this.broker.connect(principal, "gitlab", {
        token: input.token,
        options: { instanceId: input.instanceId },
      }),
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
    return this.run(token, () => this.configuredSites);
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
    input: { readonly token: string },
  ): Promise<IntegrationSummary> {
    return this.runAsync(token, (principal) =>
      this.broker.connect(principal, "teamcity", { token: input.token }),
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
export { GitlabProvider } from "./providers/gitlab/index.js";
export {
  GITLAB_CAPABILITIES,
  GITLAB_CAPABILITY_INFO,
  GITLAB_OPERATIONS,
  capabilitiesForScopes,
  gitlabOperationCapability,
  type GitlabCapability,
  type GitlabCapabilityDefinition,
  type GitlabOperationDefinition,
} from "./providers/gitlab/catalog.js";
export {
  GITLAB_DEFAULTS,
  gitlabConfigSchema,
  resolveGitlabConfig,
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
export { adfToText, textBudget } from "./providers/confluence/adf.js";
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
export { TeamcityProvider } from "./providers/teamcity/index.js";
export {
  TEAMCITY_CAPABILITIES,
  TEAMCITY_CAPABILITY_INFO,
  TEAMCITY_OPERATIONS,
  TEAMCITY_STREAM_OPERATIONS,
  enabledCapabilities as enabledTeamcityCapabilities,
  teamcityOperationCapability,
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
export { IntegrationProviderRegistry } from "./providers/registry.js";
export { IntegrationRepository } from "./repository.js";
export {
  DockerSecretKeyProvider,
  MemoryKeyProvider,
  type KeyProvider,
} from "./secrets/key-provider.js";
export { SecretStore } from "./secrets/secret-store.js";
export { QA_INTEGRATIONS_SETTINGS_NAMESPACE } from "./shared/settings.js";
export { createToolKit, type ToolKitOptions } from "./tool-kit.js";
export { createIntegrationTools, INTEGRATION_TOOL_NAMES } from "./tools.js";
export type * from "./types.js";
export {
  BitrixTransport,
  credentialFromPlaintext,
  type BitrixCredential,
} from "./providers/bitrix24/transport.js";
export default QaIntegrations;
