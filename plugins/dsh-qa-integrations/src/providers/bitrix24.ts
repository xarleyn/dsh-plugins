import {
  BITRIX_CAPABILITIES,
  BITRIX_OPERATIONS,
  enabledCapabilities,
  type BitrixListShape,
  type BitrixOperationDefinition,
} from "../catalog.js";
import { IntegrationError } from "../errors.js";
import type {
  IntegrationCapability,
  ProviderValidation,
  ResolvedQaIntegrationsConfig,
} from "../types.js";
import type { IntegrationProvider, ProviderContext } from "./contract.js";
import { BITRIX_HANDLERS, BITRIX_PROJECTIONS } from "./bitrix24-operations.js";

interface BitrixCredential {
  readonly webhookBaseUrl: string;
}

interface BitrixEnvelope {
  readonly result?: unknown;
  readonly error?: unknown;
  readonly total?: unknown;
  readonly next?: unknown;
}

interface BitrixResponse {
  readonly result: unknown;
  readonly total?: number | undefined;
  readonly next?: number | undefined;
}

function credentialFromPlaintext(plaintext: string): BitrixCredential {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new IntegrationError(
      "CredentialRevoked",
      "Stored credential is invalid",
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { webhookBaseUrl?: unknown }).webhookBaseUrl !== "string"
  ) {
    throw new IntegrationError(
      "CredentialRevoked",
      "Stored credential is invalid",
    );
  }
  return parsed as BitrixCredential;
}

/** Parse a complete incoming-webhook URL without ever returning its secret part. */
export function parseBitrixWebhook(
  raw: string,
  allowedSuffixes: readonly string[],
): { readonly credential: string; readonly portal: string } {
  if (raw.length > 2_048) {
    throw new IntegrationError("InvalidCredential", "Webhook URL is too long");
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new IntegrationError("InvalidCredential", "Webhook URL is invalid");
  }
  const host = url.hostname.toLowerCase();
  const hostAllowed = allowedSuffixes.some(
    (suffix) => host.endsWith(suffix) && host.length > suffix.length,
  );
  const match = /^\/rest\/(\d+)\/([A-Za-z0-9_-]{8,})\/?$/u.exec(url.pathname);
  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    !hostAllowed ||
    match === null
  ) {
    throw new IntegrationError(
      "InvalidCredential",
      "Use an HTTPS Bitrix24 incoming-webhook URL",
    );
  }
  return {
    credential: JSON.stringify({
      webhookBaseUrl: `${url.origin}/rest/${match[1]}/${match[2]}`,
    } satisfies BitrixCredential),
    portal: host,
  };
}

async function readBounded(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new IntegrationError(
      "ProviderUnavailable",
      "Provider response is too large",
    );
  }
  if (response.body === null) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new IntegrationError(
        "ProviderUnavailable",
        "Provider response is too large",
      );
    }
    chunks.push(next.value);
  }
  const body = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
  ).toString("utf8");
  try {
    return JSON.parse(body);
  } catch {
    throw new IntegrationError(
      "ProviderUnavailable",
      "Provider returned invalid JSON",
    );
  }
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

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

/**
 * Every list operation answers with the same envelope, so the model does not
 * have to learn six response shapes and never loses the pagination cursor.
 */
function collect(
  operation: string,
  definition: BitrixOperationDefinition,
  response: BitrixResponse,
  params: Readonly<Record<string, unknown>>,
): unknown {
  const projection = BITRIX_PROJECTIONS[operation];
  if (projection !== undefined) return projection(response.result);
  if (definition.list === undefined) return response.result;
  const items = itemsOf(response.result, definition.list);
  // IM methods page with OFFSET, CRM and task methods with start.
  const start = count(params["start"] ?? params["OFFSET"]);
  const pagination = {
    ...(start === undefined ? {} : { start }),
    ...(response.next === undefined ? {} : { next: response.next }),
    ...(response.total === undefined ? {} : { total: response.total }),
  };
  return Object.keys(pagination).length === 0
    ? { items }
    : { items, pagination };
}

export class Bitrix24Provider implements IntegrationProvider {
  readonly id = "bitrix24" as const;
  readonly displayName = "Bitrix24";
  /** What this deployment allows; the webhook scope probe narrows it per user. */
  readonly capabilities: readonly IntegrationCapability[];

  constructor(
    private readonly config: ResolvedQaIntegrationsConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.capabilities = Object.freeze(enabledCapabilities(config.bitrix24));
  }

  operationCapability(operation: string): IntegrationCapability | undefined {
    return BITRIX_OPERATIONS[operation]?.capability;
  }

  async validate(context: ProviderContext): Promise<ProviderValidation> {
    const credential = credentialFromPlaintext(context.credential);
    const profile = await this.call(credential, "profile", {});
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
    const response = await this.call(credential, definition.method, params);
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
      const response = await this.call(credential, "scope", {});
      if (!Array.isArray(response.result)) return undefined;
      return response.result
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.toLowerCase());
    } catch {
      return undefined;
    }
  }

  private async call(
    credential: BitrixCredential,
    method: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<BitrixResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetcher(
        `${credential.webhookBaseUrl}/${method}.json`,
        {
          method: "POST",
          redirect: "error",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(params),
          signal: controller.signal,
        },
      );
      const envelope = (await readBounded(
        response,
        this.config.maxResponseBytes,
      )) as BitrixEnvelope | null;
      if (!response.ok || envelope?.error !== undefined) {
        const denied = response.status === 401 || response.status === 403;
        throw new IntegrationError(
          denied ? "ProviderPermissionDenied" : "ProviderUnavailable",
          denied ? "Provider denied this operation" : "Provider request failed",
        );
      }
      return {
        result: envelope?.result,
        total: count(envelope?.total),
        next: count(envelope?.next),
      };
    } catch (error) {
      if (error instanceof IntegrationError) throw error;
      throw new IntegrationError(
        "ProviderUnavailable",
        "Provider request failed",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
