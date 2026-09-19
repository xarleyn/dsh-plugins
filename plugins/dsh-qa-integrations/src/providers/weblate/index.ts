import {
  resolveCredentialHelp,
  type CredentialHelp,
} from "@yadsh/dsh-plugin-kit";
import { requiredInteger } from "../../coerce.js";
import type { ResolvedQaIntegrationsConfig } from "../../config.js";
import { IntegrationError } from "../../errors.js";
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
  WEBLATE_CAPABILITY_INFO,
  WEBLATE_OPERATIONS,
  WEBLATE_RESOURCE_KIND,
  enabledCapabilities,
  weblateOperationCapability,
  weblateOperationMetadata,
} from "./catalog.js";
import {
  weblateInstance,
  type WeblateFlags,
  type WeblateInstance,
} from "./config.js";
import {
  WEBLATE_HANDLERS,
  WEBLATE_PROJECTIONS,
  WEBLATE_UNTRUSTED_OPERATIONS,
  accountFromUsers,
  accountIdFrom,
  accountNameFrom,
  textLimitFor,
  translationRef,
  type WeblateProjectionContext,
  type WeblateRequest,
} from "./operations.js";
import { WEBLATE_CREDENTIAL_HELP } from "./credential-help.js";
import {
  WeblateTransport,
  credentialFromPlaintext,
  credentialInstance,
  resultsOf,
  type WeblateCredential,
  type WeblatePage,
} from "./transport.js";
export {
  credentialFromPlaintext,
  credentialInstance,
  resultsOf,
  type WeblateCredential,
} from "./transport.js";

/**
 * A Weblate API token is opaque to this provider: the documented prefixes below
 * are a hint for the user, never a permission check, and a working token is
 * accepted whatever it looks like. What is refused is a paste mistake — a URL,
 * a YAML line or anything carrying whitespace.
 */
const TOKEN_SHAPE = /^[A-Za-z0-9_.:-]{8,512}$/u;
const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\//iu;

export type WeblateTokenKind = "personal" | "project" | "unknown";

/**
 * Which of Weblate's token shapes a value looks like. Weblate decides what a
 * token may do, so this only ever reaches the user as a label.
 */
export function tokenKind(token: string): WeblateTokenKind {
  if (token.startsWith("wlu_")) return "personal";
  if (token.startsWith("wlp_")) return "project";
  return "unknown";
}

const TOKEN_KIND_LABEL: Readonly<Record<WeblateTokenKind, string>> =
  Object.freeze({
    personal: "личный токен",
    project: "токен проекта",
    unknown: "токен",
  });

/**
 * Operations addressed by the numeric id of a string or a screenshot alone:
 * service mode resolves that id to the project it belongs to — upstream, out
 * of the answer's own translation URL — before anything is released.
 */
const ID_ADDRESSED: readonly string[] = Object.freeze([
  "units.get",
  "units.comments",
  "units.suggestions",
  "screenshots.get",
]);

/**
 * Listings whose request cannot carry the boundary: the two unit searches over
 * everything the token sees have their project clause forced in from the
 * checked argument, and the screenshot listing takes no scope at all, so the
 * rows of all three are held to the boundary after the read as well.
 */
const BOUNDED_AFTER_READ: readonly string[] = Object.freeze([
  "units.find",
  "units.failing",
  "screenshots.list",
]);

/** The `translation` URL of an upstream answer, when it carries one. */
function translationUrlOf(data: unknown): unknown {
  return typeof data === "object" && data !== null
    ? (data as Record<string, unknown>)["translation"]
    : undefined;
}

/** The project slug inside a same-origin translation URL, when it is one. */
function projectOfTranslation(
  value: unknown,
  origin: string,
): string | undefined {
  const project = translationRef(value, origin)?.["project"];
  return typeof project === "string" && project !== "" ? project : undefined;
}

/**
 * Drop the rows of a listing that answer for a project outside the boundary.
 * A row whose project cannot even be resolved is dropped with them: in service
 * mode an unattributable row is not shown, never shown anyway.
 */
function withinBoundary(
  data: unknown,
  boundary: ServiceResourceBoundary,
): unknown {
  if (!Array.isArray(data)) return data;
  return data.filter((item) => {
    const project =
      typeof item === "object" && item !== null
        ? (item as Record<string, unknown>)["project"]
        : undefined;
    return (
      typeof project === "string" &&
      boundaryHas(boundary, WEBLATE_RESOURCE_KIND, project)
    );
  });
}

/**
 * The identity a `/users/` answer carries. An unprivileged token answers with
 * its own record; a token that may list users answers with many rows, and then
 * the probe reports no identity rather than guessing one.
 */
function serviceIdentity(
  data: unknown,
  fallback: string,
): { readonly id: string; readonly label: string } | undefined {
  const { account, resolved } = accountFromUsers(data);
  const id = account?.["id"];
  if (!resolved || account === null || typeof id !== "number") return undefined;
  return { id: String(id), label: accountName(account, fallback) };
}

/** Map an upstream failure of the probe onto a health status. */
function healthFromFailure(error: unknown): ServiceCredentialHealth {
  if (!(error instanceof IntegrationError)) return { status: "unreachable" };
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

/** A listed project the service token cannot see is reported, not fatal. */
function recoverableResource(error: unknown): boolean {
  return (
    error instanceof IntegrationError &&
    (error.code === "ResourceNotFound" ||
      error.code === "ProviderPermissionDenied")
  );
}

/** One answer shape for every list, so the model never loses the cursor. */
function envelope(
  data: unknown,
  page: WeblatePage | undefined,
  untrusted: boolean,
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
  const marker = untrusted ? { untrustedExternalContent: true } : {};
  if (Array.isArray(data)) return { items: data, ...marker, ...pagination };
  if (typeof data === "object" && data !== null) {
    return { ...(data as Record<string, unknown>), ...marker, ...pagination };
  }
  return { value: data ?? null, ...marker, ...pagination };
}

/**
 * Weblate provider: operator-configured instances over a Weblate API token.
 *
 * Localization state is read-only here. Weblate's search grammar is composed
 * from validated filters rather than accepted from the model, upstream URLs are
 * echoed only when they point at the configured instance and never followed, and
 * every answer that carries upstream-authored text is marked as untrusted
 * content.
 */
export class WeblateProvider implements IntegrationProvider {
  readonly id = "weblate";
  readonly displayName = "Weblate";
  /** What this deployment allows; Weblate's own permissions still apply. */
  readonly capabilities: readonly IntegrationCapability[];
  readonly capabilityInfo: Readonly<
    Record<IntegrationCapability, IntegrationCapabilityInfo>
  > = WEBLATE_CAPABILITY_INFO;
  /** Where the settings card says this provider's credential comes from. */
  readonly credentialHelp: CredentialHelp | null;
  /** Overrides the deployment got wrong; reported once at startup, never fatal. */
  readonly credentialHelpProblems: readonly string[];

  private readonly transport: WeblateTransport;

  constructor(
    private readonly config: ResolvedQaIntegrationsConfig,
    fetcher: typeof fetch = fetch,
  ) {
    this.transport = new WeblateTransport(config, config.weblate, fetcher);
    this.capabilities = Object.freeze(enabledCapabilities(config.weblate));
    const help = resolveCredentialHelp(
      WEBLATE_CREDENTIAL_HELP,
      config.credentialHelp["weblate"],
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
    if (!TOKEN_SHAPE.test(token) || URL_LIKE.test(token)) {
      throw new IntegrationError(
        "InvalidCredential",
        "Use a Weblate API token",
      );
    }
    const instance = this.resolveInstance(options?.["instanceId"]);
    return {
      credential: JSON.stringify({
        instanceId: instance.id,
        token,
      } satisfies WeblateCredential),
      portal: instance.baseUrl,
    };
  }

  operationCapability(operation: string): IntegrationCapability | undefined {
    return weblateOperationCapability(operation);
  }

  operationMetadata(operation: string): OperationSecurityMetadata | undefined {
    return weblateOperationMetadata(operation);
  }

  /** Every project-scoped read is held inside the profile's project boundary. */
  resourceBoundaryKind(operation: string): string | undefined {
    return WEBLATE_OPERATIONS[operation]?.security.requiresResourceBoundary ===
      true
      ? WEBLATE_RESOURCE_KIND
      : undefined;
  }

  /**
   * Portal of a configured instance. An empty id means "the only instance", the
   * same rule `parseCredential` applies, so deployment configuration and the
   * connect form name instances alike.
   */
  instancePortal(instanceId: string): string | undefined {
    const instances = this.config.weblate.instances;
    const id = instanceId.trim();
    if (id === "") {
      return instances.length === 1 ? instances[0]?.baseUrl : undefined;
    }
    return weblateInstance(this.config.weblate, id)?.baseUrl;
  }

  capabilityServiceState(
    capability: IntegrationCapability,
  ): CapabilityServiceState | undefined {
    return operationCapabilityServiceState(WEBLATE_OPERATIONS, capability);
  }

  async validate(context: ProviderContext): Promise<ProviderValidation> {
    const credential = credentialFromPlaintext(context.credential);
    const instance = credentialInstance(this.config.weblate, credential);
    // Weblate has no "current user" endpoint. A token that may not administer
    // users answers `GET /api/users/` with its own record alone, which is how
    // the account is identified and the token is proven in one read.
    const { data } = await this.transport.getJson<unknown>(
      instance,
      credential.token,
      "/users/",
      { page_size: 2 },
    );
    const host = new URL(instance.baseUrl).host;
    return {
      tenantId: instance.baseUrl,
      // Empty when the token may list users: this provider will not claim an
      // account it cannot pin down. No operation substitutes it for an argument.
      externalUserId: accountIdFrom(data),
      displayName: `${accountNameFrom(data, host)} · ${TOKEN_KIND_LABEL[tokenKind(credential.token)]}`,
      /**
       * Weblate does not report what the token it was given may do, so there is
       * nothing to narrow here: the deployment switches bound what this
       * connection may attempt, and Weblate itself refuses the rest.
       */
      capabilities: this.capabilities,
    };
  }

  /**
   * Health of a deployment-managed token. The probe is the one read personal
   * validation makes, so it cannot change upstream state; Weblate exposes no
   * token-scope introspection, so there is nothing wider than read-only to
   * detect here — the local service ceiling stays the only bound on what the
   * credential may do, and the warning says so.
   */
  async validateServiceCredential(
    context: ProviderContext,
  ): Promise<ServiceCredentialHealth> {
    const credential = credentialFromPlaintext(context.credential);
    const instance = credentialInstance(this.config.weblate, credential);
    let data: unknown;
    try {
      const response = await this.transport.getJson<unknown>(
        instance,
        credential.token,
        "/users/",
        { page_size: 2 },
      );
      data = response.data;
    } catch (error) {
      return healthFromFailure(error);
    }
    const identity = serviceIdentity(data, new URL(instance.baseUrl).host);
    return {
      status: "healthy",
      ...(identity === undefined ? {} : { upstreamIdentity: identity }),
      warnings: [
        "Weblate did not report the token scopes; the local service ceiling still applies",
      ],
    };
  }

  async execute(
    context: ProviderContext,
    operation: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const credential = credentialFromPlaintext(context.credential);
    const instance = credentialInstance(this.config.weblate, credential);
    const definition = WEBLATE_OPERATIONS[operation];
    const handler = WEBLATE_HANDLERS[operation];
    if (definition === undefined || handler === undefined) {
      throw new IntegrationError(
        "InvalidRequest",
        "Unsupported Weblate operation",
      );
    }
    // Ceiling first, then the boundary: what the operation is decides before
    // where it may read.
    if (context.credentialSource === "service") {
      assertServiceOperationAllowed(
        definition.security,
        "This Weblate operation is not available through the service credential",
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
    const flags = this.config.weblate;
    if (boundary !== undefined && operation === "projects.list") {
      return this.listBoundedProjects(instance, credential, boundary, flags);
    }
    const request: WeblateRequest = handler(input, {
      flags,
      origin: instance.baseUrl,
    });
    const response = await this.transport.getJson<unknown>(
      instance,
      credential.token,
      request.path,
      request.query,
      request.page,
    );
    // Every listing answers with the same envelope, so the projection only ever
    // sees the rows; a single read keeps the object upstream sent.
    const source =
      definition.list === true ? resultsOf(response.data) : response.data;
    const projection = WEBLATE_PROJECTIONS[operation];
    const projectionContext: WeblateProjectionContext = {
      flags,
      origin: instance.baseUrl,
      textLimit: textLimitFor(operation, input["maxChars"], flags),
    };
    const data =
      projection === undefined ? source : projection(source, projectionContext);
    // The pagination block below still describes the upstream page: the rows
    // outside the boundary are removed from it, not renamed into a shorter one.
    const visible =
      boundary !== undefined && BOUNDED_AFTER_READ.includes(operation)
        ? withinBoundary(data, boundary)
        : data;
    const untrusted = WEBLATE_UNTRUSTED_OPERATIONS.includes(operation);
    if (definition.list === true) {
      return envelope(visible, response.page, untrusted);
    }
    return untrusted
      ? { ...objectOf(data), untrustedExternalContent: true }
      : objectOf(data);
  }

  /**
   * Hold one call inside the deployment's boundary. A service-safe operation
   * either names its project in the arguments — a missing slug is refused, which
   * is what keeps the global unit searches from answering with the shared
   * account's whole view — or is addressed by the id of a string or a
   * screenshot, which is resolved to its project upstream first.
   */
  private async assertInsideBoundary(
    operation: string,
    input: Readonly<Record<string, unknown>>,
    boundary: ServiceResourceBoundary,
    instance: WeblateInstance,
    credential: WeblateCredential,
  ): Promise<void> {
    // The project listing is built from the allowlist itself, and the
    // screenshot listing cannot name a project at all — its rows are held to
    // the boundary after the read instead.
    if (operation === "projects.list" || operation === "screenshots.list") {
      return;
    }
    if (ID_ADDRESSED.includes(operation)) {
      const project = await this.projectOfAddressedResource(
        operation,
        input,
        instance,
        credential,
      );
      if (
        project === undefined ||
        !boundaryHas(boundary, WEBLATE_RESOURCE_KIND, project)
      ) {
        throw serviceResourceDenied();
      }
      return;
    }
    const project = input["project"];
    const ref = project === undefined ? "" : String(project).trim();
    if (ref === "" || !boundaryHas(boundary, WEBLATE_RESOURCE_KIND, ref)) {
      throw serviceResourceDenied();
    }
  }

  /**
   * Resolve one id-addressed read to the project it answers for. The probe is
   * the same read the operation itself makes — Weblate has no cheaper "which
   * project is this id" endpoint — and the probed answer is discarded unless
   * the project is inside the boundary, so a foreign id reveals nothing.
   */
  private async projectOfAddressedResource(
    operation: string,
    input: Readonly<Record<string, unknown>>,
    instance: WeblateInstance,
    credential: WeblateCredential,
  ): Promise<string | undefined> {
    if (operation === "screenshots.get") {
      const screenshotId = requiredInteger(
        input["screenshotId"],
        "screenshotId",
      );
      const { data } = await this.transport.getJson<unknown>(
        instance,
        credential.token,
        `/screenshots/${screenshotId}/`,
      );
      return projectOfTranslation(translationUrlOf(data), instance.baseUrl);
    }
    const unitId = requiredInteger(input["unitId"], "unitId");
    const { data } = await this.transport.getJson<unknown>(
      instance,
      credential.token,
      `/units/${unitId}/`,
    );
    return projectOfTranslation(translationUrlOf(data), instance.baseUrl);
  }

  /**
   * The bounded project listing. A service profile names the projects it covers,
   * so the answer is built from that list instead of from whatever the shared
   * account can reach; a project the service token cannot see is reported as
   * unavailable rather than silently dropped. The whole allowlist is the answer
   * — its size is bounded by the administrator, not by a cursor.
   */
  private async listBoundedProjects(
    instance: WeblateInstance,
    credential: WeblateCredential,
    boundary: ServiceResourceBoundary,
    flags: WeblateFlags,
  ): Promise<Record<string, unknown>> {
    const refs = boundary[WEBLATE_RESOURCE_KIND] ?? [];
    const collected: unknown[] = [];
    const unavailable: string[] = [];
    for (const ref of refs) {
      try {
        const { data } = await this.transport.getJson<unknown>(
          instance,
          credential.token,
          `/projects/${encodeURIComponent(ref)}/`,
        );
        collected.push(data);
      } catch (error) {
        if (!recoverableResource(error)) throw error;
        unavailable.push(ref);
      }
    }
    const projection = WEBLATE_PROJECTIONS["projects.list"];
    const projected =
      projection === undefined
        ? collected
        : projection(collected, {
            flags,
            origin: instance.baseUrl,
            textLimit: textLimitFor("projects.list", undefined, flags),
          });
    return {
      items: Array.isArray(projected) ? projected : [],
      serviceScoped: true,
      ...(unavailable.length === 0
        ? {}
        : { unavailableResources: unavailable }),
    };
  }

  private resolveInstance(requested: string | undefined) {
    const flags: WeblateFlags = this.config.weblate;
    const id = requested?.trim();
    if (id !== undefined && id !== "") {
      const instance = weblateInstance(flags, id);
      if (instance === undefined) {
        throw new IntegrationError(
          "InvalidCredential",
          "Unknown Weblate instance",
        );
      }
      return instance;
    }
    const [only] = flags.instances;
    if (only === undefined) {
      throw new IntegrationError(
        "InvalidCredential",
        "No Weblate instance is configured",
      );
    }
    if (flags.instances.length > 1) {
      throw new IntegrationError(
        "InvalidCredential",
        "Choose a Weblate instance",
      );
    }
    return only;
  }
}

export default WeblateProvider;
