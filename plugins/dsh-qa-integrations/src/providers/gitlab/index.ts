import type { ResolvedQaIntegrationsConfig } from "../../config.js";
import { IntegrationError } from "../../errors.js";
import { redactSecrets } from "../../redaction.js";
import type {
  IntegrationCapability,
  IntegrationCapabilityInfo,
  ProviderValidation,
} from "../../types.js";
import type { IntegrationProvider, ProviderContext } from "../contract.js";
import {
  GITLAB_CAPABILITIES,
  GITLAB_CAPABILITY_INFO,
  GITLAB_OPERATIONS,
  capabilitiesForScopes,
  enabledCapabilities,
  gitlabOperationCapability,
  type GitlabCapability,
} from "./catalog.js";
import {
  gitlabInstance,
  type GitlabFlags,
  type GitlabInstance,
} from "./config.js";
import {
  GITLAB_HANDLERS,
  GITLAB_PROJECTIONS,
  fileByteLimit,
  jobLogByteLimit,
  type GitlabRequest,
} from "./operations.js";
import {
  GitlabTransport,
  credentialFromPlaintext,
  credentialInstance,
  type GitlabCredential,
  type GitlabPage,
} from "./transport.js";

export {
  credentialFromPlaintext,
  credentialInstance,
  type GitlabCredential,
} from "./transport.js";

/**
 * GitLab personal access tokens are either the classic 20-character form or a
 * prefixed one (`glpat-…`). A pasted URL, a YAML snippet or a credential with
 * whitespace is refused before anything is sent upstream.
 */
const TOKEN_SHAPE = /^[A-Za-z0-9_.-]{20,255}$/u;

function accountName(data: Record<string, unknown>): string {
  const name = typeof data["name"] === "string" ? data["name"].trim() : "";
  const username =
    typeof data["username"] === "string" ? data["username"].trim() : "";
  if (name !== "" && username !== "") return `${name} (@${username})`;
  return name !== "" ? name : username === "" ? "GitLab" : `@${username}`;
}

/** One answer shape for every list, so the model never loses the cursor. */
function envelope(
  data: unknown,
  page: GitlabPage | undefined,
): Record<string, unknown> {
  const pagination =
    page === undefined
      ? {}
      : {
          pagination: {
            page: page.page,
            perPage: page.perPage,
            ...(page.nextPage === undefined ? {} : { nextPage: page.nextPage }),
            ...(page.total === undefined ? {} : { total: page.total }),
          },
        };
  if (Array.isArray(data)) return { items: data, ...pagination };
  if (typeof data === "object" && data !== null) {
    return { ...(data as Record<string, unknown>), ...pagination };
  }
  return { value: data ?? null, ...pagination };
}

/** A segment this provider encoded itself; a malformed one is shown as-is. */
function decodedPath(encoded: string): string {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function objectOf(data: unknown): Record<string, unknown> {
  return typeof data === "object" && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : { value: data ?? null };
}

/** GitLab provider: operator-configured instances over a personal access token. */
export class GitlabProvider implements IntegrationProvider {
  readonly id = "gitlab";
  readonly displayName = "GitLab";
  /** What this deployment allows; the token scope probe narrows it per user. */
  readonly capabilities: readonly IntegrationCapability[];
  readonly capabilityInfo: Readonly<
    Record<IntegrationCapability, IntegrationCapabilityInfo>
  > = GITLAB_CAPABILITY_INFO;

  private readonly transport: GitlabTransport;

  constructor(
    private readonly config: ResolvedQaIntegrationsConfig,
    fetcher: typeof fetch = fetch,
  ) {
    this.transport = new GitlabTransport(config, config.gitlab, fetcher);
    this.capabilities = Object.freeze(enabledCapabilities(config.gitlab));
  }

  /**
   * Keep only the token, tagged with the instance it was minted for. The
   * instance comes from the connect form and from operator config, never from a
   * tool argument, which is what keeps the broker from dialling any host the
   * caller names.
   */
  parseCredential(
    raw: string,
    options?: Readonly<Record<string, string>>,
  ): { readonly credential: string; readonly portal: string } {
    const token = raw.trim();
    if (!TOKEN_SHAPE.test(token)) {
      throw new IntegrationError(
        "InvalidCredential",
        "Use a GitLab personal access token",
      );
    }
    const instance = this.resolveInstance(options?.["instanceId"]);
    return {
      credential: JSON.stringify({
        instanceId: instance.id,
        token,
      } satisfies GitlabCredential),
      portal: instance.baseUrl,
    };
  }

  operationCapability(operation: string): IntegrationCapability | undefined {
    return gitlabOperationCapability(operation);
  }

  async validate(context: ProviderContext): Promise<ProviderValidation> {
    const credential = credentialFromPlaintext(context.credential);
    const instance = credentialInstance(this.config.gitlab, credential);
    const { data } = await this.transport.getJson<Record<string, unknown>>(
      instance,
      credential.token,
      "/user",
    );
    const id = data["id"];
    if (typeof id !== "number") {
      throw new IntegrationError(
        "ProviderUnavailable",
        "Provider identity is unavailable",
      );
    }
    const scopes = await this.grantedScopes(instance, credential.token);
    const allowed = this.capabilities;
    return {
      tenantId: instance.baseUrl,
      externalUserId: String(id),
      displayName: accountName(data),
      capabilities:
        scopes === undefined ? allowed : intersectScopes(allowed, scopes),
    };
  }

  async execute(
    context: ProviderContext,
    operation: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const credential = credentialFromPlaintext(context.credential);
    const instance = credentialInstance(this.config.gitlab, credential);
    const definition = GITLAB_OPERATIONS[operation];
    const handler = GITLAB_HANDLERS[operation];
    if (definition === undefined || handler === undefined) {
      throw new IntegrationError(
        "InvalidRequest",
        "Unsupported GitLab operation",
      );
    }
    const flags = this.config.gitlab;
    const request = handler(input, {
      externalUserId: context.externalUserId,
      flags,
    });
    if (operation === "jobs.log") {
      return this.readJobLog(instance, credential, request, flags, input);
    }
    if (operation === "repository.file") {
      return this.readFile(instance, credential, request, flags, input);
    }
    const response = await this.transport.getJson<unknown>(
      instance,
      credential.token,
      request.path,
      request.query,
    );
    const projection = GITLAB_PROJECTIONS[operation];
    const data =
      projection === undefined
        ? response.data
        : projection(response.data, { flags, byteLimit: undefined });
    return definition.list === true
      ? envelope(data, response.page)
      : objectOf(data);
  }

  /**
   * A file read answers with metadata and content in one call. GitLab returns
   * the body base64-encoded inside that JSON, so a file bigger than the
   * transport cap cannot be parsed at all; the raw endpoint is then read
   * instead, which streams and lets us keep a bounded prefix plus a marker.
   */
  private async readFile(
    instance: GitlabInstance,
    credential: GitlabCredential,
    request: GitlabRequest,
    flags: GitlabFlags,
    input: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    const byteLimit = fileByteLimit(input["maxBytes"], flags);
    const fileProjection = GITLAB_PROJECTIONS["repository.file"];
    if (fileProjection !== undefined) {
      try {
        const response = await this.transport.getJson<unknown>(
          instance,
          credential.token,
          request.path,
          request.query,
        );
        return objectOf(fileProjection(response.data, { flags, byteLimit }));
      } catch (error) {
        if (
          !(error instanceof IntegrationError) ||
          error.code !== "ResultTooLarge"
        ) {
          throw error;
        }
      }
    }
    const raw = await this.transport.getText(
      instance,
      credential.token,
      `${request.path}/raw`,
      request.query,
      byteLimit,
    );
    const marker = "/repository/files/";
    const encoded = request.path.slice(
      request.path.indexOf(marker) + marker.length,
    );
    return {
      filePath: decodedPath(encoded),
      ref: request.query["ref"] ?? null,
      size: raw.bytes,
      binary: raw.binary,
      truncated: true,
      content: raw.binary ? null : raw.text,
    };
  }

  /**
   * A job log is a stream of text, not JSON. It is bounded and stripped of the
   * secrets a log can carry; GitLab's own masking is a filter, not a promise.
   */
  private async readJobLog(
    instance: GitlabInstance,
    credential: GitlabCredential,
    request: GitlabRequest,
    flags: GitlabFlags,
    input: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    const limit = jobLogByteLimit(input["maxBytes"], flags);
    const log = await this.transport.getText(
      instance,
      credential.token,
      request.path,
      request.query,
      limit,
    );
    return {
      // The handler already validated the id; the path carries `trace`, so the
      // answer names the job from the request instead of re-parsing the URL.
      jobId: String(input["jobId"] ?? ""),
      log: log.binary ? "" : String(redactSecrets(log.text) ?? ""),
      bytes: log.bytes,
      truncated: log.truncated,
    };
  }

  private resolveInstance(requested: string | undefined) {
    const flags = this.config.gitlab;
    const id = requested?.trim();
    if (id !== undefined && id !== "") {
      const instance = gitlabInstance(flags, id);
      if (instance === undefined) {
        throw new IntegrationError(
          "InvalidCredential",
          "Unknown GitLab instance",
        );
      }
      return instance;
    }
    const [only] = flags.instances;
    if (only === undefined) {
      throw new IntegrationError(
        "InvalidCredential",
        "No GitLab instance is configured",
      );
    }
    if (flags.instances.length > 1) {
      throw new IntegrationError(
        "InvalidCredential",
        "Choose a GitLab instance",
      );
    }
    return only;
  }

  /**
   * The scopes the connected token was actually granted, read from GitLab's
   * self-inspection endpoint. A token that cannot read itself only costs
   * precision: the deployment switches still bound what the agent may try.
   */
  private async grantedScopes(
    instance: GitlabInstance,
    token: string,
  ): Promise<readonly string[] | undefined> {
    try {
      const { data } = await this.transport.getJson<Record<string, unknown>>(
        instance,
        token,
        "/personal_access_tokens/self",
      );
      const expiresAt = data["expires_at"];
      if (
        typeof expiresAt === "string" &&
        !Number.isNaN(Date.parse(expiresAt)) &&
        Date.parse(expiresAt) <= Date.now()
      ) {
        throw new IntegrationError(
          "CredentialExpired",
          "GitLab token has expired",
        );
      }
      const scopes = data["scopes"];
      if (!Array.isArray(scopes)) return undefined;
      return scopes.filter((item): item is string => typeof item === "string");
    } catch (error) {
      if (
        error instanceof IntegrationError &&
        error.code === "CredentialExpired"
      ) {
        throw error;
      }
      return undefined;
    }
  }
}

function intersectScopes(
  allowed: readonly IntegrationCapability[],
  scopes: readonly string[],
): readonly GitlabCapability[] {
  const granted = new Set<string>(capabilitiesForScopes(scopes));
  return allowed.filter(
    (capability): capability is GitlabCapability =>
      granted.has(capability) &&
      GITLAB_CAPABILITIES.some((item) => item.capability === capability),
  );
}

export default GitlabProvider;
