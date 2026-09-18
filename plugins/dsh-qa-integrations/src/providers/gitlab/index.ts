import {
  resolveCredentialHelp,
  type CredentialHelp,
} from "@yadsh/dsh-plugin-kit";
import type { ResolvedQaIntegrationsConfig } from "../../config.js";
import { IntegrationError } from "../../errors.js";
import { redactSecrets } from "../../redaction.js";
import { boundaryHas } from "../../service-credentials/policy.js";
import { operationCapabilityServiceState } from "../../service-credentials/state.js";
import type {
  OperationSecurityMetadata,
  ServiceCredentialHealth,
  ServiceResourceBoundary,
} from "../../service-credentials/types.js";
import type {
  CapabilityServiceState,
  IntegrationCapability,
  IntegrationCapabilityInfo,
  ProviderValidation,
} from "../../types.js";
import type { IntegrationProvider, ProviderContext } from "../contract.js";
import { accountName, objectOf } from "../shared/account.js";
import {
  assertServiceOperationAllowed,
  serviceBoundaryOf,
} from "../shared/service-boundary.js";
import {
  GITLAB_CAPABILITIES,
  GITLAB_CAPABILITY_INFO,
  GITLAB_OPERATIONS,
  GITLAB_RESOURCE_KIND,
  capabilitiesForScopes,
  enabledCapabilities,
  gitlabOperationCapability,
  gitlabOperationMetadata,
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
  type GitlabProjectionContext,
  type GitlabRequest,
} from "./operations.js";
import { GITLAB_CREDENTIAL_HELP } from "./credential-help.js";
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
 * whitespace is refused before anything is sent upstream. The same shape is
 * expected of a deployment-managed service token, which is a PAT too.
 */
const TOKEN_SHAPE = /^[A-Za-z0-9_.-]{20,255}$/u;

/**
 * GitLab scopes that make a managed credential wider than the read-only role
 * the architecture requires. Reported, never exercised: probing for write
 * permission by writing is exactly what a probe must not do.
 */
const MUTABLE_SCOPES: readonly string[] = Object.freeze([
  "api",
  "write_repository",
  "write_api",
  "admin_mode",
  "sudo",
  "create_runner",
  "k8s_proxy",
  "ai_features",
]);

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

/** Operations that read one issue, and so may hit a confidential one. */
const ISSUE_READS: readonly string[] = Object.freeze([
  "issues.get",
  "issues.notes",
]);

/** Case- and separator-insensitive comparison of a resource path. */
function pathKey(value: string): string {
  return value.trim().replace(/^\/+/u, "").replace(/\/+$/u, "").toLowerCase();
}

function isNumericRef(value: string): boolean {
  return /^\d+$/u.test(value);
}

/**
 * Whether one caller-named project stays inside the deployment's boundary. A
 * numeric reference is matched against the listed ids only: a group id cannot
 * be expanded into project ids without another call, so it never widens a
 * numeric read. A path reference matches an exact entry or sits under a listed
 * group, which is how the same rule covers `group/subgroup/project`.
 */
export function projectAllowed(
  boundary: ServiceResourceBoundary,
  ref: string,
): boolean {
  if (boundaryHas(boundary, GITLAB_RESOURCE_KIND, ref)) return true;
  if (isNumericRef(ref)) return false;
  const key = pathKey(ref);
  const projects = boundary[GITLAB_RESOURCE_KIND] ?? [];
  if (projects.some((entry) => pathKey(entry) === key)) return true;
  const groups = boundary.groups ?? [];
  return groups.some((entry) => {
    const group = pathKey(entry);
    return group !== "" && (key === group || key.startsWith(`${group}/`));
  });
}

/** Whether a caller-named group stays inside the boundary. */
export function groupAllowed(
  boundary: ServiceResourceBoundary,
  ref: string,
): boolean {
  if (boundaryHas(boundary, "groups", ref)) return true;
  if (isNumericRef(ref)) return false;
  const key = pathKey(ref);
  return (boundary.groups ?? []).some((entry) => pathKey(entry) === key);
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
  /** Where the settings card says this provider's credential comes from. */
  readonly credentialHelp: CredentialHelp | null;
  /** Overrides the deployment got wrong; reported once at startup, never fatal. */
  readonly credentialHelpProblems: readonly string[];

  private readonly transport: GitlabTransport;

  constructor(
    private readonly config: ResolvedQaIntegrationsConfig,
    fetcher: typeof fetch = fetch,
  ) {
    this.transport = new GitlabTransport(config, config.gitlab, fetcher);
    this.capabilities = Object.freeze(enabledCapabilities(config.gitlab));
    const help = resolveCredentialHelp(
      GITLAB_CREDENTIAL_HELP,
      config.credentialHelp["gitlab"],
    );
    this.credentialHelp = help.help;
    this.credentialHelpProblems = help.problems;
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

  operationMetadata(operation: string): OperationSecurityMetadata | undefined {
    return gitlabOperationMetadata(operation);
  }

  /** Every project-scoped read may name a project id or a path under a group. */
  resourceBoundaryKind(operation: string): string | undefined {
    return GITLAB_OPERATIONS[operation]?.security.requiresResourceBoundary ===
      true
      ? GITLAB_RESOURCE_KIND
      : undefined;
  }

  /**
   * Portal of a configured instance. An empty id means "the only instance", the
   * same rule `parseCredential` applies, so deployment configuration and the
   * connect form name instances alike.
   */
  instancePortal(instanceId: string): string | undefined {
    const instances = this.config.gitlab.instances;
    const id = instanceId.trim();
    if (id === "") {
      return instances.length === 1 ? instances[0]?.baseUrl : undefined;
    }
    return gitlabInstance(this.config.gitlab, id)?.baseUrl;
  }

  capabilityServiceState(
    capability: IntegrationCapability,
  ): CapabilityServiceState | undefined {
    return operationCapabilityServiceState(GITLAB_OPERATIONS, capability);
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
      displayName: accountName(data, "GitLab"),
      capabilities:
        scopes === undefined ? allowed : intersectScopes(allowed, scopes),
    };
  }

  /**
   * Health of a deployment-managed token. The probe reads only the two
   * self-inspection endpoints, so it never changes upstream state; a token that
   * reaches beyond read-only scopes is reported as `unsafe_scope` and still
   * bounded locally by the service ceiling.
   */
  async validateServiceCredential(
    context: ProviderContext,
  ): Promise<ServiceCredentialHealth> {
    const credential = credentialFromPlaintext(context.credential);
    const instance = credentialInstance(this.config.gitlab, credential);
    let data: Record<string, unknown>;
    try {
      const response = await this.transport.getJson<Record<string, unknown>>(
        instance,
        credential.token,
        "/user",
      );
      data = response.data;
    } catch (error) {
      return healthFromFailure(error);
    }
    const identity = safeIdentity(data);
    const scopes = await this.grantedScopes(instance, credential.token);
    if (scopes === undefined) {
      return {
        status: "healthy",
        ...(identity === undefined ? {} : { upstreamIdentity: identity }),
        warnings: [
          "GitLab did not report the token scopes; the local service ceiling still applies",
        ],
      };
    }
    const mutable = scopes.filter((scope) => MUTABLE_SCOPES.includes(scope));
    if (mutable.length > 0) {
      return {
        status: "unsafe_scope",
        ...(identity === undefined ? {} : { upstreamIdentity: identity }),
        grantedScopes: scopes,
        warnings: [
          `The service token carries scopes wider than read-only: ${mutable.join(", ")}`,
        ],
      };
    }
    return {
      status: "healthy",
      ...(identity === undefined ? {} : { upstreamIdentity: identity }),
      grantedScopes: scopes,
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
    // Ceiling first, then the boundary: what the operation is decides before
    // where it may read.
    if (context.credentialSource === "service") {
      assertServiceOperationAllowed(
        definition.security,
        "This GitLab operation is not available through the service credential",
      );
    }
    const boundary = serviceBoundaryOf(context);
    if (
      boundary !== undefined &&
      definition.security.requiresResourceBoundary
    ) {
      this.assertInsideBoundary(operation, input, boundary);
    }
    if (boundary !== undefined && operation === "search.run") {
      // A note is searched without its parent ever being named, so a shared
      // account cannot prove the issue behind it is not confidential: that
      // search stays personal. An issue search can be checked, and is.
      if (String(input["scope"] ?? "") === "notes") {
        throw new IntegrationError(
          "SensitiveReadRequiresPersonalCredential",
          "Searching notes is not available through the service credential",
        );
      }
    }
    const flags = this.config.gitlab;
    const request = handler(input, {
      externalUserId: context.externalUserId,
      flags,
    });
    if (boundary !== undefined && operation === "projects.list") {
      return this.listBoundedProjects(instance, credential, boundary, input);
    }
    if (operation === "jobs.log") {
      return this.readJobLog(instance, credential, request, flags, input);
    }
    if (operation === "repository.file") {
      return this.readFile(instance, credential, request, flags, input);
    }
    if (boundary !== undefined && ISSUE_READS.includes(operation)) {
      // A confidential issue is invisible to the shared account's users: the
      // service identity may be allowed to see it upstream, so the check is
      // made here, before anything about it is returned.
      await this.assertIssueNotConfidential(instance, credential, request);
    }
    const response = await this.transport.getJson<unknown>(
      instance,
      credential.token,
      request.path,
      request.query,
    );
    const projection = GITLAB_PROJECTIONS[operation];
    const raw =
      boundary !== undefined &&
      (operation === "issues.list" || operation === "search.run")
        ? withoutConfidential(response.data)
        : response.data;
    const data =
      projection === undefined
        ? raw
        : projection(raw, {
            flags,
            byteLimit: undefined,
          } satisfies GitlabProjectionContext);
    // A search projects one item shape for every scope, so the confidential
    // check belongs on the raw hits, before the flag is projected away.
    const visible = data;
    return definition.list === true
      ? envelope(visible, response.page)
      : objectOf(visible);
  }

  /**
   * Hold one call inside the deployment's boundary. Every service-safe
   * operation of this provider reads one project (or one group), so the check is
   * the same for all of them: name a resource that is inside the boundary, or
   * nothing is read. A listing that names none is refused rather than answered
   * with the service account's whole upstream view.
   */
  private assertInsideBoundary(
    operation: string,
    input: Readonly<Record<string, unknown>>,
    boundary: ServiceResourceBoundary,
  ): void {
    if (operation === "projects.list") return;
    const project = input["project"];
    if (operation === "search.run" && project === undefined) {
      const group = input["group"];
      if (group !== undefined && groupAllowed(boundary, String(group).trim())) {
        return;
      }
    }
    const ref = project === undefined ? "" : String(project).trim();
    if (ref === "" || !projectAllowed(boundary, ref)) {
      throw new IntegrationError(
        "ServiceResourceNotAllowed",
        "Service mode reads only the projects this workspace is allowed to see",
      );
    }
  }

  /**
   * The bounded project listing. A service profile names the projects (and
   * groups) it covers, so the listing is built from that list instead of from
   * whatever the shared account can reach; a project the service token cannot
   * see is reported as unavailable rather than silently dropped.
   */
  private async listBoundedProjects(
    instance: GitlabInstance,
    credential: GitlabCredential,
    boundary: ServiceResourceBoundary,
    input: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    const projects = boundary[GITLAB_RESOURCE_KIND] ?? [];
    const groups = boundary.groups ?? [];
    const collected: unknown[] = [];
    const unavailable: string[] = [];
    for (const ref of projects) {
      try {
        const { data } = await this.transport.getJson<unknown>(
          instance,
          credential.token,
          `/projects/${encodeURIComponent(ref)}`,
        );
        collected.push(data);
      } catch (error) {
        if (!recoverableResource(error)) throw error;
        unavailable.push(ref);
      }
    }
    for (const group of groups) {
      try {
        const { data } = await this.transport.getJson<unknown>(
          instance,
          credential.token,
          `/groups/${encodeURIComponent(group)}/projects`,
          // GitLab shares projects *into* a group by default, and a shared
          // project lives outside the boundary. `with_shared=false` asks for the
          // group's own projects; the filter below is what guarantees it.
          { per_page: "100", with_shared: "false" },
        );
        if (Array.isArray(data)) {
          collected.push(
            ...data.filter((item) => rawProjectAllowed(boundary, item)),
          );
        }
      } catch (error) {
        if (!recoverableResource(error)) throw error;
        unavailable.push(group);
      }
    }
    const projection = GITLAB_PROJECTIONS["projects.list"];
    const projected =
      projection === undefined
        ? collected
        : projection(collected, {
            flags: this.config.gitlab,
            byteLimit: undefined,
          } satisfies GitlabProjectionContext);
    const search =
      typeof input["search"] === "string" ? input["search"].toLowerCase() : "";
    const archived = input["archived"];
    const items = (Array.isArray(projected) ? projected : []).filter((item) => {
      const record = (item ?? {}) as Record<string, unknown>;
      if (search !== "") {
        const haystack =
          `${String(record["name"] ?? "")} ${String(record["path"] ?? "")}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      if (typeof archived === "boolean" && record["archived"] !== archived) {
        return false;
      }
      return true;
    });
    return {
      items,
      serviceScoped: true,
      ...(unavailable.length === 0
        ? {}
        : { unavailableResources: unavailable }),
    };
  }

  /** Fail closed on an issue the shared account must not expose. */
  private async assertIssueNotConfidential(
    instance: GitlabInstance,
    credential: GitlabCredential,
    request: GitlabRequest,
  ): Promise<void> {
    const marker = "/notes";
    const target = request.path.endsWith(marker)
      ? request.path.slice(0, -marker.length)
      : request.path;
    const { data } = await this.transport.getJson<unknown>(
      instance,
      credential.token,
      target,
      {},
    );
    if (isConfidential(data)) {
      throw new IntegrationError(
        "ResourceNotFound",
        "Resource is not available through the service credential",
      );
    }
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

/** One project as the API returned it, without trusting its projection. */
function rawProjectAllowed(
  boundary: ServiceResourceBoundary,
  item: unknown,
): boolean {
  if (typeof item !== "object" || item === null) return false;
  const source = item as Record<string, unknown>;
  const id = source["id"];
  const byId =
    (typeof id === "number" && projectAllowed(boundary, String(id))) ||
    (typeof id === "string" && projectAllowed(boundary, id));
  if (byId) return true;
  const path = source["path_with_namespace"];
  return typeof path === "string" && projectAllowed(boundary, path);
}

function isConfidential(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)["confidential"] === true
  );
}

/** Drop confidential issues from a projected listing rather than naming them. */
function withoutConfidential(data: unknown): unknown {
  if (!Array.isArray(data)) return data;
  return data.filter((item) => !isConfidential(item));
}

/** A missing project inside a boundary is reported, not fatal to the listing. */
function recoverableResource(error: unknown): boolean {
  return (
    error instanceof IntegrationError &&
    (error.code === "ResourceNotFound" ||
      error.code === "ProviderPermissionDenied")
  );
}

function safeIdentity(
  data: Record<string, unknown>,
): { readonly id: string; readonly label: string } | undefined {
  const id = data["id"];
  if (typeof id !== "number") return undefined;
  return { id: String(id), label: accountName(data, "GitLab") };
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
