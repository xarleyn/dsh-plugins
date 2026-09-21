import {
  resolveCredentialHelp,
  type CredentialHelp,
} from "@yadsh/dsh-plugin-kit";
import type { ResolvedQaIntegrationsConfig } from "../../config.js";
import { IntegrationError, recoverableResource } from "../../errors.js";
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
import { objectOf } from "../shared/account.js";
import { healthFromFailure } from "../shared/health.js";
import {
  assertServiceOperationAllowed,
  serviceBoundaryOf,
  serviceResourceDenied,
} from "../shared/service-boundary.js";
import {
  assertReadableSize,
  attachmentBinaryProblem,
  attachmentByteLimit,
  attachmentName,
} from "./attachments.js";
import {
  TESTIT_CAPABILITY_INFO,
  TESTIT_OPERATIONS,
  TESTIT_RESOURCE_KIND,
  enabledCapabilities,
  testitOperationCapability,
  testitOperationMetadata,
} from "./catalog.js";
import {
  testitInstance,
  type TestitFlags,
  type TestitInstance,
} from "./config.js";
import {
  TESTIT_HANDLERS,
  TESTIT_LIMITS,
  TESTIT_PROJECTIONS,
  contentBlock,
  listLimit,
  listOffset,
  type TestitRequest,
} from "./operations.js";
import { TESTIT_CREDENTIAL_HELP } from "./credential-help.js";
import {
  TestitTransport,
  credentialFromPlaintext,
  credentialInstance,
  type TestitCredential,
} from "./transport.js";

export {
  credentialFromPlaintext,
  credentialInstance,
  type TestitCredential,
} from "./transport.js";

/**
 * Test IT API tokens are opaque: the platform documents no shape, so the only
 * checks worth making are the ones that catch a paste mistake — a URL instead
 * of a token, or whitespace a copy carried along.
 */
const TOKEN_SHAPE = /^\S{16,4096}$/u;
const URL_LIKE = /^https?:\/\//iu;

/**
 * Whether one caller-named project stays inside the deployment's boundary.
 * Test IT addresses projects by their id and offers no hierarchy a boundary
 * entry could cover, so the match is the exact identifier the profile lists.
 */
export function projectAllowed(
  boundary: ServiceResourceBoundary,
  ref: string,
): boolean {
  return boundaryHas(boundary, TESTIT_RESOURCE_KIND, ref.trim());
}

/** Operations that answer exactly the project the call names. */
const PROJECT_ADDRESSED: readonly string[] = Object.freeze([
  "projects.get",
  "sections.list",
  "workItems.list",
  "testPlans.list",
  "testRuns.list",
  "configurations.list",
  // `autoTests.list` takes the project optionally upstream; service mode does
  // not, because unscoped it would answer with the shared account's whole
  // installation — exactly what the boundary exists to prevent.
  "autoTests.list",
]);

/**
 * Operations answered from one object that names its own project. The id alone
 * proves nothing, so the check runs on the fetched answer, before any of it is
 * returned.
 */
const SELF_SCOPED_READS: readonly string[] = Object.freeze([
  "workItems.get",
  "testPlans.get",
  "testRuns.get",
  "autoTests.get",
]);

/** The project an upstream object declares, when it declares one. */
function projectOf(source: Record<string, unknown>): string | undefined {
  const id = source["projectId"];
  return typeof id === "string" && id !== "" ? id : undefined;
}

/**
 * Test IT provider: one Test IT installation per QA user, connected with that
 * user's own API token, or with the deployment's managed read-only credential
 * when the user's binding asks for it.
 *
 * The installation is operator configuration — the connect form only picks from
 * the configured list — so the broker cannot be pointed at a host of the
 * caller's choosing, and the address is re-resolved from config on every call,
 * which makes removing or repointing an instance take effect at once.
 */
export class TestitProvider implements IntegrationProvider {
  readonly id = "testit";
  readonly displayName = "Test IT";
  /** What this deployment is willing to expose; Test IT's own rights still apply. */
  readonly capabilities: readonly IntegrationCapability[];
  readonly capabilityInfo: Readonly<
    Record<IntegrationCapability, IntegrationCapabilityInfo>
  > = TESTIT_CAPABILITY_INFO;
  /** Where the settings card says this provider's credential comes from. */
  readonly credentialHelp: CredentialHelp | null;
  /** Overrides the deployment got wrong; reported once at startup, never fatal. */
  readonly credentialHelpProblems: readonly string[];

  private readonly transport: TestitTransport;

  constructor(
    private readonly config: ResolvedQaIntegrationsConfig,
    fetcher: typeof fetch = fetch,
  ) {
    this.transport = new TestitTransport(config, config.testit, fetcher);
    this.capabilities = Object.freeze(enabledCapabilities(config.testit));
    const help = resolveCredentialHelp(
      TESTIT_CREDENTIAL_HELP,
      config.credentialHelp["testit"],
    );
    this.credentialHelp = help.help;
    this.credentialHelpProblems = help.problems;
  }

  /**
   * Keep only the token, tagged with the installation it was minted for. The
   * instance comes from the connect form and from operator config, never from a
   * tool argument, which is what keeps the broker from dialling any host the
   * caller names.
   */
  parseCredential(
    raw: string,
    options?: Readonly<Record<string, string>>,
  ): { readonly credential: string; readonly portal: string } {
    const token = raw.trim();
    if (!TOKEN_SHAPE.test(token) || URL_LIKE.test(token)) {
      throw new IntegrationError(
        "InvalidCredential",
        "Use a Test IT API token",
      );
    }
    const instance = this.resolveInstance(options?.["instanceId"]);
    return {
      credential: JSON.stringify({
        instanceId: instance.id,
        token,
      } satisfies TestitCredential),
      portal: instance.baseUrl,
    };
  }

  operationCapability(operation: string): IntegrationCapability | undefined {
    return testitOperationCapability(operation);
  }

  operationMetadata(operation: string): OperationSecurityMetadata | undefined {
    return testitOperationMetadata(operation);
  }

  /** Every project-scoped read is bounded by the profile's project list. */
  resourceBoundaryKind(operation: string): string | undefined {
    return TESTIT_OPERATIONS[operation]?.security.requiresResourceBoundary ===
      true
      ? TESTIT_RESOURCE_KIND
      : undefined;
  }

  /**
   * Portal of a configured installation. An empty id means "the only
   * installation", the same rule `parseCredential` applies, so deployment
   * configuration and the connect form name installations alike.
   */
  instancePortal(instanceId: string): string | undefined {
    const instances = this.config.testit.instances;
    const id = instanceId.trim();
    if (id === "") {
      return instances.length === 1 ? instances[0]?.baseUrl : undefined;
    }
    return testitInstance(this.config.testit, id)?.baseUrl;
  }

  capabilityServiceState(
    capability: IntegrationCapability,
  ): CapabilityServiceState | undefined {
    return operationCapabilityServiceState(TESTIT_OPERATIONS, capability);
  }

  /**
   * The documented first validation call is the project list: an authorized
   * answer proves the address and the token at once, and an empty project list
   * is a valid authorization result rather than a failure. Test IT API v2 has no
   * endpoint that names the token owner, so no identity is stored — the answer
   * reports what the probe proved and nothing more.
   */
  async validate(context: ProviderContext): Promise<ProviderValidation> {
    const credential = credentialFromPlaintext(context.credential);
    const instance = credentialInstance(this.config.testit, credential);
    const connection = TESTIT_HANDLERS["connection.get"];
    if (connection === undefined) {
      throw new IntegrationError(
        "ProviderUnavailable",
        "Test IT connection probe is unavailable",
      );
    }
    const probeRequest = connection({}, { flags: this.config.testit });
    const probe = await this.transport.getJson<unknown>(
      instance,
      credential.token,
      probeRequest.path,
      probeRequest.query,
    );
    const visible =
      probe.page?.total ?? (Array.isArray(probe.data) ? probe.data.length : 0);
    return {
      tenantId: instance.baseUrl,
      externalUserId: "",
      displayName: `${instance.label} · Test IT API v2, проектов видно: ${visible}`,
      /**
       * Test IT does not report the permissions of the token it was given, so
       * there is nothing to narrow here: the deployment switches bound what this
       * connection may attempt, and Test IT itself refuses the rest.
       */
      capabilities: this.capabilities,
    };
  }

  /**
   * Health of the deployment's managed token. Test IT reports neither the
   * scopes of a token nor its owner, so the probe is the same read the personal
   * validation makes — it never changes upstream state — and the answer says
   * what was and was not learned instead of implying an audit it did not
   * perform.
   */
  async validateServiceCredential(
    context: ProviderContext,
  ): Promise<ServiceCredentialHealth> {
    const credential = credentialFromPlaintext(context.credential);
    const instance = credentialInstance(this.config.testit, credential);
    try {
      const probe = TESTIT_HANDLERS["connection.get"];
      if (probe === undefined) {
        throw new IntegrationError(
          "ProviderUnavailable",
          "Test IT connection probe is unavailable",
        );
      }
      const probeRequest = probe({}, { flags: this.config.testit });
      await this.transport.getJson<unknown>(
        instance,
        credential.token,
        probeRequest.path,
        probeRequest.query,
      );
      return {
        status: "healthy",
        warnings: [
          "Test IT did not report the token scopes; the local service ceiling still applies",
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
    const instance = credentialInstance(this.config.testit, credential);
    const definition = TESTIT_OPERATIONS[operation];
    const handler = TESTIT_HANDLERS[operation];
    if (definition === undefined || handler === undefined) {
      throw new IntegrationError(
        "InvalidRequest",
        "Unsupported Test IT operation",
      );
    }
    // Ceiling first, then the boundary: what the operation is decides before
    // where it may read.
    if (context.credentialSource === "service") {
      assertServiceOperationAllowed(
        definition.security,
        "This Test IT operation is not available through the service credential",
      );
    }
    const boundary = serviceBoundaryOf(context);
    if (
      boundary !== undefined &&
      definition.security.requiresResourceBoundary
    ) {
      await this.assertInsideBoundary(
        operation,
        input,
        boundary,
        instance,
        credential,
      );
    }
    if (boundary !== undefined && operation === "projects.list") {
      return this.listBoundedProjects(instance, credential, boundary, input);
    }
    const flags = this.config.testit;
    const request = handler(input, { flags });
    if (definition.stream === true) {
      return this.readAttachment(instance, credential, input, request, flags);
    }
    const response = await this.transport.getJson<unknown>(
      instance,
      credential.token,
      request.path,
      request.query,
    );
    if (
      boundary !== undefined &&
      (SELF_SCOPED_READS.includes(operation) || operation === "testResults.get")
    ) {
      await this.assertAnswerInside(
        operation,
        response.data,
        boundary,
        instance,
        credential,
      );
    }
    const projection = TESTIT_PROJECTIONS[operation];
    if (projection === undefined) return objectOf(response.data);
    const projected = projection(response.data, {
      flags,
      input,
      page: response.page,
      instanceLabel: instance.label,
      baseUrl: instance.baseUrl,
    });
    // A list projection already answered with its envelope; a single-resource
    // answer is wrapped so every tool result has the same object shape.
    return definition.list === undefined ? objectOf(projected) : projected;
  }

  /**
   * Hold one call inside the deployment's boundary. A call addressed by a
   * project must name one the boundary lists; an id-addressed read resolves
   * the project its object lives in first, and only then is answered. The
   * project listing needs no check here: it is built from the allowlist
   * itself, not from whatever the shared account can reach.
   */
  private async assertInsideBoundary(
    operation: string,
    input: Readonly<Record<string, unknown>>,
    boundary: ServiceResourceBoundary,
    instance: TestitInstance,
    credential: TestitCredential,
  ): Promise<void> {
    if (operation === "projects.list") return;
    if (PROJECT_ADDRESSED.includes(operation)) {
      const project = input["projectId"];
      this.assertProject(
        boundary,
        project === undefined ? undefined : String(project).trim(),
      );
      return;
    }
    if (
      operation === "workItems.history" ||
      operation === "workItems.comments" ||
      operation === "workItems.testResults"
    ) {
      this.assertProject(
        boundary,
        await this.projectThrough(
          "workItems.get",
          { workItemId: input["workItemId"] },
          instance,
          credential,
        ),
      );
      return;
    }
    if (operation === "testPlans.summary") {
      this.assertProject(
        boundary,
        await this.projectThrough(
          "testPlans.get",
          { testPlanId: input["testPlanId"] },
          instance,
          credential,
        ),
      );
      return;
    }
    if (operation === "testRuns.results") {
      this.assertProject(
        boundary,
        await this.projectThrough(
          "testRuns.get",
          { testRunId: input["testRunId"] },
          instance,
          credential,
        ),
      );
      return;
    }
    if (operation === "testResults.attachments") {
      // A test result names no project; the run it belongs to does.
      const result = await this.readFor(
        "testResults.get",
        input,
        instance,
        credential,
      );
      const runId =
        typeof result["testRunId"] === "string"
          ? result["testRunId"]
          : undefined;
      const project =
        runId === undefined
          ? undefined
          : await this.projectThrough(
              "testRuns.get",
              { testRunId: runId },
              instance,
              credential,
            );
      this.assertProject(boundary, project);
      return;
    }
    if (
      SELF_SCOPED_READS.includes(operation) ||
      operation === "testResults.get"
    ) {
      // Answered from one fetched object that names its project; the check
      // runs on the answer, before any of it is returned.
      return;
    }
    // An operation this provider cannot map to a project is refused rather
    // than answered from the shared account's whole installation.
    throw serviceResourceDenied();
  }

  /**
   * Hold a fetched answer inside the boundary before it is returned. The
   * object read names its project — directly, or through the run a test
   * result belongs to — and a resource outside the boundary is discarded
   * whole: upstream saw the read, the model never does.
   */
  private async assertAnswerInside(
    operation: string,
    data: unknown,
    boundary: ServiceResourceBoundary,
    instance: TestitInstance,
    credential: TestitCredential,
  ): Promise<void> {
    const source = objectOf(data);
    if (operation === "testResults.get") {
      const runId =
        typeof source["testRunId"] === "string"
          ? source["testRunId"]
          : undefined;
      const project =
        runId === undefined
          ? undefined
          : await this.projectThrough(
              "testRuns.get",
              { testRunId: runId },
              instance,
              credential,
            );
      this.assertProject(boundary, project);
      return;
    }
    this.assertProject(boundary, projectOf(source));
  }

  /** Refuse unless the resolved project is one the boundary lists. */
  private assertProject(
    boundary: ServiceResourceBoundary,
    project: string | undefined,
  ): void {
    if (project === undefined || !projectAllowed(boundary, project)) {
      throw serviceResourceDenied();
    }
  }

  /**
   * One companion read used to locate the project an id-addressed answer
   * belongs to. It goes through the catalog handler of the operation it
   * mirrors, so the id is validated exactly like a direct call's.
   */
  private async readFor(
    operation: string,
    input: Readonly<Record<string, unknown>>,
    instance: TestitInstance,
    credential: TestitCredential,
  ): Promise<Record<string, unknown>> {
    const handler = TESTIT_HANDLERS[operation];
    if (handler === undefined) {
      throw new IntegrationError(
        "InvalidRequest",
        "Unsupported Test IT operation",
      );
    }
    const request = handler(input, { flags: this.config.testit });
    const response = await this.transport.getJson<unknown>(
      instance,
      credential.token,
      request.path,
      request.query,
    );
    return objectOf(response.data);
  }

  /** The project of the object one companion read answers. */
  private async projectThrough(
    operation: string,
    input: Readonly<Record<string, unknown>>,
    instance: TestitInstance,
    credential: TestitCredential,
  ): Promise<string | undefined> {
    return projectOf(
      await this.readFor(operation, input, instance, credential),
    );
  }

  /**
   * The bounded project listing: a service profile names the projects it
   * covers, so the answer is fetched from that list instead of from whatever
   * the shared account can reach. A project the service token cannot see is
   * reported as unavailable rather than silently dropped, which is what tells
   * the operator their boundary and their token disagree.
   */
  private async listBoundedProjects(
    instance: TestitInstance,
    credential: TestitCredential,
    boundary: ServiceResourceBoundary,
    input: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    const entries = boundary[TESTIT_RESOURCE_KIND] ?? [];
    const collected: unknown[] = [];
    const unavailable: string[] = [];
    for (const entry of entries) {
      try {
        const { data } = await this.transport.getJson<unknown>(
          instance,
          credential.token,
          `/projects/${encodeURIComponent(entry)}`,
        );
        collected.push(data);
      } catch (error) {
        if (!recoverableResource(error)) throw error;
        unavailable.push(entry);
      }
    }
    const flags = this.config.testit;
    // The window is cut here, because the allowlist — not the upstream page —
    // is what this answer pages over; the projection keeps the caller's text
    // filter and the item shape the personal listing answers with.
    const offset = listOffset(input["offset"]);
    const window = collected.slice(
      offset,
      offset + listLimit(input["limit"], TESTIT_LIMITS.projects, flags),
    );
    const projection = TESTIT_PROJECTIONS["projects.list"];
    const projected = objectOf(
      projection === undefined
        ? window
        : projection(window, {
            flags,
            input,
            instanceLabel: instance.label,
            baseUrl: instance.baseUrl,
          }),
    );
    return {
      ...projected,
      serviceScoped: true,
      ...(unavailable.length === 0
        ? {}
        : { unavailableResources: unavailable }),
    };
  }

  /**
   * One attachment, read as text. Test IT describes the file — its name and its
   * size — before a byte is requested, and this provider trusts that description
   * over anything the caller said: an archive, a screenshot, a document or a key
   * is refused by name, a file bigger than the budget is refused by size, and
   * the body that does come back is bounded, redacted and marked as external
   * content.
   */
  private async readAttachment(
    instance: TestitInstance,
    credential: TestitCredential,
    input: Readonly<Record<string, unknown>>,
    request: TestitRequest,
    flags: TestitFlags,
  ): Promise<Record<string, unknown>> {
    const metadata = await this.transport.getJson<unknown>(
      instance,
      credential.token,
      `${request.path}/metadata`,
      {},
    );
    const described = objectOf(metadata.data);
    const attachmentId = String(input["attachmentId"] ?? "");
    const name = attachmentName(described["name"]) || `${attachmentId}`;
    const problem = attachmentBinaryProblem(name);
    if (problem !== undefined) {
      throw new IntegrationError("InvalidRequest", problem);
    }
    const declared = described["size"];
    const declaredBytes =
      typeof declared === "number" && Number.isFinite(declared)
        ? declared
        : undefined;
    const limit = attachmentByteLimit(input["maxBytes"], flags);
    assertReadableSize(declaredBytes, limit);
    const body = await this.transport.getText(
      instance,
      credential.token,
      request.path,
      limit,
    );
    const text = body.binary ? "" : String(redactSecrets(body.text) ?? "");
    return {
      attachmentId,
      name,
      type: typeof described["type"] === "string" ? described["type"] : null,
      declaredBytes: declaredBytes ?? null,
      downloadedBytes: body.bytes,
      binary: body.binary,
      truncated: body.truncated,
      ...(body.binary ? {} : { untrustedContent: contentBlock(text, limit) }),
    };
  }

  private resolveInstance(requested: string | undefined): TestitInstance {
    const flags = this.config.testit;
    const id = requested?.trim();
    if (id !== undefined && id !== "") {
      const instance = flags.instances.find((item) => item.id === id);
      if (instance === undefined) {
        throw new IntegrationError(
          "InvalidCredential",
          "Unknown Test IT instance",
        );
      }
      return instance;
    }
    const [only] = flags.instances;
    if (only === undefined) {
      throw new IntegrationError(
        "InvalidCredential",
        "No Test IT instance is configured",
      );
    }
    if (flags.instances.length > 1) {
      throw new IntegrationError(
        "InvalidCredential",
        "Choose a Test IT instance",
      );
    }
    return only;
  }
}

/** A missing or forbidden project inside a boundary is reported, not fatal. */
/** Map an upstream failure of the probe onto a health status. */
export default TestitProvider;
