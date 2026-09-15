import { IntegrationError } from "../errors.js";
import type {
  IntegrationCapability,
  ProviderValidation,
  ResolvedQaIntegrationsConfig,
} from "../types.js";
import type { IntegrationProvider, ProviderContext } from "./contract.js";

interface BitrixCredential {
  readonly webhookBaseUrl: string;
}

interface BitrixEnvelope {
  readonly result?: unknown;
  readonly error?: unknown;
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

export class Bitrix24Provider implements IntegrationProvider {
  readonly id = "bitrix24" as const;
  readonly displayName = "Bitrix24";
  readonly capabilities: readonly IntegrationCapability[];

  constructor(
    private readonly config: ResolvedQaIntegrationsConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.capabilities = Object.freeze([
      ...(config.bitrix24.crmRead ? (["crm.read"] as const) : []),
      ...(config.bitrix24.chatRead ? (["chat.read"] as const) : []),
    ]);
  }

  async validate(context: ProviderContext): Promise<ProviderValidation> {
    const credential = credentialFromPlaintext(context.credential);
    const result = await this.call(credential, "profile", {});
    if (typeof result !== "object" || result === null) {
      throw new IntegrationError(
        "ProviderUnavailable",
        "Provider identity is unavailable",
      );
    }
    const profile = result as Record<string, unknown>;
    const first = typeof profile["NAME"] === "string" ? profile["NAME"] : "";
    const last =
      typeof profile["LAST_NAME"] === "string" ? profile["LAST_NAME"] : "";
    return {
      tenantId: new URL(credential.webhookBaseUrl).hostname,
      externalUserId: String(profile["ID"] ?? ""),
      displayName: `${first} ${last}`.trim() || "Пользователь Bitrix24",
      capabilities: this.capabilities,
    };
  }

  async execute(
    context: ProviderContext,
    operation: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const credential = credentialFromPlaintext(context.credential);
    switch (operation) {
      case "crm.search": {
        const query = String(input["query"] ?? "").trim();
        return this.call(credential, "crm.item.list", {
          entityTypeId: input["entityTypeId"],
          select: ["id", "title", "createdTime", "updatedTime", "assignedById"],
          ...(query === "" ? {} : { filter: { "%title": query } }),
          start: 0,
        });
      }
      case "crm.get":
        return this.call(credential, "crm.item.get", {
          entityTypeId: input["entityTypeId"],
          id: input["id"],
        });
      case "chat.search":
        return this.call(credential, "im.search.chat.list", {
          FIND: input["query"],
          OFFSET: 0,
          LIMIT: input["limit"],
        });
      case "chat.messages":
        return this.call(credential, "im.dialog.messages.get", {
          DIALOG_ID: input["dialogId"],
          LIMIT: input["limit"],
          ...(input["lastId"] === undefined
            ? {}
            : { LAST_ID: input["lastId"] }),
        });
      default:
        throw new IntegrationError(
          "InvalidRequest",
          "Unsupported Bitrix24 operation",
        );
    }
  }

  private async call(
    credential: BitrixCredential,
    method: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
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
      return envelope?.result;
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
