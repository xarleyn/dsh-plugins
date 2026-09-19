import {
  resolveCredentialHelp,
  type CredentialHelp,
} from "@yadsh/dsh-plugin-kit";
import type { ResolvedQaIntegrationsConfig } from "../../config.js";
import { IntegrationError } from "../../errors.js";
import type {
  CapabilityServiceState,
  IntegrationCapability,
  IntegrationCapabilityInfo,
  ProviderValidation,
  SafeExternalIdentity,
  ServiceCredentialHealth,
} from "../../types.js";
import { boundaryHas } from "../../service-credentials/policy.js";
import { operationCapabilityServiceState } from "../../service-credentials/state.js";
import type { OperationSecurityMetadata } from "../../service-credentials/types.js";
import type { IntegrationProvider, ProviderContext } from "../contract.js";
import {
  assertServiceOperationAllowed,
  serviceBoundaryOf,
} from "../shared/service-boundary.js";
import {
  BITRIX_CAPABILITIES,
  BITRIX_OPERATIONS,
  BITRIX24_CAPABILITY_INFO,
  bitrix24OperationCapability,
  enabledCapabilities,
  type BitrixListShape,
  type BitrixOperationDefinition,
} from "./catalog.js";
import { BITRIX_HANDLERS, BITRIX_PROJECTIONS } from "./operations.js";
import { BITRIX24_CREDENTIAL_HELP } from "./credential-help.js";
import {
  BitrixTransport,
  credentialFromPlaintext,
  parseBitrixWebhook,
  type BitrixCredential,
  type BitrixResponse,
} from "./transport.js";

export {
  credentialFromPlaintext,
  parseBitrixWebhook,
  type BitrixCredential,
} from "./transport.js";

function itemsOf(result: unknown, shape: BitrixListShape): unknown[] {
  if (shape === "self") return Array.isArray(result) ? result : [];
  if (shape === "map") {
    return typeof result === "object" &&
      result !== null &&
      !Array.isArray(result)
      ? Object.values(result)
      : [];
  }
  if (typeof result !== "object" || result === null) return [];
  const held = (result as Record<string, unknown>)[shape];
  return Array.isArray(held) ? held : [];
}

function offsetOf(params: unknown): number | undefined {
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    return undefined;
  }
  const record = params as Record<string, unknown>;
  // IM methods page with OFFSET, CRM and task methods with start.
  const offset = record["start"] ?? record["OFFSET"];
  return typeof offset === "number" && Number.isFinite(offset)
    ? offset
    : undefined;
}

/**
 * Every list operation answers with the same envelope, so the model does not
 * have to learn six response shapes and never loses the pagination cursor.
 */
function collect(
  operation: string,
  definition: BitrixOperationDefinition,
  response: BitrixResponse,
  params: unknown,
): unknown {
  const projection = BITRIX_PROJECTIONS[operation];
  if (projection !== undefined) return projection(response.result);
  if (definition.list === undefined) return response.result;
  const items = itemsOf(response.result, definition.list);
  const offset = offsetOf(params);
  const pagination = {
    ...(offset === undefined ? {} : { start: offset }),
    ...(response.next === undefined ? {} : { next: response.next }),
    ...(response.total === undefined ? {} : { total: response.total }),
  };
  return Object.keys(pagination).length === 0
    ? { items }
    : { items, pagination };
}

/** Bitrix24 provider: incoming-webhook credentials over the Bitrix24 REST API. */
export class Bitrix24Provider implements IntegrationProvider {
  readonly id = "bitrix24";
  readonly displayName = "Bitrix24";
  /** What this deployment allows; the webhook scope probe narrows it per user. */
  readonly capabilities: readonly IntegrationCapability[];
  readonly capabilityInfo: Readonly<
    Record<IntegrationCapability, IntegrationCapabilityInfo>
  > = BITRIX24_CAPABILITY_INFO;
  /** Where the settings card says this provider's credential comes from. */
  readonly credentialHelp: CredentialHelp | null;
  /** Overrides the deployment got wrong; reported once at startup, never fatal. */
  readonly credentialHelpProblems: readonly string[];

  private readonly transport: BitrixTransport;

  constructor(
    private readonly config: ResolvedQaIntegrationsConfig,
    fetcher: typeof fetch = fetch,
  ) {
    this.transport = new BitrixTransport(config, fetcher);
    this.capabilities = Object.freeze(enabledCapabilities(config.bitrix24));
    const help = resolveCredentialHelp(
      BITRIX24_CREDENTIAL_HELP,
      config.credentialHelp["bitrix24"],
    );
    this.credentialHelp = help.help;
    this.credentialHelpProblems = help.problems;
  }

  /** Keep only the secret part of an operator-supplied webhook URL. */
  parseCredential(raw: string): {
    readonly credential: string;
    readonly portal: string;
  } {
    return parseBitrixWebhook(raw, this.config.allowedPortalSuffixes);
  }

  operationCapability(operation: string): IntegrationCapability | undefined {
    return bitrix24OperationCapability(operation);
  }

  /**
   * Security classification of one operation, straight from the catalog: an
   * operation the catalog does not list is unclassified and unreachable
   * through the managed credential.
   */
  operationMetadata(operation: string): OperationSecurityMetadata | undefined {
    return BITRIX_OPERATIONS[operation]?.security;
  }

  /**
   * How one capability behaves under the managed credential. A capability that
   * mixes portal reads with personal-only reads (CRM: the call transcript and
   * the duplicate lookup stay personal) reports `sensitive`, so the card says
   * what the connection loses in service mode.
   */
  capabilityServiceState(
    capability: IntegrationCapability,
  ): CapabilityServiceState | undefined {
    return operationCapabilityServiceState(BITRIX_OPERATIONS, capability);
  }

  /**
   * Bitrix24 scopes by portal, not by project, so `"portals"` is the one
   * boundary kind: the profile names the portal hosts a service account may
   * work inside, and every boundary-required call checks against them.
   */
  resourceBoundaryKind(operation: string): string | undefined {
    const security = BITRIX_OPERATIONS[operation]?.security;
    return security?.requiresResourceBoundary === true ? "portals" : undefined;
  }

  /**
   * Portal host of one configured instance, so deployment configuration can
   * name an instance the same way the connect form does and a typo fails at
   * load. The host — not the URL — is the form a stored portal carries.
   */
  instancePortal(instanceId: string): string | undefined {
    const instances = this.config.bitrix24.instances;
    const id = instanceId.trim();
    if (id === "") {
      return instances.length === 1 ? instances[0]?.portal : undefined;
    }
    return instances.find((instance) => instance.id === id)?.portal;
  }

  async validate(context: ProviderContext): Promise<ProviderValidation> {
    const credential = credentialFromPlaintext(context.credential);
    const profile = await this.transport.call(credential, "profile", {});
    if (typeof profile.result !== "object" || profile.result === null) {
      throw new IntegrationError(
        "ProviderUnavailable",
        "Provider identity is unavailable",
      );
    }
    const fields = profile.result as Record<string, unknown>;
    const first = typeof fields["NAME"] === "string" ? fields["NAME"] : "";
    const last =
      typeof fields["LAST_NAME"] === "string" ? fields["LAST_NAME"] : "";
    const scopes = await this.grantedScopes(credential);
    return {
      tenantId: new URL(credential.webhookBaseUrl).hostname,
      externalUserId: String(fields["ID"] ?? ""),
      displayName: `${first} ${last}`.trim() || "Пользователь Bitrix24",
      capabilities:
        scopes === undefined
          ? this.capabilities
          : this.capabilities.filter((capability) => {
              const definition = BITRIX_CAPABILITIES.find(
                (item) => item.capability === capability,
              );
              return (
                definition !== undefined &&
                definition.scopes.some((scope) => scopes.includes(scope))
              );
            }),
    };
  }

  /**
   * Health of a deployment-managed webhook. The probe reads only the identity
   * and scope self-inspection methods, so it never changes upstream state.
   * Bitrix24 webhook scopes are coarse — the `crm` scope reads and writes with
   * one bit — so the probe cannot certify read-only the way GitLab scopes can;
   * the answer says so, and the local service ceiling is what bounds the
   * credential either way.
   */
  async validateServiceCredential(
    context: ProviderContext,
  ): Promise<ServiceCredentialHealth> {
    const credential = credentialFromPlaintext(context.credential);
    let identity: SafeExternalIdentity | undefined;
    let scopes: readonly string[] | undefined;
    try {
      const profile = await this.transport.call(credential, "profile", {});
      const fields =
        typeof profile.result === "object" && profile.result !== null
          ? (profile.result as Record<string, unknown>)
          : {};
      const first = typeof fields["NAME"] === "string" ? fields["NAME"] : "";
      const last =
        typeof fields["LAST_NAME"] === "string" ? fields["LAST_NAME"] : "";
      const id = String(fields["ID"] ?? "");
      identity =
        id === ""
          ? undefined
          : {
              id,
              label: `${first} ${last}`.trim() || "Пользователь Bitrix24",
            };
      scopes = await this.grantedScopes(credential);
    } catch (error) {
      return healthFromFailure(error);
    }
    return {
      status: "healthy",
      ...(identity === undefined ? {} : { upstreamIdentity: identity }),
      ...(scopes === undefined ? {} : { grantedScopes: scopes }),
      warnings: [
        "Bitrix24 webhook scopes are coarse (one scope reads and writes), so the probe cannot certify read-only; the local service ceiling still applies",
      ],
    };
  }

  async execute(
    context: ProviderContext,
    operation: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const credential = credentialFromPlaintext(context.credential);
    const definition = BITRIX_OPERATIONS[operation];
    const handler = BITRIX_HANDLERS[operation];
    if (definition === undefined || handler === undefined) {
      throw new IntegrationError(
        "InvalidRequest",
        "Unsupported Bitrix24 operation",
      );
    }
    // Ceiling first, then the boundary: what the operation is decides before
    // where it may read.
    if (context.credentialSource === "service") {
      assertServiceOperationAllowed(
        definition.security,
        "This Bitrix24 operation is not available through the service credential",
      );
    }
    const boundary = serviceBoundaryOf(context);
    if (
      boundary !== undefined &&
      definition.security.requiresResourceBoundary
    ) {
      // Bitrix24 bounds by portal: the profile has to name the very host this
      // webhook answers on, or nothing behind it may be read at all.
      const portal = new URL(credential.webhookBaseUrl).hostname;
      if (!boundaryHas(boundary, "portals", portal)) {
        throw new IntegrationError(
          "ServiceResourceNotAllowed",
          "Service mode reads only the resources this workspace is allowed to see",
        );
      }
    }
    const params = handler(input, { externalUserId: context.externalUserId });
    const response = await this.transport.call(
      credential,
      definition.method,
      params,
    );
    return collect(operation, definition, response, params);
  }

  /**
   * The scopes the connected webhook was actually granted. A portal that
   * refuses `scope` only costs precision: the deployment switches still bound
   * what the agent may try.
   */
  private async grantedScopes(
    credential: BitrixCredential,
  ): Promise<readonly string[] | undefined> {
    try {
      const response = await this.transport.call(credential, "scope", {});
      if (!Array.isArray(response.result)) return undefined;
      return response.result
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.toLowerCase());
    } catch {
      return undefined;
    }
  }
}

/** Map an upstream failure of the probe onto a health status. */
function healthFromFailure(error: unknown): ServiceCredentialHealth {
  if (!(error instanceof IntegrationError)) {
    return { status: "unreachable" };
  }
  switch (error.code) {
    case "CredentialExpired":
      return { status: "expired" };
    case "CredentialRevoked":
    case "ProviderPermissionDenied":
      return { status: "revoked" };
    default:
      return { status: "unreachable" };
  }
}

export default Bitrix24Provider;
