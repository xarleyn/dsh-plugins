import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { IntegrationError, type IntegrationErrorCode } from "./errors.js";
import type { IntegrationProvider } from "./providers/contract.js";
import type { IntegrationProviderRegistry } from "./providers/registry.js";
import type {
  IntegrationBindingGeneration,
  IntegrationRepository,
} from "./repository.js";
import type { SecretStore } from "./secrets/secret-store.js";
import { DEFAULT_SERVICE_RATE_LIMIT } from "./service-credentials/config.js";
import {
  ServiceRateLimitError,
  ServiceRateLimiter,
} from "./service-credentials/rate-limit.js";
import {
  evaluateServiceOperation,
  narrowBoundary,
} from "./service-credentials/policy.js";
import type { ServiceCredentialRegistry } from "./service-credentials/registry.js";
import {
  isCredentialSource,
  UNCLASSIFIED_OPERATION,
  type OperationSecurityMetadata,
  type ResolvedServiceCredential,
  type ServiceCredentialHealth,
  type ServiceCredentialProfile,
  type ServiceRateLimitConfig,
  type ServiceResourceBoundary,
} from "./service-credentials/types.js";
import type {
  CapabilityServiceState,
  CredentialInput,
  CredentialSource,
  IntegrationCapability,
  IntegrationJsonValue,
  IntegrationPrincipal,
  IntegrationProviderId,
  IntegrationProviderSummary,
  IntegrationServiceSummary,
  IntegrationSummary,
  IntegrationToolResult,
  PolicyPatch,
  StoredIntegration,
} from "./types.js";

export interface BrokerOptions {
  /** Absent in deployments that configure no managed credential at all. */
  readonly serviceCredentials?: ServiceCredentialRegistry | undefined;
  /** Whether a new connection starts in service mode when a profile exists. */
  readonly defaultForNewConnections?: boolean | undefined;
  /**
   * Ceiling of service-mode calls. Injectable for the same reason the registry
   * takes its environment: the tests need a clock that is not the wall clock.
   */
  readonly rateLimits?: ServiceRateLimiter | undefined;
}

/** In-process broker boundary; no caller outside it receives decrypted secrets. */
export class IntegrationBroker {
  private serviceCredentials: ServiceCredentialRegistry | undefined;
  private defaultForNewConnections: boolean;
  private readonly rateLimits: ServiceRateLimiter;

  constructor(
    private readonly repository: IntegrationRepository,
    private readonly secrets: SecretStore,
    private providers: IntegrationProviderRegistry,
    private readonly logger: PluginLogger,
    options: BrokerOptions = {},
  ) {
    this.serviceCredentials = options.serviceCredentials;
    this.defaultForNewConnections = options.defaultForNewConnections ?? true;
    this.rateLimits =
      options.rateLimits ?? new ServiceRateLimiter(DEFAULT_SERVICE_RATE_LIMIT);
  }

  /**
   * Re-point the broker at the provider set and service-credential registry a
   * fresh configuration resolved. The store and its key are process-lifetime —
   * connections and wrapped secrets travel with them — so only derivations of
   * the configuration move here. An in-flight call keeps the captures it
   * already made and finishes against them.
   */
  swap(
    providers: IntegrationProviderRegistry,
    serviceCredentials: ServiceCredentialRegistry | undefined,
    defaultForNewConnections: boolean,
    rateLimit: ServiceRateLimitConfig,
  ): void {
    this.providers = providers;
    this.serviceCredentials = serviceCredentials;
    this.defaultForNewConnections = defaultForNewConnections;
    this.rateLimits.configure(rateLimit);
  }

  listProviders(): readonly IntegrationProviderSummary[] {
    return this.providers.list().map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      enabled: true,
      authModes: ["token"],
      capabilities: provider.capabilities,
      credentialHelp: provider.credentialHelp,
    }));
  }

  list(principal: IntegrationPrincipal): readonly IntegrationSummary[] {
    return this.providers
      .list()
      .map((provider) => this.summary(principal, provider.id));
  }

  summary(
    principal: IntegrationPrincipal,
    providerId: IntegrationProviderId,
  ): IntegrationSummary {
    const provider = this.providers.get(providerId);
    this.ensureDefaultServiceBinding(principal, providerId);
    const integration = this.repository.find(principal, providerId);
    const service = this.serviceSummary(providerId, integration);
    if (integration === undefined) {
      return {
        provider: providerId,
        displayName: provider.displayName,
        status: "not_connected",
        portal: null,
        externalAccountName: null,
        credentialConfigured: false,
        credentialUpdatedAt: null,
        capabilities: provider.capabilities,
        capabilityInfo: provider.capabilityInfo,
        // Nothing is granted yet, so nothing carries a policy either.
        policy: [],
        lastValidatedAt: null,
        errorCode: null,
        credentialSource: "personal",
        service,
      };
    }
    const granted = this.grantedCapabilities(integration, provider);
    const policy = granted.map((capability) => ({
      capability,
      mode: this.repository.policy(integration, capability),
    }));
    const secret = this.repository.secretFor(principal, providerId);
    return {
      provider: providerId,
      displayName: provider.displayName,
      status: integration.status,
      portal: integration.externalTenantId,
      externalAccountName: integration.displayName,
      credentialConfigured: secret !== undefined,
      credentialUpdatedAt: secret?.updatedAt ?? null,
      capabilities: granted,
      capabilityInfo: provider.capabilityInfo,
      policy,
      lastValidatedAt: integration.lastValidatedAt,
      errorCode: integration.lastErrorCode,
      credentialSource: integration.credentialSource,
      service,
    };
  }

  /**
   * The capabilities a connection may use as it stands: the stored grant, with
   * anything this deployment has since withdrawn from the provider removed.
   * Everything that decides or displays the reach of a connection reads through
   * here — the call gate, the operator card, and the policy editor — so a
   * capability the deployment has taken away is neither served, nor offered as a
   * switch, nor able to collect a fresh allowance. A grant that survives only in
   * the database stops being served, rather than running until the connection is
   * next established.
   */
  private grantedCapabilities(
    integration: StoredIntegration,
    provider: IntegrationProvider,
  ): readonly IntegrationCapability[] {
    return integration.capabilities.filter((capability) =>
      provider.capabilities.includes(capability),
    );
  }

  /**
   * Connect one provider for one principal. The credential source is decided
   * here, server-side: the client may ask for service mode, and gets it only
   * when this deployment really manages a credential for that provider
   * instance. A new connection defaults to service mode when the deployment
   * says so and a profile exists — an existing connection never moves on its
   * own, because its source is already stored.
   */
  async connect(
    principal: IntegrationPrincipal,
    providerId: IntegrationProviderId,
    input: CredentialInput,
    options: { readonly useServiceCredential?: boolean | undefined } = {},
  ): Promise<IntegrationSummary> {
    const provider = this.providers.get(providerId);
    const instanceId = String(input.options?.["instanceId"] ?? "").trim();
    const profile = this.profileFor(providerId, instanceId);
    const existing = this.repository.find(principal, providerId);
    // The client may ask for either mode; when it does not, service mode is the
    // default only for a *new* connection. An existing binding keeps the source
    // it stored, which is what makes an upgrade unable to move a user silently.
    const wantsService =
      options.useServiceCredential ??
      (existing === undefined && this.defaultForNewConnections);

    if (
      options.useServiceCredential === true &&
      (profile === undefined || !profile.enabled)
    ) {
      // The client asked for the managed credential and this deployment cannot
      // produce one: say so instead of falling through to a personal token the
      // form never offered a field for.
      throw new IntegrationError(
        profile === undefined
          ? "ServiceCredentialUnavailable"
          : "ServiceCredentialDisabled",
        "The deployment manages no usable credential for this instance",
      );
    }

    if (wantsService && profile !== undefined && profile.enabled) {
      this.repository.connect({
        principal,
        provider: providerId,
        // No personal secret is stored: this connection spends the deployment's
        // credential until the user switches, and only the switch stores one.
        secret: null,
        tenantId: profile.portal,
        externalUserId: `service:${profile.id}`,
        displayName: profile.label,
        capabilities: this.serviceCapabilities(providerId),
        credentialSource: "service",
        serviceProfileId: profile.id,
      });
      this.repository.audit({
        ownerUserId: principal.userId,
        provider: providerId,
        operation: "credential.connect",
        result: "success",
        credentialSource: "service",
        serviceProfileId: profile.id,
        sourceSessionId: null,
      });
      this.logger.info("credential.connected", {
        provider: providerId,
        credentialSource: "service",
        serviceProfile: profile.id,
      });
      return this.summary(principal, providerId);
    }

    const parsed = provider.parseCredential(
      String(input.token ?? ""),
      input.options,
    );
    const validation = await provider.validate({
      credential: parsed.credential,
      credentialSource: "personal",
    });
    const encrypted = await this.secrets.encrypt(parsed.credential, "token");
    this.repository.connect({
      principal,
      provider: providerId,
      secret: encrypted,
      tenantId: validation.tenantId,
      externalUserId: validation.externalUserId,
      displayName: validation.displayName,
      capabilities: validation.capabilities,
      credentialSource: "personal",
      serviceProfileId: null,
    });
    this.repository.audit({
      ownerUserId: principal.userId,
      provider: providerId,
      operation: "credential.connect",
      result: "success",
      credentialSource: "personal",
      serviceProfileId: null,
      sourceSessionId: null,
    });
    this.logger.info("credential.connected", {
      provider: providerId,
      credentialSource: "personal",
    });
    return this.summary(principal, providerId);
  }

  async validate(
    principal: IntegrationPrincipal,
    providerId: IntegrationProviderId,
  ): Promise<IntegrationSummary> {
    const integration = this.requireConnected(principal, providerId);
    try {
      if (integration.credentialSource === "service") {
        const resolved = this.resolveService(principal, integration);
        const health = await this.probeService(resolved);
        const code = healthCode(health);
        // A credential the probe rejects is a rejected credential, not a
        // successful validation. `unsafe_scope` is the one verdict that does not
        // refuse: the ceiling already bounds what the token can reach here, and
        // the finding is recorded for the operator instead.
        if (code !== undefined && health?.status !== "unsafe_scope") {
          this.recordValidation(
            principal,
            providerId,
            integration,
            false,
            code,
          );
          this.repository.audit({
            ownerUserId: principal.userId,
            provider: providerId,
            operation: "credential.validate",
            result: "error",
            credentialSource: "service",
            serviceProfileId: resolved.profile.id,
            sourceSessionId: null,
          });
          this.logger.warn("credential.validation-failed", {
            provider: providerId,
            integrationId: integration.id,
            reason: code,
            serviceProfile: resolved.profile.id,
          });
          throw new IntegrationError(code, "Service credential is unusable");
        }
        this.recordValidation(
          principal,
          providerId,
          integration,
          true,
          code ?? null,
        );
        this.repository.audit({
          ownerUserId: principal.userId,
          provider: providerId,
          operation: "credential.validate",
          result: "success",
          credentialSource: "service",
          serviceProfileId: resolved.profile.id,
          sourceSessionId: null,
        });
        return this.summary(principal, providerId);
      }
      const credential = await this.decrypt(principal, providerId, integration);
      const validation = await this.providers
        .get(providerId)
        .validate({ credential, credentialSource: "personal" });
      // Re-probe capabilities: a scope granted later at the provider must show up
      // here, and a revoked one must stop being offered. Policies are left
      // untouched, so a newly detected capability starts denied until the user
      // enables it in Settings.
      this.recordValidation(
        principal,
        providerId,
        integration,
        true,
        null,
        validation.capabilities,
      );
      this.repository.audit({
        ownerUserId: principal.userId,
        provider: providerId,
        operation: "credential.validate",
        result: "success",
        credentialSource: "personal",
        serviceProfileId: null,
        sourceSessionId: null,
      });
      return this.summary(principal, providerId);
    } catch (error) {
      const code =
        error instanceof IntegrationError ? error.code : "ProviderUnavailable";
      this.recordValidation(principal, providerId, integration, false, code);
      this.repository.audit({
        ownerUserId: principal.userId,
        provider: providerId,
        operation: "credential.validate",
        result: "error",
        credentialSource: integration.credentialSource,
        serviceProfileId: integration.serviceProfileId,
        sourceSessionId: null,
      });
      this.logger.warn("credential.validation-failed", {
        provider: providerId,
        integrationId: integration.id,
        reason: code,
      });
      throw error;
    }
  }

  /**
   * The identity a write-back has to compare against: the row, its revision and
   * the credential of the binding this operation started from. Every field is
   * needed — the revision alone cannot tell a replaced connection from a newly
   * created one, because a disconnect erases the row and the next connect starts
   * its revision over at the first number.
   */
  private bindingGeneration(
    integration: StoredIntegration,
  ): IntegrationBindingGeneration {
    return {
      bindingId: integration.id,
      bindingRevision: integration.bindingRevision,
      secretRef: integration.secretRef,
      serviceProfileId: integration.serviceProfileId,
    };
  }

  /**
   * Store one validation verdict against the binding it was produced from. A
   * probe outlives its binding whenever the account reconnects or switches
   * credential mode while the provider is being reached: what it found describes
   * a credential no longer in use, so that verdict is dropped and logged instead
   * of overwriting the live binding's account and capabilities.
   */
  private recordValidation(
    principal: IntegrationPrincipal,
    providerId: IntegrationProviderId,
    integration: StoredIntegration,
    success: boolean,
    errorCode: string | null,
    capabilities?: readonly IntegrationCapability[],
  ): void {
    const applied = this.repository.updateValidation(
      principal,
      providerId,
      success,
      errorCode,
      capabilities,
      this.bindingGeneration(integration),
    );
    if (applied) return;
    this.logger.warn("credential.validation-stale", {
      provider: providerId,
      integrationId: integration.id,
      bindingRevision: integration.bindingRevision,
    });
  }

  /**
   * Probe the deployment's managed credential for one instance and report what
   * state it is in. The probe never changes upstream state, and the answer is a
   * health status plus operator warnings — never the secret, and never the
   * upstream identity the credential carries.
   */
  async serviceCredentialHealth(
    providerId: IntegrationProviderId,
    instanceId: string,
  ): Promise<ServiceCredentialHealth | null> {
    const profile = this.profileFor(providerId, instanceId);
    const registry = this.serviceCredentials;
    if (profile === undefined || registry === undefined || !profile.enabled) {
      return null;
    }
    const provider = this.providers.get(providerId);
    if (provider.validateServiceCredential === undefined) return null;
    const resolved = registry.readSecret(profile);
    const health = await provider.validateServiceCredential({
      credential: this.buildServiceCredential(providerId, resolved),
      credentialSource: "service",
      resourceBoundary: profile.resources,
    });
    // The upstream identity the probe found stays server-side: it is for the
    // audit trail, not for a card, which shows the administrator's alias.
    return {
      status: health.status,
      ...(health.warnings === undefined ? {} : { warnings: health.warnings }),
    };
  }

  /**
   * Move one binding between credential sources. Both directions invalidate
   * everything derived from the previous identity by bumping the binding
   * revision, and neither direction ever falls back on its own. A switch that
   * reaches upstream first (the personal direction validates the stored token)
   * only lands on the binding it started from, so a reconnect during that probe
   * costs the switch rather than rewriting the new connection.
   */
  async setCredentialSource(
    principal: IntegrationPrincipal,
    providerId: IntegrationProviderId,
    source: CredentialSource,
  ): Promise<IntegrationSummary> {
    if (!isCredentialSource(source)) {
      throw new IntegrationError("InvalidRequest", "Unknown credential source");
    }
    const integration = this.requireConnected(principal, providerId);
    const provider = this.providers.get(providerId);
    if (integration.credentialSource === source) {
      return this.summary(principal, providerId);
    }
    if (source === "service") {
      const resolved = this.resolveService(principal, integration);
      const switched = this.repository.setCredentialSource({
        principal,
        provider: providerId,
        source: "service",
        serviceProfileId: resolved.profile.id,
        capabilities: this.serviceCapabilities(providerId),
        tenantId: resolved.profile.portal,
        externalUserId: `service:${resolved.profile.id}`,
        displayName: resolved.profile.label,
        expected: this.bindingGeneration(integration),
      });
      if (switched === undefined) {
        throw this.refuseStaleSwitch(providerId, integration);
      }
      this.repository.audit({
        ownerUserId: principal.userId,
        provider: providerId,
        operation: "credential.switch",
        result: "success",
        credentialSource: "service",
        serviceProfileId: resolved.profile.id,
        sourceSessionId: null,
      });
      this.logger.info("credential.switched", {
        provider: providerId,
        credentialSource: "service",
        serviceProfile: resolved.profile.id,
      });
      return this.summary(principal, providerId);
    }
    const secret = this.repository.secretFor(principal, providerId);
    if (secret === undefined) {
      throw new IntegrationError(
        "PersonalCredentialRequired",
        "Connect a personal account before switching to it",
      );
    }
    const validation = await provider.validate({
      credential: await this.secrets.decrypt(secret),
      credentialSource: "personal",
    });
    // The probe above reached upstream, so the binding may have moved while it
    // was away. The switch carries the identity that probe found; writing it
    // unconditionally would put a replaced token's account and grant onto
    // whatever connection the account has now.
    const switched = this.repository.setCredentialSource({
      principal,
      provider: providerId,
      source: "personal",
      serviceProfileId: null,
      capabilities: validation.capabilities,
      tenantId: validation.tenantId,
      externalUserId: validation.externalUserId,
      displayName: validation.displayName,
      expected: this.bindingGeneration(integration),
    });
    if (switched === undefined) {
      throw this.refuseStaleSwitch(providerId, integration);
    }
    this.repository.audit({
      ownerUserId: principal.userId,
      provider: providerId,
      operation: "credential.switch",
      result: "success",
      credentialSource: "personal",
      serviceProfileId: null,
      sourceSessionId: null,
    });
    this.logger.info("credential.switched", {
      provider: providerId,
      credentialSource: "personal",
    });
    return this.summary(principal, providerId);
  }

  /**
   * Refuse a switch the store would not apply: the account reconnected while the
   * request was on its way, so the binding it was asked against is gone and the
   * identity it carries is a token that has already been replaced. Nothing was
   * written, so the answer names the lost generation rather than claiming a
   * change of mode the store never made.
   */
  private refuseStaleSwitch(
    providerId: IntegrationProviderId,
    integration: StoredIntegration,
  ): IntegrationError {
    this.logger.warn("credential.switch-stale", {
      provider: providerId,
      integrationId: integration.id,
      bindingRevision: integration.bindingRevision,
    });
    return new IntegrationError(
      "IntegrationNotConnected",
      "The connection changed while the credential was being switched",
    );
  }

  /**
   * Narrow what this binding may read inside the profile's allowlist. A user may
   * only remove entries: anything outside the administrator's list is dropped
   * rather than stored, so a forged request cannot widen the boundary.
   */
  setServiceSelection(
    principal: IntegrationPrincipal,
    providerId: IntegrationProviderId,
    selection: ServiceResourceBoundary | null,
  ): IntegrationSummary {
    const integration = this.requireConnected(principal, providerId);
    const resolved = this.resolveService(principal, integration);
    const narrowed = narrowBoundary(
      resolved.profile.resources,
      selection ?? undefined,
    );
    this.repository.setServiceSelection(principal, providerId, narrowed);
    this.repository.audit({
      ownerUserId: principal.userId,
      provider: providerId,
      operation: "credential.boundary",
      result: "success",
      credentialSource: "service",
      serviceProfileId: resolved.profile.id,
      sourceSessionId: null,
    });
    return this.summary(principal, providerId);
  }

  patchPolicy(
    principal: IntegrationPrincipal,
    providerId: IntegrationProviderId,
    patch: PolicyPatch,
  ): IntegrationSummary {
    const integration = this.requireConnected(principal, providerId);
    // An allowance is written only for a capability the connection has as it
    // stands. A row set against one the deployment has withdrawn would sit inert
    // and start serving the moment that capability came back — a permission
    // nobody asked for, against the rule `validate` keeps for a capability the
    // credential newly reveals: it stays denied until somebody enables it.
    const granted = this.grantedCapabilities(
      integration,
      this.providers.get(providerId),
    );
    if (!granted.includes(patch.operation)) {
      throw new IntegrationError("InvalidRequest", "Capability is unavailable");
    }
    if (!(["allow", "confirm", "deny"] as const).includes(patch.mode)) {
      throw new IntegrationError("InvalidRequest", "Policy mode is invalid");
    }
    this.repository.setPolicy(
      principal,
      providerId,
      patch.operation,
      patch.mode,
    );
    return this.summary(principal, providerId);
  }

  disconnect(
    principal: IntegrationPrincipal,
    providerId: IntegrationProviderId,
  ): boolean {
    const disconnected = this.repository.disconnect(principal, providerId);
    if (disconnected) {
      this.repository.audit({
        ownerUserId: principal.userId,
        provider: providerId,
        operation: "credential.disconnect",
        result: "success",
        credentialSource: "personal",
        serviceProfileId: null,
        sourceSessionId: null,
      });
      this.logger.info("credential.disconnected", { provider: providerId });
    }
    return disconnected;
  }

  async call(
    principal: IntegrationPrincipal,
    request: {
      readonly provider: IntegrationProviderId;
      readonly operation: string;
      readonly input: Readonly<Record<string, unknown>>;
      readonly sourceSessionId: string;
    },
  ): Promise<IntegrationToolResult> {
    this.ensureDefaultServiceBinding(principal, request.provider);
    const integration = this.requireConnected(principal, request.provider);
    const provider = this.providers.get(request.provider);
    const capability = provider.operationCapability(request.operation);
    if (capability === undefined) {
      throw new IntegrationError(
        "InvalidRequest",
        "Unsupported integration operation",
      );
    }
    const metadata =
      provider.operationMetadata?.(request.operation) ?? UNCLASSIFIED_OPERATION;
    // The service ceiling is checked before anything else, so a call that the
    // managed credential may not make is refused for that reason even when the
    // personal switch for the capability happens to be off too.
    const resolved =
      integration.credentialSource === "service"
        ? this.assertServiceOperation(principal, integration, {
            operation: request.operation,
            capability,
            metadata,
            boundaryKind: provider.resourceBoundaryKind?.(request.operation),
            sourceSessionId: request.sourceSessionId,
          })
        : undefined;
    // The stored grant is only half of the answer: a capability this deployment
    // has since withdrawn stays served until the connection is re-established
    // unless the live provider set is consulted as well. Denied here — before
    // the secret is decrypted and before anything reaches upstream.
    const mode = this.repository.policy(integration, capability);
    if (
      mode !== "allow" ||
      !this.grantedCapabilities(integration, provider).includes(capability)
    ) {
      this.repository.audit({
        ownerUserId: principal.userId,
        provider: request.provider,
        operation: request.operation,
        result: "denied",
        credentialSource: integration.credentialSource,
        serviceProfileId: resolved?.profile.id ?? null,
        sourceSessionId: request.sourceSessionId,
      });
      throw new IntegrationError(
        "OperationDeniedByPolicy",
        "Integration operation is denied by policy",
      );
    }
    // The allowance is spent here rather than at the top of the call: a request
    // the policy already refused must not cost anybody anything.
    const releaseSlot =
      resolved === undefined
        ? undefined
        : this.acquireServiceCallSlot(principal, request, resolved);
    try {
      const credential =
        resolved === undefined
          ? await this.decrypt(principal, request.provider, integration)
          : this.buildServiceCredential(request.provider, resolved);
      const boundary =
        resolved === undefined
          ? undefined
          : narrowBoundary(
              resolved.profile.resources,
              integration.serviceSelection ?? undefined,
            );
      const providerData = await provider.execute(
        {
          credential,
          externalUserId: integration.externalUserId ?? undefined,
          credentialSource: integration.credentialSource,
          resourceBoundary: boundary,
        },
        request.operation,
        request.input,
      );
      const data =
        typeof providerData === "object" &&
        providerData !== null &&
        !Array.isArray(providerData)
          ? (providerData as Record<string, IntegrationJsonValue>)
          : { value: providerData as IntegrationJsonValue };
      this.repository.audit({
        ownerUserId: principal.userId,
        provider: request.provider,
        operation: request.operation,
        result: "success",
        credentialSource: integration.credentialSource,
        serviceProfileId: resolved?.profile.id ?? null,
        sourceSessionId: request.sourceSessionId,
      });
      this.logger.debug("tool.call", {
        provider: request.provider,
        operation: request.operation,
        status: "success",
        credentialSource: integration.credentialSource,
        ...(resolved === undefined
          ? {}
          : {
              serviceProfile: resolved.profile.id,
              servicePolicyRevision: resolved.profile.policyRevision,
            }),
      });
      return { provider: request.provider, operation: request.operation, data };
    } catch (error) {
      this.repository.audit({
        ownerUserId: principal.userId,
        provider: request.provider,
        operation: request.operation,
        // A boundary or ceiling refusal comes back from the provider, but it is
        // a policy decision and the trail records it as one.
        result: isPolicyDenial(error) ? "denied" : "error",
        credentialSource: integration.credentialSource,
        serviceProfileId: resolved?.profile.id ?? null,
        sourceSessionId: request.sourceSessionId,
      });
      throw error;
    } finally {
      releaseSlot?.();
    }
  }

  /**
   * Spend one unit of the service-mode ceiling before the call leaves for
   * upstream. Both sides of the limit are consulted together: one principal may
   * not exhaust the quota the whole deployment shares, and the shared quota is
   * not a per-user budget the operator never granted.
   *
   * A refusal is audited the way every other service-mode denial is, with the
   * real principal — the limit is decided here, so upstream never learns the
   * request existed.
   */
  private acquireServiceCallSlot(
    principal: IntegrationPrincipal,
    request: {
      readonly provider: IntegrationProviderId;
      readonly operation: string;
      readonly sourceSessionId: string;
    },
    resolved: ResolvedServiceCredential,
  ): () => void {
    try {
      return this.rateLimits.acquire({
        principal: principal.userId,
        provider: request.provider,
        profileId: resolved.profile.id,
      });
    } catch (error) {
      this.repository.audit({
        ownerUserId: principal.userId,
        provider: request.provider,
        operation: request.operation,
        result: "denied",
        credentialSource: "service",
        serviceProfileId: resolved.profile.id,
        sourceSessionId: request.sourceSessionId,
      });
      this.logger.warn("credential.rate_limited", {
        provider: request.provider,
        operation: request.operation,
        serviceProfile: resolved.profile.id,
        ...(error instanceof ServiceRateLimitError
          ? { limit: error.reason }
          : {}),
      });
      throw error;
    }
  }

  /**
   * Decide one operation against the service ceiling. Every refusal is audited
   * with the real principal: upstream will only ever show the service account,
   * so this row is what answers who asked.
   */
  private assertServiceOperation(
    principal: IntegrationPrincipal,
    integration: StoredIntegration,
    query: {
      readonly operation: string;
      readonly capability: IntegrationCapability;
      readonly metadata: OperationSecurityMetadata;
      readonly boundaryKind: string | undefined;
      readonly sourceSessionId: string;
    },
  ): ResolvedServiceCredential {
    let resolved: ResolvedServiceCredential;
    try {
      resolved = this.resolveService(principal, integration);
    } catch (error) {
      // A deployment credential that vanished or was retired is a denial like
      // any other, and the trail has to show it as one.
      this.repository.audit({
        ownerUserId: principal.userId,
        provider: integration.provider,
        operation: query.operation,
        result: "denied",
        credentialSource: "service",
        serviceProfileId: integration.serviceProfileId,
        sourceSessionId: query.sourceSessionId,
      });
      throw error;
    }
    const decision = evaluateServiceOperation({
      metadata: query.metadata,
      capability: query.capability,
      profile: resolved.profile,
      boundaryKind: query.boundaryKind,
    });
    if (!decision.allowed) {
      this.repository.audit({
        ownerUserId: principal.userId,
        provider: integration.provider,
        operation: query.operation,
        result: "denied",
        credentialSource: "service",
        serviceProfileId: resolved.profile.id,
        sourceSessionId: query.sourceSessionId,
      });
      throw new IntegrationError(decision.code, decision.message);
    }
    return resolved;
  }

  /**
   * The profile a binding resolves to. It is chosen by the deployment — provider
   * and portal — and never by an argument the model or the user supplies, which
   * is why a caller cannot point a session at somebody else's credential.
   */
  private profileFor(
    providerId: IntegrationProviderId,
    instanceId: string,
  ): ServiceCredentialProfile | undefined {
    const registry = this.serviceCredentials;
    if (registry === undefined) return undefined;
    const portal = this.providers.get(providerId).instancePortal?.(instanceId);
    if (portal === undefined || portal === "") return undefined;
    return registry.find(providerId, portal);
  }

  /**
   * Provision the one unambiguous managed profile for an account that has
   * never made a choice for this provider. This is deliberately synchronous:
   * it stores only the server-owned binding and policy; the secret remains
   * lazy and the first real call still exercises the authenticated provider.
   */
  private ensureDefaultServiceBinding(
    principal: IntegrationPrincipal,
    providerId: IntegrationProviderId,
  ): void {
    if (!this.defaultForNewConnections) return;
    if (this.repository.find(principal, providerId) !== undefined) return;
    if (this.repository.serviceOptedOut(principal, providerId)) return;
    const profiles =
      this.serviceCredentials
        ?.list()
        .filter(
          (profile) => profile.provider === providerId && profile.enabled,
        ) ?? [];
    // More than one instance needs a user choice; guessing would cross the
    // deployment boundary the settings form exists to make explicit.
    if (profiles.length !== 1) return;
    const profile = profiles[0]!;
    this.repository.connect({
      principal,
      provider: providerId,
      secret: null,
      tenantId: profile.portal,
      externalUserId: `service:${profile.id}`,
      displayName: profile.label,
      capabilities: this.serviceCapabilities(providerId),
      credentialSource: "service",
      serviceProfileId: profile.id,
    });
    this.logger.info("credential.default-bound", {
      provider: providerId,
      serviceProfile: profile.id,
    });
  }

  private resolveService(
    principal: IntegrationPrincipal,
    integration: StoredIntegration,
  ): ResolvedServiceCredential {
    const registry = this.serviceCredentials;
    const portal = integration.externalTenantId ?? "";
    const profile = registry?.find(integration.provider, portal);
    if (registry === undefined || profile === undefined) {
      throw new IntegrationError(
        "ServiceCredentialUnavailable",
        "This deployment manages no credential for the connected instance",
      );
    }
    if (!profile.enabled) {
      throw new IntegrationError(
        "ServiceCredentialDisabled",
        "The service credential is disabled",
      );
    }
    if (integration.servicePolicyRevision !== profile.policyRevision) {
      // A profile changed, or a secret was rotated: record which revision this
      // binding now runs under, so the change is visible and nothing derived
      // from the previous revision is treated as current.
      this.repository.setServicePolicyRevision(
        principal,
        integration.provider,
        profile.policyRevision,
      );
    }
    return registry.readSecret(profile);
  }

  /**
   * Turn the deployment's secret into the credential shape of this provider.
   * The provider owns that shape, so a service secret can never be spent against
   * an instance other than the profile's.
   */
  private buildServiceCredential(
    providerId: IntegrationProviderId,
    resolved: ResolvedServiceCredential,
  ): string {
    const provider = this.providers.get(providerId);
    try {
      return provider.parseCredential(resolved.secret, {
        instanceId: resolved.profile.instance,
      }).credential;
    } catch (error) {
      if (error instanceof IntegrationError) {
        throw new IntegrationError(
          "ServiceCredentialInvalid",
          "The service credential is not usable for this provider",
          { cause: error },
        );
      }
      throw error;
    }
  }

  private async probeService(
    resolved: ResolvedServiceCredential,
  ): Promise<ServiceCredentialHealth | undefined> {
    const provider = this.providers.get(resolved.profile.provider);
    const probe = provider.validateServiceCredential;
    if (probe === undefined) return undefined;
    return await probe({
      credential: this.buildServiceCredential(
        resolved.profile.provider,
        resolved,
      ),
      credentialSource: "service",
      resourceBoundary: resolved.profile.resources,
    });
  }

  /** Capabilities the managed credential can reach through this provider. */
  private serviceCapabilities(
    providerId: IntegrationProviderId,
  ): readonly IntegrationCapability[] {
    const provider = this.providers.get(providerId);
    if (provider.capabilityServiceState === undefined) return [];
    return provider.capabilities.filter(
      (capability) =>
        provider.capabilityServiceState?.(capability) === "available",
    );
  }

  /**
   * Managed-credential state of one provider, as a client renders it. Null for a
   * provider that supports no managed credential at all, so nothing about the
   * feature appears where it does not apply.
   */
  private serviceSummary(
    providerId: IntegrationProviderId,
    integration: StoredIntegration | undefined,
  ): IntegrationServiceSummary | null {
    const provider = this.providers.get(providerId);
    if (provider.capabilityServiceState === undefined) return null;
    const capabilities: Record<string, CapabilityServiceState> = {};
    for (const capability of provider.capabilities) {
      capabilities[capability] =
        provider.capabilityServiceState(capability) ?? "unavailable";
    }
    const profile =
      integration === undefined
        ? undefined
        : this.serviceCredentials?.find(
            providerId,
            integration.externalTenantId ?? "",
          );
    return {
      available: profile?.enabled === true,
      label: profile?.label ?? null,
      resources: profile?.resources ?? null,
      selection: integration?.serviceSelection ?? null,
      capabilities: Object.freeze(capabilities),
    };
  }

  private requireConnected(
    principal: IntegrationPrincipal,
    provider: IntegrationProviderId,
  ): StoredIntegration {
    const integration = this.repository.find(principal, provider);
    if (
      integration === undefined ||
      integration.status === "revoked" ||
      (integration.secretRef === null &&
        integration.credentialSource !== "service")
    ) {
      throw new IntegrationError(
        "IntegrationNotConnected",
        "Integration is not connected",
      );
    }
    return integration;
  }

  /**
   * Unlock the credential of one captured binding. The lookup starts from the
   * principal that asked and the provider being reached, as every lookup in the
   * store does, and the binding's own reference selects the generation of that
   * connection: an operation that read the live row instead would spend the
   * credential of whoever holds it now while filing its verdict against the
   * generation it started from, and those two are only the same object when the
   * reference is still the one the row carries.
   */
  private async decrypt(
    principal: IntegrationPrincipal,
    provider: IntegrationProviderId,
    integration: StoredIntegration,
  ): Promise<string> {
    const record = this.repository.secretByRef(
      principal,
      provider,
      integration.secretRef,
    );
    if (record === undefined) {
      // The binding named a credential that is no longer stored: it was spent by
      // a reconnect while this read was under way. Refuse it as the missing
      // connection it is, the same way `requireConnected` refuses a binding that
      // has gone, and never as a policy refusal — `PersonalCredentialRequired`
      // would tell the user to store a token they just replaced, and the audit
      // trail would file a lost race among the calls policy declined.
      throw new IntegrationError(
        "IntegrationNotConnected",
        "The credential this request started from is no longer stored",
      );
    }
    if (
      record.expiresAt !== null &&
      Date.parse(record.expiresAt) <= Date.now()
    ) {
      throw new IntegrationError(
        "CredentialExpired",
        "Integration credential expired",
      );
    }
    try {
      return await this.secrets.decrypt(record);
    } catch {
      throw new IntegrationError(
        "CredentialRevoked",
        "Integration credential is unavailable",
      );
    }
  }
}

/** What a probe verdict means for the stored binding, if anything. */
function healthCode(
  health: ServiceCredentialHealth | undefined,
): IntegrationErrorCode | undefined {
  switch (health?.status) {
    case undefined:
    case "healthy":
      return undefined;
    case "expired":
      return "CredentialExpired";
    case "revoked":
      return "CredentialRevoked";
    case "unsafe_scope":
      return "ServiceCredentialUnsafeScope";
    default:
      return "ProviderUnavailable";
  }
}

/** Codes that mean "policy refused this", wherever the refusal was decided. */
const DENIAL_CODES: readonly IntegrationErrorCode[] = Object.freeze([
  "OperationDeniedByPolicy",
  "OperationNotAllowedWithServiceCredential",
  "SensitiveReadRequiresPersonalCredential",
  "ServiceResourceNotAllowed",
  "ServiceCredentialUnavailable",
  "ServiceCredentialDisabled",
  "ServiceCredentialInvalid",
  "PersonalCredentialRequired",
]);

function isPolicyDenial(error: unknown): boolean {
  return error instanceof IntegrationError && DENIAL_CODES.includes(error.code);
}
