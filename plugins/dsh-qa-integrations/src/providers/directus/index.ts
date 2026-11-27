import { invalid } from "../../coerce.js";
import type { ResolvedQaIntegrationsConfig } from "../../config.js";
import { IntegrationError } from "../../errors.js";
import { operationCapabilityServiceState } from "../../service-credentials/state.js";
import type {
  OperationSecurityMetadata,
  ServiceCredentialHealth,
} from "../../service-credentials/types.js";
import type { ProviderValidation } from "../../types.js";
import type { IntegrationProvider, ProviderContext } from "../contract.js";
import { statusErrorOf, transportFailureOf } from "../kernel/errors.js";
import { fetchWithRetries, readBoundedJson } from "../kernel/read-policy.js";
import { healthFromFailure } from "../shared/health.js";
import {
  assertServiceOperationAllowed,
  serviceBoundaryOf,
  serviceResourceDenied,
} from "../shared/service-boundary.js";
import {
  decodeCredentialFields,
  invalidStoredCredential,
} from "../kernel/token.js";
import type { DirectusInstance } from "./config.js";
import { DIRECTUS_OPERATIONS } from "./catalog.js";
import { directusProviderId } from "./identity.js";
import { fetchDirectus } from "./transport.js";
import {
  countQuery,
  directusCount,
  directusRecord,
  itemPath,
  listQuery,
  nextOffset,
  projectItem,
} from "./query.js";

const TOKEN = /^[a-zA-Z0-9_.~-]{8,1024}$/u;
const FILE_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
const FILE_FIELDS = [
  "id",
  "title",
  "filename_download",
  "type",
  "filesize",
] as const;

const OPERATIONS = new Map(Object.entries(DIRECTUS_OPERATIONS));

export default class DirectusProvider implements IntegrationProvider {
  readonly id: string;
  readonly displayName: string;
  readonly credentialHelp = null;
  readonly capabilities: readonly string[];
  readonly capabilityInfo = {
    "items.read": {
      label: "Записи Directus",
      hint: "Поиск и чтение разрешённых коллекций.",
    },
    "files.read": {
      label: "Вложения Directus",
      hint: "Метаданные и ссылки на вложения разрешённых записей.",
    },
  };

  constructor(
    private readonly instance: DirectusInstance,
    private readonly config: Pick<
      ResolvedQaIntegrationsConfig,
      "timeoutMs" | "maxResponseBytes"
    >,
    private readonly fetcher: typeof fetch = fetchDirectus,
  ) {
    this.id = directusProviderId(instance.id);
    this.displayName = `Directus · ${instance.label}`;
    this.capabilities = instance.collections.some(
      (collection) => collection.fileFields?.length,
    )
      ? ["items.read", "files.read"]
      : ["items.read"];
  }

  operationCapability(operation: string): string | undefined {
    const capability = OPERATIONS.get(operation)?.capability;
    return capability !== undefined && this.capabilities.includes(capability)
      ? capability
      : undefined;
  }

  operationMetadata(operation: string): OperationSecurityMetadata | undefined {
    return OPERATIONS.get(operation)?.security;
  }

  resourceBoundaryKind(operation: string): string | undefined {
    return this.operationMetadata(operation)?.requiresResourceBoundary
      ? "collections"
      : undefined;
  }

  instancePortal(instanceId: string): string | undefined {
    return instanceId === this.instance.id ? this.instance.baseUrl : undefined;
  }

  capabilityServiceState(
    capability: string,
    policy?: Readonly<Record<string, "allow" | "deny">>,
  ) {
    return operationCapabilityServiceState(DIRECTUS_OPERATIONS, capability, {
      provider: this.id,
      policy,
    });
  }

  parseCredential(raw: string) {
    const token = raw.trim();
    if (!TOKEN.test(token))
      throw new IntegrationError(
        "InvalidCredential",
        "Enter a Directus access token",
      );
    return {
      credential: JSON.stringify({ token, baseUrl: this.instance.baseUrl }),
      portal: this.instance.baseUrl,
    };
  }

  private token(context: ProviderContext): string {
    const { token, baseUrl } = decodeCredentialFields(context.credential, {
      token: "nonempty",
      baseUrl: "nonempty",
    });
    if (baseUrl !== this.instance.baseUrl || !TOKEN.test(token))
      invalidStoredCredential();
    return token;
  }

  async validate(context: ProviderContext): Promise<ProviderValidation> {
    const account = directusRecord(
      await this.get(
        this.token(context),
        DIRECTUS_OPERATIONS["connection.get"].path,
        new URLSearchParams({ fields: "id" }),
      ),
    );
    const id = account["id"];
    if (typeof id !== "string" || id.length < 1 || id.length > 128) {
      throw new IntegrationError(
        "CredentialRevoked",
        "Directus did not identify the token owner",
      );
    }
    return {
      tenantId: this.instance.baseUrl,
      externalUserId: id,
      displayName: this.instance.label,
      capabilities: this.capabilities,
    };
  }

  async validateServiceCredential(
    context: ProviderContext,
  ): Promise<ServiceCredentialHealth> {
    try {
      await this.validate(context);
      return { status: "healthy" };
    } catch (error) {
      return healthFromFailure(error);
    }
  }

  async execute(
    context: ProviderContext,
    operation: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const capability = this.operationCapability(operation);
    if (capability === undefined) {
      throw new IntegrationError(
        "InvalidRequest",
        "Unsupported Directus operation",
      );
    }
    if (context.credentialSource === "service") {
      assertServiceOperationAllowed(
        this.operationMetadata(operation),
        "Directus service connection",
        {
          provider: this.id,
          capability,
          operation,
          policy: context.serviceOperationPolicy,
        },
      );
    }
    const source = this.instance.id;
    if (operation === "connection.get") {
      return { source, address: (await this.validate(context)).tenantId };
    }
    const boundary = serviceBoundaryOf(context);
    const collections =
      boundary === undefined
        ? this.instance.collections
        : this.instance.collections.filter(({ name }) =>
            boundary["collections"]?.includes(name),
          );
    const token = this.token(context);
    if (operation === "collections.list") {
      return { source, collections };
    }
    const collection = collections.find(
      (entry) => entry.name === input["collection"],
    );
    if (collection === undefined) {
      if (boundary !== undefined) throw serviceResourceDenied();
      invalid("collection", "choose an allowed collection");
    }
    if (operation === "items.count") {
      const query = countQuery(collection, input["filters"]);
      const answer = await this.get(token, `/items/${collection.name}`, query);
      return {
        source,
        collection: collection.name,
        count: directusCount(answer, collection.primaryKey),
      };
    }
    if (operation === "items.list") {
      const { query, limit, offset } = listQuery(collection, input);
      const rows = await this.get(token, `/items/${collection.name}`, query);
      if (!Array.isArray(rows) || rows.length > limit) {
        throw new IntegrationError(
          "ProviderUnavailable",
          "Directus returned an unexpected page",
        );
      }
      const continuation = nextOffset(offset, rows.length, limit);
      return {
        source,
        collection: collection.name,
        items: rows.map((row: unknown) => projectItem(collection, row, limit)),
        nextOffset: continuation,
        scanLimited: rows.length === limit && continuation === null,
      };
    }
    const path = itemPath(collection, input["id"]);
    if (operation === "files.get") {
      const field = input["field"];
      if (typeof field !== "string" || !collection.fileFields?.includes(field))
        invalid("field", "choose a configured file relation");
      const record = directusRecord(
        await this.get(token, path, new URLSearchParams({ fields: field })),
      );
      const id = record[field];
      if (typeof id !== "string" || !FILE_ID.test(id)) {
        throw new IntegrationError(
          "ResourceNotFound",
          "No readable file is linked in this field",
        );
      }
      const file = directusRecord(
        await this.get(
          token,
          `/files/${id}`,
          new URLSearchParams({ fields: FILE_FIELDS.join(",") }),
        ),
      );
      if (file["id"] !== id)
        throw new IntegrationError(
          "ProviderUnavailable",
          "Directus returned a different file",
        );
      return {
        source,
        collection: collection.name,
        file: projectItem(
          { name: "files", primaryKey: "id", fields: FILE_FIELDS },
          file,
        ),
        address: `${this.instance.baseUrl}/assets/${id}`,
      };
    }
    const item = projectItem(
      collection,
      await this.get(
        token,
        path,
        new URLSearchParams({ fields: collection.fields.join(",") }),
      ),
    );
    const id = path.slice(path.lastIndexOf("/") + 1);
    if (String(item[collection.primaryKey]) !== id) {
      throw new IntegrationError(
        "ProviderUnavailable",
        "Directus returned a different record",
      );
    }
    return {
      source,
      collection: collection.name,
      item,
      address: `${this.instance.baseUrl}/admin/content/${collection.name}/${id}`,
    };
  }

  private async get(
    token: string,
    path: string,
    query: URLSearchParams,
  ): Promise<unknown> {
    const label = "Directus";
    return fetchWithRetries(
      this.fetcher,
      `${this.instance.baseUrl}${path}?${query.toString()}`,
      {
        timeoutMs: this.config.timeoutMs,
        retries: 0,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
        },
        statusFailure: statusErrorOf({ label }),
        transportFailure: transportFailureOf({ label }),
      },
      async (response, signal) => {
        const payload = directusRecord(
          await readBoundedJson<unknown>(
            response,
            Math.min(this.config.maxResponseBytes, 256_000),
            label,
            signal,
          ),
        );
        if (!Object.hasOwn(payload, "data"))
          throw new IntegrationError(
            "ProviderUnavailable",
            "Unexpected Directus response",
          );
        return payload["data"];
      },
    );
  }
}
