import {
  resolveCredentialHelp,
  type CredentialHelp,
} from "@yadsh/dsh-plugin-kit";
import type { ResolvedQaIntegrationsConfig } from "../../config.js";
import { requiredInteger, requiredText } from "../../coerce.js";
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
  serviceResourceDenied,
} from "../shared/service-boundary.js";
import {
  artifactBinaryProblem,
  artifactByteLimit,
  textArtifact,
} from "./artifacts.js";
import {
  TEAMCITY_CAPABILITY_INFO,
  TEAMCITY_INSTANCE_ID,
  TEAMCITY_OPERATIONS,
  TEAMCITY_RESOURCE_KIND,
  enabledCapabilities,
  teamcityOperationCapability,
  teamcityOperationMetadata,
} from "./catalog.js";
import type { TeamCityFlags } from "./config.js";
import {
  logLines,
  logMode,
  sanitizeLog,
  selectLogWindow,
  trimToBytes,
} from "./logs.js";
import {
  TEAMCITY_HANDLERS,
  TEAMCITY_PROJECTIONS,
  currentUserRequest,
  problemsRequest,
  serverRequest,
  testsRequest,
  type TeamCityProjectionContext,
  type TeamCityRequest,
} from "./operations.js";
import { TEAMCITY_CREDENTIAL_HELP } from "./credential-help.js";
import {
  TeamCityTransport,
  configuredServer,
  credentialFromPlaintext,
  type TeamCityCredential,
} from "./transport.js";

export {
  configuredServer,
  credentialFromPlaintext,
  type TeamCityCredential,
} from "./transport.js";

/**
 * A TeamCity access token is opaque: the server documents no shape, so the only
 * checks worth making are the ones that catch a paste mistake — a URL instead of
 * a token, or whitespace that a copy carried along.
 */
const TOKEN_SHAPE = /^\S{16,4096}$/u;
const URL_LIKE = /^https?:\/\//iu;

/** Operations addressed by a build id, which has to be resolved to a project. */
const BUILD_ADDRESSED: readonly string[] = Object.freeze([
  "builds.get",
  "builds.changes",
  "failures.get",
  "artifacts.list",
]);

/** Operations whose locator names a project or a build configuration. */
const PROJECT_LOCATED: readonly string[] = Object.freeze([
  "buildConfigs.list",
  "builds.list",
  "queue.list",
  "investigations.list",
]);

/** How many fields a bounded project listing asks TeamCity for. */
const PROJECT_FIELDS = "id,name,parentProjectId,description,archived,webUrl";

/**
 * Whether one caller-named TeamCity project stays inside the boundary. A listed
 * project covers its own subprojects, because that is what the identifier means
 * upstream; an ancestor of a listed project is not covered, because asking for
 * it would return the siblings nobody listed.
 */
export function projectAllowed(
  boundary: ServiceResourceBoundary,
  ref: string,
): boolean {
  if (boundaryHas(boundary, TEAMCITY_RESOURCE_KIND, ref)) return true;
  return (boundary[TEAMCITY_RESOURCE_KIND] ?? []).some(
    (entry) => entry !== "" && ref.startsWith(`${entry}.`),
  );
}

/**
 * Whether one build configuration stays inside the boundary: it is either
 * listed itself, or it hangs off a listed project. TeamCity names a build
 * configuration `<projectId>_<configId>`, which is the prefix a listed project
 * matches on; the authoritative `projectId` from the API is preferred wherever
 * the call already fetches it.
 */
export function buildTypeAllowed(
  boundary: ServiceResourceBoundary,
  ref: string,
  projectId?: string | undefined,
): boolean {
  if (boundaryHas(boundary, TEAMCITY_RESOURCE_KIND, ref)) return true;
  if (projectId !== undefined && projectAllowed(boundary, projectId)) {
    return true;
  }
  return (boundary[TEAMCITY_RESOURCE_KIND] ?? []).some(
    (entry) => entry !== "" && ref.startsWith(`${entry}_`),
  );
}

/**
 * TeamCity provider: one TeamCity server per QA user, connected with that user's
 * own personal access token, or with the deployment's managed read-only
 * credential when the user's binding asks for it.
 *
 * The server address is user input, so it is checked against the deployment's
 * address policy when the connection is stored and again on every call, and the
 * token is never part of a URL, a tool argument or a log line.
 */
export class TeamcityProvider implements IntegrationProvider {
  readonly id = "teamcity";
  readonly displayName = "TeamCity";
  /** What this deployment is willing to expose; TeamCity's own rights still apply. */
  readonly capabilities: readonly IntegrationCapability[];
  readonly capabilityInfo: Readonly<
    Record<IntegrationCapability, IntegrationCapabilityInfo>
  > = TEAMCITY_CAPABILITY_INFO;
  /** Where the settings card says this provider's credential comes from. */
  readonly credentialHelp: CredentialHelp | null;
  /** Overrides the deployment got wrong; reported once at startup, never fatal. */
  readonly credentialHelpProblems: readonly string[];

  private readonly transport: TeamCityTransport;

  constructor(
    private readonly config: ResolvedQaIntegrationsConfig,
    fetcher: typeof fetch = fetch,
  ) {
    this.transport = new TeamCityTransport(config, config.teamcity, fetcher);
    this.capabilities = Object.freeze(enabledCapabilities(config.teamcity));
    const help = resolveCredentialHelp(
      TEAMCITY_CREDENTIAL_HELP,
      config.credentialHelp["teamcity"],
    );
    this.credentialHelp = help.help;
    this.credentialHelpProblems = help.problems;
  }

  /**
   * Keep the pasted token. The server it will be dialled at is this
   * deployment's configuration — never a connect-form field and never a tool
   * argument — so a token minted for another TeamCity fails against the address
   * the operator set instead of pointing the broker at a host the caller chose.
   * A deployment with no address configured refuses here, so the connect form
   * cannot store a credential that could never be used.
   */
  parseCredential(raw: string): {
    readonly credential: string;
    readonly portal: string;
  } {
    const token = raw.trim();
    if (!TOKEN_SHAPE.test(token) || URL_LIKE.test(token)) {
      throw new IntegrationError(
        "InvalidCredential",
        "Use a TeamCity access token",
      );
    }
    const serverUrl = this.config.teamcity.serverUrl;
    if (serverUrl === "") {
      throw new IntegrationError(
        "ProviderUnavailable",
        "This deployment has no TeamCity address configured",
      );
    }
    return {
      credential: JSON.stringify({ token } satisfies TeamCityCredential),
      portal: serverUrl,
    };
  }

  operationCapability(operation: string): IntegrationCapability | undefined {
    return teamcityOperationCapability(operation);
  }

  operationMetadata(operation: string): OperationSecurityMetadata | undefined {
    return teamcityOperationMetadata(operation);
  }

  resourceBoundaryKind(operation: string): string | undefined {
    return TEAMCITY_OPERATIONS[operation]?.security.requiresResourceBoundary ===
      true
      ? TEAMCITY_RESOURCE_KIND
      : undefined;
  }

  capabilityServiceState(
    capability: IntegrationCapability,
  ): CapabilityServiceState | undefined {
    return operationCapabilityServiceState(TEAMCITY_OPERATIONS, capability);
  }

  /** An empty id means this deployment's single server, as in `parseCredential`. */
  instancePortal(instanceId: string): string | undefined {
    const requested = instanceId.trim();
    if (requested !== "" && requested !== TEAMCITY_INSTANCE_ID)
      return undefined;
    if (this.config.teamcity.serverUrl === "") return undefined;
    try {
      return configuredServer(this.config.teamcity);
    } catch {
      // An address the policy refuses cannot be the portal of a credential:
      // nothing could be dialled there anyway.
      return undefined;
    }
  }

  async validate(context: ProviderContext): Promise<ProviderValidation> {
    const credential = credentialFromPlaintext(context.credential);
    const baseUrl = configuredServer(this.config.teamcity);
    const server = await this.transport.getJson<Record<string, unknown>>(
      baseUrl,
      credential.token,
      serverRequest().path,
      serverRequest().query,
    );
    const user = await this.transport.getJson<Record<string, unknown>>(
      baseUrl,
      credential.token,
      currentUserRequest().path,
      currentUserRequest().query,
    );
    const id = user["id"];
    if (typeof id !== "number") {
      throw new IntegrationError(
        "ProviderUnavailable",
        "TeamCity identity is unavailable",
      );
    }
    const version =
      typeof server["version"] === "string" ? server["version"].trim() : "";
    return {
      tenantId: baseUrl,
      externalUserId: String(id),
      displayName:
        version === ""
          ? accountName(user, "TeamCity")
          : `${accountName(user, "TeamCity")} · TeamCity ${version}`,
      /**
       * TeamCity does not report the restrictions of the token it was given, so
       * there is nothing to narrow here: the deployment switches bound what this
       * connection may attempt, and TeamCity itself refuses the rest.
       */
      capabilities: this.capabilities,
    };
  }

  /**
   * Health of the deployment's managed token. TeamCity exposes no way to read a
   * token's roles, so the probe answers what it can — whether the token is
   * accepted and which identity it carries — and says so instead of implying a
   * permission audit it did not perform.
   */
  async validateServiceCredential(
    context: ProviderContext,
  ): Promise<ServiceCredentialHealth> {
    const credential = credentialFromPlaintext(context.credential);
    let baseUrl: string;
    try {
      baseUrl = configuredServer(this.config.teamcity);
    } catch {
      return { status: "unreachable" };
    }
    try {
      const user = await this.transport.getJson<Record<string, unknown>>(
        baseUrl,
        credential.token,
        currentUserRequest().path,
        currentUserRequest().query,
      );
      const id = user["id"];
      const identity =
        typeof id === "number"
          ? { id: String(id), label: accountName(user, "TeamCity") }
          : undefined;
      return {
        status: "healthy",
        ...(identity === undefined ? {} : { upstreamIdentity: identity }),
        warnings: [
          "TeamCity does not report the roles of an access token; only the read-only service ceiling bounds what this credential can do here",
        ],
      };
    } catch (error) {
      return healthFromFailure(error);
    }
  }

  async execute(
    context: ProviderContext,
    operation: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const credential = credentialFromPlaintext(context.credential);
    const baseUrl = configuredServer(this.config.teamcity);
    const definition = TEAMCITY_OPERATIONS[operation];
    const handler = TEAMCITY_HANDLERS[operation];
    if (definition === undefined || handler === undefined) {
      throw new IntegrationError(
        "InvalidRequest",
        "Unsupported TeamCity operation",
      );
    }
    const flags = this.config.teamcity;
    // Ceiling first, then the boundary: what the operation is decides before
    // where it may read.
    if (context.credentialSource === "service") {
      assertServiceOperationAllowed(
        definition.security,
        "This TeamCity operation is not available through the service credential",
      );
    }
    const boundary = serviceBoundaryOf(context);
    if (boundary !== undefined) {
      await this.assertInsideBoundary(
        operation,
        input,
        boundary,
        baseUrl,
        credential,
      );
      if (operation === "projects.list") {
        return this.listBoundedProjects(baseUrl, credential, boundary, input);
      }
    }
    const operationContext = {
      externalUserId: context.externalUserId,
      flags,
    };
    if (operation === "connection.get") {
      return this.readConnection(baseUrl, credential, input, flags);
    }
    if (operation === "failures.get") {
      return this.readFailures(baseUrl, credential, input, flags);
    }
    if (operation === "builds.log") {
      return this.readLog(baseUrl, credential, input, flags);
    }
    if (operation === "artifacts.text") {
      return this.readArtifact(baseUrl, credential, input, flags);
    }
    const request = handler(input, operationContext);
    const data = await this.transport.getJson<unknown>(
      baseUrl,
      credential.token,
      request.path,
      request.query,
      request.root ?? "rest",
    );
    return this.project(operation, data, input, request, baseUrl);
  }

  /**
   * Hold one call inside the deployment's boundary. Every service-safe TeamCity
   * operation either names a project, a build configuration or a build — and a
   * build is resolved to its project upstream, so a direct read by build id
   * passes the same policy a listing does.
   */
  private async assertInsideBoundary(
    operation: string,
    input: Readonly<Record<string, unknown>>,
    boundary: ServiceResourceBoundary,
    baseUrl: string,
    credential: TeamCityCredential,
  ): Promise<void> {
    if (operation === "connection.get" || operation === "agents.list") {
      return;
    }
    if (operation === "investigations.list" && input["assignee"] === "me") {
      // `assignee=me` resolves to the connected user, and the connected user is
      // the service account, which has no investigations of its own.
      throw new IntegrationError(
        "InvalidRequest",
        "assignee=me is not available through the service credential",
      );
    }
    if (operation === "projects.list") {
      const parent = input["parentProjectId"];
      if (parent !== undefined && !projectAllowed(boundary, String(parent))) {
        throw serviceResourceDenied();
      }
      return;
    }
    if (BUILD_ADDRESSED.includes(operation)) {
      const buildId = requiredInteger(input["buildId"], "buildId");
      await this.assertBuildInBoundary(buildId, boundary, baseUrl, credential);
      return;
    }
    if (PROJECT_LOCATED.includes(operation)) {
      // The build-configuration listing takes a project locator only: a build
      // type it cannot narrow by must not stand in for one.
      if (operation !== "buildConfigs.list") {
        const buildType = input["buildTypeId"];
        if (buildType !== undefined) {
          if (!buildTypeAllowed(boundary, String(buildType))) {
            throw serviceResourceDenied();
          }
          return;
        }
      }
      const project = input["projectId"];
      if (project !== undefined && projectAllowed(boundary, String(project))) {
        return;
      }
      // An unscoped listing would answer with the shared account's whole view,
      // which is exactly what the boundary exists to prevent.
      throw serviceResourceDenied();
    }
    throw serviceResourceDenied();
  }

  /** Resolve a build id to the project it belongs to, then check the boundary. */
  private async assertBuildInBoundary(
    buildId: number,
    boundary: ServiceResourceBoundary,
    baseUrl: string,
    credential: TeamCityCredential,
  ): Promise<void> {
    const data = await this.transport.getJson<Record<string, unknown>>(
      baseUrl,
      credential.token,
      `/builds/id:${buildId}`,
      { fields: "buildType(id,projectId)" },
    );
    const buildType = objectOf(data["buildType"]);
    const ref = String(buildType["id"] ?? data["buildTypeId"] ?? "");
    const projectId =
      typeof buildType["projectId"] === "string"
        ? buildType["projectId"]
        : undefined;
    if (ref === "" || !buildTypeAllowed(boundary, ref, projectId)) {
      throw serviceResourceDenied();
    }
  }

  /**
   * The bounded project listing: a service profile names the projects it covers,
   * so the answer is fetched from that list rather than from whatever the shared
   * account can reach. A project the service token cannot see is reported as
   * unavailable, which is what tells the operator their boundary and their token
   * disagree.
   */
  private async listBoundedProjects(
    baseUrl: string,
    credential: TeamCityCredential,
    boundary: ServiceResourceBoundary,
    input: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    const entries = boundary[TEAMCITY_RESOURCE_KIND] ?? [];
    const parent = input["parentProjectId"];
    const collected: unknown[] = [];
    const unavailable: string[] = [];
    for (const entry of entries) {
      try {
        const data = await this.transport.getJson<unknown>(
          baseUrl,
          credential.token,
          `/projects/id:${encodeURIComponent(entry)}`,
          { fields: PROJECT_FIELDS },
        );
        collected.push(data);
      } catch (error) {
        if (!recoverableResource(error)) throw error;
        unavailable.push(entry);
      }
    }
    const request: TeamCityRequest = {
      path: "/projects",
      query: { fields: PROJECT_FIELDS },
    };
    const projected = objectOf(
      this.project(
        "projects.list",
        { project: collected },
        input,
        request,
        baseUrl,
      ),
    );
    const items = Array.isArray(projected["items"]) ? projected["items"] : [];
    const visible =
      parent === undefined
        ? items
        : items.filter(
            (item) =>
              String(
                (item as Record<string, unknown> | null)?.["parentProjectId"] ??
                  "",
              ) === String(parent),
          );
    return {
      ...projected,
      items: visible,
      serviceScoped: true,
      ...(unavailable.length === 0
        ? {}
        : { unavailableResources: unavailable }),
    };
  }

  /** Server identity: one answer out of the two documented discovery calls. */
  private async readConnection(
    baseUrl: string,
    credential: TeamCityCredential,
    input: Readonly<Record<string, unknown>>,
    flags: TeamCityFlags,
  ): Promise<Record<string, unknown>> {
    const server = serverRequest();
    const user = currentUserRequest();
    const [serverData, userData] = await Promise.all([
      this.transport.getJson<unknown>(
        baseUrl,
        credential.token,
        server.path,
        server.query,
      ),
      this.transport.getJson<unknown>(
        baseUrl,
        credential.token,
        user.path,
        user.query,
      ),
    ]);
    const projection = TEAMCITY_PROJECTIONS["connection.get"];
    return objectOf(
      projection?.(
        { server: serverData, user: userData },
        {
          flags,
          input,
          serverUrl: baseUrl,
        },
      ),
    );
  }

  /**
   * Failed tests and build problems in one answer: "why did it fail" is one
   * question, and making the model stitch two low-level calls together only
   * invites it to report half of the reason.
   */
  private async readFailures(
    baseUrl: string,
    credential: TeamCityCredential,
    input: Readonly<Record<string, unknown>>,
    flags: TeamCityFlags,
  ): Promise<Record<string, unknown>> {
    const buildId = requiredInteger(input["buildId"], "buildId");
    const withTests = input["includeTests"] !== false;
    const withProblems = input["includeProblems"] !== false;
    const tests = withTests
      ? await this.read(baseUrl, credential, testsRequest(buildId))
      : {};
    const problems = withProblems
      ? await this.read(baseUrl, credential, problemsRequest(buildId))
      : {};
    const projection = TEAMCITY_PROJECTIONS["failures.get"];
    return objectOf(
      projection?.({ buildId, tests, problems }, { flags, input }),
    );
  }

  /**
   * A build log is a stream of external text. It is downloaded up to the
   * deployment's byte budget, stripped of terminal control sequences and secret
   * shapes, and cut to the lines the caller asked for: a multi-megabyte log
   * never reaches the model context.
   */
  private async readLog(
    baseUrl: string,
    credential: TeamCityCredential,
    input: Readonly<Record<string, unknown>>,
    flags: TeamCityFlags,
  ): Promise<Record<string, unknown>> {
    const buildId = requiredInteger(input["buildId"], "buildId");
    const mode = logMode(input["mode"]);
    const maxLines = logLines(input["maxLines"], flags.maxLogLines);
    const query =
      input["query"] === undefined
        ? undefined
        : requiredText(input["query"], "query", 1, 200);
    const request = TEAMCITY_HANDLERS["builds.log"]?.({ buildId }, { flags });
    if (request === undefined) {
      throw new IntegrationError("InvalidRequest", "Unsupported log operation");
    }
    const download = await this.transport.getText(
      baseUrl,
      credential.token,
      request.path,
      request.query,
      request.root ?? "server",
      flags.maxLogBytes,
    );
    const text = sanitizeLog(download.binary ? "" : download.text);
    const window = selectLogWindow(text, mode, maxLines, query);
    const redacted = String(redactSecrets(window.text) ?? "");
    const trimmed = trimToBytes(redacted, flags.maxLogBytes);
    return {
      buildId,
      mode,
      text: trimmed.text,
      returnedLines: window.returnedLines,
      ...(window.matched === undefined ? {} : { matched: window.matched }),
      downloadedBytes: download.bytes,
      // The download itself was cut short, so in `tail` mode this is the end of
      // what was downloaded, not the end of the build.
      logTruncated: download.truncated || download.binary,
      truncated: window.truncated || trimmed.truncated,
    };
  }

  /**
   * One text artifact. Archives, images, binaries and key material are refused
   * by name before a byte is requested, the rest is bounded, and the terminal
   * text is redacted like any other external content.
   */
  private async readArtifact(
    baseUrl: string,
    credential: TeamCityCredential,
    input: Readonly<Record<string, unknown>>,
    flags: TeamCityFlags,
  ): Promise<Record<string, unknown>> {
    const handler = TEAMCITY_HANDLERS["artifacts.text"];
    if (handler === undefined) {
      throw new IntegrationError("InvalidRequest", "Unsupported artifact read");
    }
    const request = handler(input, { flags });
    const path = request.artifactPath ?? "";
    const problem = artifactBinaryProblem(path);
    if (problem !== undefined) {
      throw new IntegrationError("InvalidRequest", problem);
    }
    const limit = artifactByteLimit(input["maxBytes"], flags);
    const body = await this.transport.getText(
      baseUrl,
      credential.token,
      request.path,
      request.query,
      "rest",
      limit,
    );
    const answer = textArtifact(path, body.bytes, limit, {
      text: String(redactSecrets(body.text) ?? ""),
      binary: body.binary,
      truncated: body.truncated,
    });
    return {
      buildId: requiredInteger(input["buildId"], "buildId"),
      ...answer,
    };
  }

  private read(
    baseUrl: string,
    credential: TeamCityCredential,
    request: TeamCityRequest,
  ): Promise<unknown> {
    return this.transport.getJson<unknown>(
      baseUrl,
      credential.token,
      request.path,
      request.query,
      request.root ?? "rest",
    );
  }

  private project(
    operation: string,
    data: unknown,
    input: Readonly<Record<string, unknown>>,
    request: TeamCityRequest,
    serverUrl: string,
  ): Record<string, unknown> {
    const projection = TEAMCITY_PROJECTIONS[operation];
    const context: TeamCityProjectionContext = {
      flags: this.config.teamcity,
      input,
      serverUrl,
      artifactPath: request.artifactPath,
    };
    return objectOf(
      projection === undefined ? data : projection(data, context),
    );
  }
}

/** A missing or forbidden project inside a boundary is reported, not fatal. */
function recoverableResource(error: unknown): boolean {
  return (
    error instanceof IntegrationError &&
    (error.code === "ResourceNotFound" ||
      error.code === "ProviderPermissionDenied")
  );
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

export default TeamcityProvider;
