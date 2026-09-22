import {
  resolveCredentialHelp,
  type CredentialHelp,
} from "@yadsh/dsh-plugin-kit";
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
import { healthFromFailure } from "../shared/health.js";
import { recordOf } from "../shared/payload.js";
import {
  assertServiceOperationAllowed,
  serviceBoundaryOf,
} from "../shared/service-boundary.js";
import {
  JIRA_CAPABILITY_INFO,
  JIRA_OPERATIONS,
  JIRA_RESOURCE_KIND,
  enabledCapabilities,
  jiraCompanionPath,
  jiraOperationCapability,
  jiraOperationMetadata,
  jiraOperationPath,
} from "./catalog.js";
import {
  CUSTOM_FIELD_ID,
  jiraSite,
  type JiraFlags,
  type JiraSite,
} from "./config.js";
import {
  assertDeployment,
  dialectOf,
  identityOf,
  type JiraDialect,
} from "./dialect.js";
import {
  identifierName,
  issueKey as issueKeyOf,
  needsUserLookup,
} from "./jql.js";
import {
  JIRA_HANDLERS,
  JIRA_PROJECTIONS,
  requestedIncludes,
  wantsFieldNames,
} from "./operations.js";
import { JIRA_CREDENTIAL_HELP } from "./credential-help.js";
import {
  JiraTransport,
  credentialFromPlaintext,
  credentialSite,
  type JiraCredential,
} from "./transport.js";

export {
  credentialFromPlaintext,
  credentialSite,
  type JiraCredential,
} from "./transport.js";

/**
 * Jira API tokens are opaque; the shape a site accepts is the dialect's own.
 * Cloud tokens are either the classic 24-character form or the newer prefixed
 * one (`ATATT…`, base64url-ish and long), while a Server / Data Center personal
 * access token is base64 and may carry the characters url-safe base64 forbids.
 * A pasted URL, a YAML snippet or a token with whitespace is refused before
 * anything is sent upstream. The one `email:token` shape that exists is the
 * deployment-managed secret, which `parseCredential` splits — the connect form
 * never accepts it.
 */
const EMAIL_SHAPE = /^[^\s@]{1,128}@[^\s@]{1,190}$/u;

const NO_INCLUDES: readonly string[] = Object.freeze([]);

function accountName(
  displayName: string | undefined,
  email: string,
  fallback = "Jira",
): string {
  if (displayName === undefined || displayName === "") {
    return email === "" ? fallback : email;
  }
  return email === "" ? displayName : `${displayName} (${email})`;
}

/**
 * The `email:token` pair of a deployment-managed secret. Jira Cloud
 * authenticates HTTP Basic over exactly this string, so it is the form the
 * operator keeps in the secret file or the environment — one record, because
 * the pair must not be assembled from two. The connect form never produces it:
 * it collects the e-mail next to the token, and a pasted pair stays refused.
 */
function splitBasicPair(
  raw: string,
): { email: string; token: string } | undefined {
  const at = raw.indexOf(":");
  if (at <= 0) return undefined;
  const email = raw.slice(0, at);
  if (!EMAIL_SHAPE.test(email)) return undefined;
  return { email, token: raw.slice(at + 1) };
}

/** Operations that read one issue, and so may hit a security-restricted one. */
const ISSUE_SCOPED_READS: readonly string[] = Object.freeze([
  "issues.get",
  "issues.comments",
  "issues.transitions",
]);

/**
 * Jira provider: operator-configured sites over an Atlassian API token (Cloud)
 * or a personal access token (Server / Data Center).
 *
 * The token is spent against the site the credential names, and that site is
 * re-resolved from operator config on every call, so a site the deployment
 * removed or repointed closes the connection instead of redirecting it. Which
 * product answers there — and so which API root, which authentication scheme
 * and which shape of answer this provider speaks — is the site's own declared
 * deployment type, never a guess made at connect or at run time.
 */
export class JiraProvider implements IntegrationProvider {
  readonly id = "jira";
  readonly displayName = "Jira";
  /** What this deployment allows; Jira's own permissions narrow it upstream. */
  readonly capabilities: readonly IntegrationCapability[];
  readonly capabilityInfo: Readonly<
    Record<IntegrationCapability, IntegrationCapabilityInfo>
  > = JIRA_CAPABILITY_INFO;
  /** Where the settings card says this provider's credential comes from. */
  readonly credentialHelp: CredentialHelp | null;
  /** Overrides the deployment got wrong; reported once at startup, never fatal. */
  readonly credentialHelpProblems: readonly string[];

  private readonly transport: JiraTransport;

  constructor(
    private readonly config: ResolvedQaIntegrationsConfig,
    fetcher: typeof fetch = fetch,
  ) {
    this.transport = new JiraTransport(config, config.jira, fetcher);
    this.capabilities = Object.freeze(enabledCapabilities(config.jira));
    const help = resolveCredentialHelp(
      JIRA_CREDENTIAL_HELP,
      config.credentialHelp["jira"],
    );
    this.credentialHelp = help.help;
    this.credentialHelpProblems = help.problems;
  }

  /**
   * Keep the token, the account it belongs to and the site it was minted for.
   * Both non-secret choices come from the connect form and from operator config,
   * never from a tool argument, which is what keeps the broker from dialling any
   * host the caller names.
   *
   * The same method turns a deployment-managed secret into this credential
   * shape. On Cloud that secret is the whole Basic pair (`email:token`), because
   * Jira cannot spend the token without the account and the pair must not be
   * split across two records; the form path instead supplies the e-mail
   * separately, and keeps refusing a pasted pair. A Server / Data Center
   * personal access token needs no account at all, so its connection stores an
   * empty e-mail and authenticates as the token's own bearer.
   */
  parseCredential(
    raw: string,
    options?: Readonly<Record<string, string>>,
  ): { readonly credential: string; readonly portal: string } {
    // The site decides what this connection is allowed to look like, so it is
    // resolved before the secret is judged.
    const site = this.resolveSite(
      options?.["siteId"] ?? options?.["instanceId"],
    );
    const dialect = dialectOf(site);
    const provided = raw.trim();
    const pair =
      options?.["email"] === undefined ? splitBasicPair(provided) : undefined;
    const token = pair === undefined ? provided : pair.token;
    if (!dialect.tokenShape.test(token)) {
      throw new IntegrationError(
        "InvalidCredential",
        `Use a Jira ${dialect.credentialLabel}`,
      );
    }
    const email =
      (pair === undefined ? options?.["email"] : pair.email)?.trim() ?? "";
    if (dialect.requiresEmail && !EMAIL_SHAPE.test(email)) {
      throw new IntegrationError(
        "InvalidCredential",
        "Use the e-mail of the Atlassian account the token belongs to",
      );
    }
    return {
      credential: JSON.stringify({
        siteId: site.id,
        email,
        token,
      } satisfies JiraCredential),
      portal: site.baseUrl,
    };
  }

  operationCapability(operation: string): IntegrationCapability | undefined {
    return jiraOperationCapability(operation);
  }

  operationMetadata(operation: string): OperationSecurityMetadata | undefined {
    return jiraOperationMetadata(operation);
  }

  /** Every project-scoped read names its project through a key or an issue key. */
  resourceBoundaryKind(operation: string): string | undefined {
    return JIRA_OPERATIONS[operation]?.security.requiresResourceBoundary ===
      true
      ? JIRA_RESOURCE_KIND
      : undefined;
  }

  /**
   * Portal of a configured site. An empty id means "the only site", the same
   * rule `parseCredential` applies, so deployment configuration and the connect
   * form name sites alike.
   */
  instancePortal(instanceId: string): string | undefined {
    const sites = this.config.jira.sites;
    const id = instanceId.trim();
    if (id === "") {
      return sites.length === 1 ? sites[0]?.baseUrl : undefined;
    }
    return jiraSite(this.config.jira, id)?.baseUrl;
  }

  capabilityServiceState(
    capability: IntegrationCapability,
  ): CapabilityServiceState | undefined {
    return operationCapabilityServiceState(JIRA_OPERATIONS, capability);
  }

  /**
   * Health of a deployment-managed token. The probe reads only the identity
   * endpoint the personal validation reads, so it never changes upstream state;
   * Jira reports no granted scopes for an API token, so the answer is healthy
   * with a warning — the local service ceiling stays the whole local boundary.
   */
  async validateServiceCredential(
    context: ProviderContext,
  ): Promise<ServiceCredentialHealth> {
    const credential = credentialFromPlaintext(context.credential);
    const site = credentialSite(this.config.jira, credential);
    const dialect = dialectOf(site);
    let myself: Record<string, unknown>;
    try {
      myself = await this.transport.getJson<Record<string, unknown>>(
        site,
        credential,
        this.identityPath(site),
      );
    } catch (error) {
      return healthFromFailure(error);
    }
    const accountId = identityOf(dialect, myself);
    const identity =
      accountId !== undefined
        ? {
            id: accountId,
            label: accountName(
              typeof myself["displayName"] === "string"
                ? myself["displayName"]
                : undefined,
              typeof myself["emailAddress"] === "string" &&
                myself["emailAddress"] !== ""
                ? myself["emailAddress"]
                : credential.email,
            ),
          }
        : undefined;
    return {
      status: "healthy",
      ...(identity === undefined ? {} : { upstreamIdentity: identity }),
      warnings: [
        "Jira did not report the token scopes; the local service ceiling still applies",
      ],
    };
  }

  async validate(context: ProviderContext): Promise<ProviderValidation> {
    const credential = credentialFromPlaintext(context.credential);
    const site = credentialSite(this.config.jira, credential);
    const dialect = dialectOf(site);
    const myself = await this.transport.getJson<Record<string, unknown>>(
      site,
      credential,
      this.identityPath(site),
    );
    // The product is checked before the identity is read as one: a site that
    // answers the other Jira has a different shape of identity, and "set
    // deploymentType: …" is the diagnosis that fixes it, not "no identity".
    await this.requireDeployment(site, credential, dialect);
    const externalUserId = identityOf(dialect, myself);
    if (externalUserId === undefined) {
      throw new IntegrationError(
        "ProviderUnavailable",
        "Provider identity is unavailable",
      );
    }
    const email =
      typeof myself["emailAddress"] === "string" &&
      myself["emailAddress"] !== ""
        ? myself["emailAddress"]
        : credential.email;
    const displayName =
      typeof myself["displayName"] === "string" ? myself["displayName"] : "";
    return {
      tenantId: site.baseUrl,
      externalUserId,
      displayName: accountName(displayName, email, dialect.productName),
      // Jira reports no granted scopes for an API token, so the deployment
      // switches are the whole local boundary and the site's own permissions
      // decide upstream.
      capabilities: this.capabilities,
    };
  }

  /** The identity read of this site's product: the one connect proves itself with. */
  private identityPath(site: JiraSite): string {
    const path = jiraOperationPath("connection.get", site.deploymentType);
    if (path === undefined) {
      throw new IntegrationError(
        "ProviderUnavailable",
        "Jira identity endpoint is unavailable",
      );
    }
    return path;
  }

  async execute(
    context: ProviderContext,
    operation: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const credential = credentialFromPlaintext(context.credential);
    const site = credentialSite(this.config.jira, credential);
    const definition = JIRA_OPERATIONS[operation];
    const handler = JIRA_HANDLERS[operation];
    if (definition === undefined || handler === undefined) {
      throw new IntegrationError(
        "InvalidRequest",
        "Unsupported Jira operation",
      );
    }
    // Ceiling first, then the boundary: what the operation is decides before
    // where it may read.
    if (context.credentialSource === "service") {
      assertServiceOperationAllowed(
        definition.security,
        "This Jira operation is not available through the service credential",
      );
    }
    const boundary = serviceBoundaryOf(context);
    if (
      boundary !== undefined &&
      definition.security.requiresResourceBoundary
    ) {
      this.assertInsideBoundary(operation, input, boundary);
    }
    const dialect = dialectOf(site);
    if (
      boundary !== undefined &&
      operation === "issues.search" &&
      (needsUserLookup(input["assignee"], dialect.deployment) ||
        needsUserLookup(input["reporter"], dialect.deployment))
    ) {
      // A person filter becomes JQL only after the site's directory resolves
      // the name into the identifier this product filters on, and that
      // directory read is held inside no project boundary. A shared account is
      // refused it: the question needs the identifier an issue reported, or a
      // personal credential.
      throw new IntegrationError(
        "ServiceResourceNotAllowed",
        `Resolving a person by name reads the site directory, which service mode does not read; pass the ${identifierName(dialect.deployment)} an issue reported or "me"`,
      );
    }
    const flags = this.config.jira;
    // Two values a question carries but Jira cannot take as they stand: a custom
    // field named by its business term instead of its instance id, and a person
    // named the way a person actually has a name ("задачи Иванова"). Both are
    // turned into what Jira filters on before the query is built.
    const prepared =
      operation === "issues.search"
        ? await this.resolvePeople(
            site,
            credential,
            this.applyFieldAliases(input, flags),
            dialect,
          )
        : input;
    const request = handler(prepared, {
      externalUserId: context.externalUserId,
      flags,
      dialect,
    });
    // In service mode a search also asks for every hit's security level, so the
    // answer can be held inside the boundary with restricted issues dropped.
    const query =
      boundary !== undefined && operation === "issues.search"
        ? {
            ...request.query,
            fields: `${String(request.query["fields"] ?? "")},security`,
          }
        : request.query;
    if (boundary !== undefined && ISSUE_SCOPED_READS.includes(operation)) {
      await this.assertIssueNotRestricted(
        site,
        credential,
        String(input["issueKey"] ?? ""),
      );
    }
    const data = await this.transport.getJson<unknown>(
      site,
      credential,
      request.path,
      query,
    );
    const raw =
      boundary !== undefined && operation === "issues.search"
        ? boundedSearchResults(data, boundary)
        : data;
    // The schema is read only after the issue answered and only when the model
    // asked for named custom fields: an issue that is not there has nothing to
    // name, and the extra call would have been spent for nothing.
    const include =
      operation === "issues.get"
        ? requestedIncludes(input["include"])
        : NO_INCLUDES;
    const fieldNames =
      wantsFieldNames(include) && flags.fieldsRead
        ? await this.fieldNames(site, credential)
        : undefined;
    const projection = JIRA_PROJECTIONS[operation];
    const projected =
      projection === undefined
        ? raw
        : projection(raw, {
            flags,
            site,
            include,
            fieldNames,
            issueKey:
              typeof input["issueKey"] === "string"
                ? input["issueKey"]
                : undefined,
          });
    return typeof projected === "object" &&
      projected !== null &&
      !Array.isArray(projected)
      ? (projected as Record<string, unknown>)
      : { value: projected ?? null };
  }

  /**
   * Hold one call inside the deployment's boundary. A single-resource read
   * names its project — a project key, or the key an issue key embeds — and
   * must stay inside it, or nothing is read. A search names none by default, so
   * it is not refused here but answered with the hits filtered to the boundary
   * instead.
   */
  private assertInsideBoundary(
    operation: string,
    input: Readonly<Record<string, unknown>>,
    boundary: ServiceResourceBoundary,
  ): void {
    if (operation === "issues.search") return;
    if (operation === "projects.get") {
      const ref =
        typeof input["projectKey"] === "string"
          ? input["projectKey"].trim()
          : "";
      if (ref === "" || !projectAllowed(boundary, ref)) {
        throw serviceRefusal();
      }
      return;
    }
    // Whatever remains is one of the issue-scoped reads: the project is the
    // part of the issue key before the dash.
    const key = typeof input["issueKey"] === "string" ? input["issueKey"] : "";
    const project = key.slice(0, key.indexOf("-"));
    if (!projectAllowed(boundary, project)) {
      throw serviceRefusal();
    }
  }

  /**
   * Fail closed on an issue an issue-security level closes off. The service
   * identity may be allowed to see it upstream, so the check is made here,
   * before anything about it is returned, and it answers the same not-found a
   * personal caller would see for an issue they cannot.
   */
  private async assertIssueNotRestricted(
    site: JiraSite,
    credential: JiraCredential,
    requested: string,
  ): Promise<void> {
    const issue = issueKeyOf(requested);
    const path = jiraOperationPath("issues.get", site.deploymentType);
    const answer = await this.transport.getJson<Record<string, unknown>>(
      site,
      credential,
      (path ?? "").replace(":issueKey", issue),
      { fields: "security" },
    );
    if (restricted(recordOf(answer))) {
      throw new IntegrationError(
        "ResourceNotFound",
        "Resource is not available through the service credential",
      );
    }
  }

  /**
   * Replace a custom field's alias with the instance id the operator mapped it
   * to. The mapping lives in the deployment's config on purpose: which of an
   * instance's fields carries "the product" is knowledge about that instance,
   * not about this provider, so the repository ships no field id and the
   * deployment declares its own names.
   *
   * A name that is neither an id nor a configured alias is refused here, with
   * the aliases this deployment does declare, because a silently unresolved
   * field would answer "no such issues" instead of "unknown field".
   */
  private applyFieldAliases(
    input: Readonly<Record<string, unknown>>,
    flags: JiraFlags,
  ): Readonly<Record<string, unknown>> {
    const requested = input["customFields"];
    if (!Array.isArray(requested)) return input;
    const aliases = flags.fieldAliases;
    const names = Object.keys(aliases).sort();
    const resolved = requested.map((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return entry;
      }
      const record = entry as Record<string, unknown>;
      const name =
        typeof record["field"] === "string" ? record["field"].trim() : "";
      if (name === "" || CUSTOM_FIELD_ID.test(name)) return entry;
      const id = aliases[name];
      if (id !== undefined) return { ...record, field: id };
      throw new IntegrationError(
        "InvalidRequest",
        names.length === 0
          ? `customFields.field "${name}" is not a customfield_ id; this deployment configured no aliases`
          : `customFields.field "${name}" is not a customfield_ id or a configured alias (${names.join(", ")})`,
      );
    });
    return { ...input, customFields: resolved };
  }

  /**
   * Replace a person's name with the identifier this product filters on, for
   * the two filters that can carry one. `me` and an identifier already in the
   * product's own shape are what Jira wants and cost no call.
   *
   * The directory is a read of the site's own user list, bounded to ten hits,
   * and its answer is never handed to the model: it only decides the identifier
   * the query is built from. A name nobody matches, or a name several people
   * share, is refused with what to do next — the identifier an issue reported —
   * because the alternative is a query that quietly answers "no such issues".
   */
  private async resolvePeople(
    site: JiraSite,
    credential: JiraCredential,
    input: Readonly<Record<string, unknown>>,
    dialect: JiraDialect,
  ): Promise<Readonly<Record<string, unknown>>> {
    const resolved: Record<string, unknown> = { ...input };
    for (const field of ["assignee", "reporter"] as const) {
      const value = input[field];
      if (!needsUserLookup(value, dialect.deployment)) continue;
      resolved[field] = await this.identityFor(
        site,
        credential,
        dialect,
        field,
        String(value).trim(),
      );
    }
    return resolved;
  }

  private async identityFor(
    site: JiraSite,
    credential: JiraCredential,
    dialect: JiraDialect,
    field: string,
    query: string,
  ): Promise<string> {
    const users = await this.transport.getJson<unknown>(
      site,
      credential,
      jiraCompanionPath("userSearch", site.deploymentType),
      { [dialect.userSearchParam]: query, maxResults: 10 },
    );
    const byId = new Map<string, string>();
    for (const entry of Array.isArray(users) ? users : []) {
      if (typeof entry !== "object" || entry === null) continue;
      const record = entry as Record<string, unknown>;
      const identity = identityOf(dialect, record);
      if (identity === undefined) continue;
      if (record["active"] === false) continue;
      const displayName =
        typeof record["displayName"] === "string"
          ? record["displayName"]
          : identity;
      byId.set(identity, displayName);
    }
    const matches = [...byId.entries()];
    if (matches.length === 1 && matches[0] !== undefined) return matches[0][0];
    if (matches.length === 0) {
      throw new IntegrationError(
        "InvalidRequest",
        `${field} matches no Jira user named "${query}"; pass the ${identifierName(dialect.deployment)} an issue reported, or "me"`,
      );
    }
    const names = matches
      .slice(0, 3)
      .map(([, displayName]) => displayName)
      .join(", ");
    throw new IntegrationError(
      "InvalidRequest",
      `${field} "${query}" matches ${matches.length} Jira users (${names}); pass the ${identifierName(dialect.deployment)} an issue reported`,
    );
  }

  /**
   * The site's field schema, read only when an issue read was asked to name
   * custom fields. It is not cached: the same site answers a different list to
   * two users with different permissions, and a cross-user cache would be a leak
   * for the sake of one call.
   */
  private async fieldNames(
    site: JiraSite,
    credential: JiraCredential,
  ): Promise<ReadonlyMap<string, string>> {
    const fields = await this.transport.getJson<unknown>(
      site,
      credential,
      jiraOperationPath("fields.list", site.deploymentType) ?? "",
    );
    const names = new Map<string, string>();
    if (!Array.isArray(fields)) return names;
    for (const entry of fields) {
      if (typeof entry !== "object" || entry === null) continue;
      const record = entry as Record<string, unknown>;
      const id = record["id"];
      const name = record["name"];
      if (typeof id === "string" && typeof name === "string" && name !== "") {
        names.set(id, name);
      }
    }
    return names;
  }

  /**
   * The provider speaks the deployment type the operator declared, and a site
   * that answers the other product is refused instead of being read as if it
   * were compatible. The two Jiras are different APIs — different roots,
   * different authentication, different answers for the same read — so a probe
   * happens once, at connect, and the message tells the operator which value to
   * set. A site that does not serve the endpoint at all — an older tenant, a
   * proxy that hides it — is left to the identity call that already succeeded
   * instead of failing on a probe that proves nothing either way.
   */
  private async requireDeployment(
    site: JiraSite,
    credential: JiraCredential,
    dialect: JiraDialect,
  ): Promise<void> {
    let info: Record<string, unknown>;
    try {
      info = await this.transport.getJson<Record<string, unknown>>(
        site,
        credential,
        jiraCompanionPath("serverInfo", site.deploymentType),
      );
    } catch (error) {
      if (
        error instanceof IntegrationError &&
        (error.code === "ResourceNotFound" ||
          error.code === "ProviderPermissionDenied")
      ) {
        return;
      }
      throw error;
    }
    const deployment = info["deploymentType"];
    assertDeployment(dialect, typeof deployment === "string" ? deployment : "");
  }

  private resolveSite(requested: string | undefined): JiraSite {
    const flags = this.config.jira;
    const id = requested?.trim();
    if (id !== undefined && id !== "") {
      const site = jiraSite(flags, id);
      if (site === undefined) {
        throw new IntegrationError("InvalidCredential", "Unknown Jira site");
      }
      return site;
    }
    const [only] = flags.sites;
    if (only === undefined) {
      throw new IntegrationError(
        "InvalidCredential",
        "No Jira site is configured",
      );
    }
    if (flags.sites.length > 1) {
      throw new IntegrationError("InvalidCredential", "Choose a Jira site");
    }
    return only;
  }
}

/**
 * Whether one caller-named project stays inside the deployment's boundary. The
 * boundary lists project keys, and a Jira project key compares case-insensitively
 * upstream while an operator may type it in any case, so the match normalizes
 * the case; a listed numeric id matches exactly. A project key that is not
 * listed never widens into its issues: `PROJ` does not cover `PROJX`.
 */
export function projectAllowed(
  boundary: ServiceResourceBoundary,
  ref: string,
): boolean {
  if (boundaryHas(boundary, JIRA_RESOURCE_KIND, ref)) return true;
  const key = ref.trim().toUpperCase();
  if (key === "") return false;
  return (boundary[JIRA_RESOURCE_KIND] ?? []).some(
    (entry) => entry.trim().toUpperCase() === key,
  );
}

/** One refusal shape, so every boundary denial of this provider reads the same. */
function serviceRefusal(): IntegrationError {
  return new IntegrationError(
    "ServiceResourceNotAllowed",
    "Service mode reads only the projects this workspace is allowed to see",
  );
}

/** One search hit as the API returned it, without trusting its projection. */
function readableServiceHit(
  boundary: ServiceResourceBoundary,
  item: unknown,
): boolean {
  if (typeof item !== "object" || item === null) return false;
  const source = item as Record<string, unknown>;
  if (restricted(source)) return false;
  const fields = recordOf(source["fields"]);
  return rawProjectAllowed(boundary, fields["project"]);
}

/** One project as the API reported it: matched by key or by id. */
function rawProjectAllowed(
  boundary: ServiceResourceBoundary,
  item: unknown,
): boolean {
  if (typeof item !== "object" || item === null) return false;
  const source = item as Record<string, unknown>;
  const key = source["key"];
  if (typeof key === "string" && projectAllowed(boundary, key)) return true;
  const id = source["id"];
  return (
    (typeof id === "number" && projectAllowed(boundary, String(id))) ||
    (typeof id === "string" && projectAllowed(boundary, id))
  );
}

/**
 * The bounded search answer. The page is filtered after it arrived — Jira's
 * cursor stays its own — so a page may come back shorter than the limit asked
 * for, and the next page is asked for with the same token.
 */
function boundedSearchResults(
  data: unknown,
  boundary: ServiceResourceBoundary,
): unknown {
  if (typeof data !== "object" || data === null) return data;
  const source = data as Record<string, unknown>;
  if (!Array.isArray(source["issues"])) return source;
  return {
    ...source,
    issues: source["issues"].filter((item) =>
      readableServiceHit(boundary, item),
    ),
  };
}

/** A `security` level on the answer means Jira itself closes the issue off. */
function restricted(source: Record<string, unknown>): boolean {
  const level = recordOf(source["fields"])["security"];
  return level !== null && level !== undefined;
}

/** Map an upstream failure of the probe onto a health status. */
export default JiraProvider;
