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
import { IntegrationProviderRegistry } from "./providers/registry.js";
import { IntegrationRepository } from "./repository.js";
import { DockerSecretKeyProvider } from "./secrets/key-provider.js";
import { SecretStore } from "./secrets/secret-store.js";
import { createIntegrationTools, INTEGRATION_TOOL_NAMES } from "./tools.js";
import type {
  CredentialInput,
  IntegrationPrincipal,
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

/** Host remote, broker owner, and registration point for read-only tools. */
export class QaIntegrations extends TypertRemoteService {
  static inject = inject;
  static Config = ConfigSchema;

  readonly broker: IntegrationBroker;
  private readonly logger: PluginLogger;
  private readonly enabled: boolean;

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
    this.broker = new IntegrationBroker(
      repository,
      secrets,
      providers,
      this.logger,
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
  }

  @Remote("describe")
  describe(): { readonly enabled: boolean } {
    return { enabled: this.enabled };
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
export { IntegrationProviderRegistry } from "./providers/registry.js";
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
