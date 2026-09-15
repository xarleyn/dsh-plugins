import type { ResolvedQaIntegrationsConfig } from "../../config.js";
import { IntegrationError } from "../../errors.js";
import type {
  IntegrationCapability,
  IntegrationCapabilityInfo,
  ProviderValidation,
} from "../../types.js";
import type { IntegrationProvider, ProviderContext } from "../contract.js";
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

  private readonly transport: BitrixTransport;

  constructor(
    private readonly config: ResolvedQaIntegrationsConfig,
    fetcher: typeof fetch = fetch,
  ) {
    this.transport = new BitrixTransport(config, fetcher);
    this.capabilities = Object.freeze(enabledCapabilities(config.bitrix24));
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

export default Bitrix24Provider;
