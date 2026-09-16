import type { ResolvedQaIntegrationsConfig } from "../../config.js";
import { IntegrationError } from "../../errors.js";
import type {
  IntegrationCapability,
  IntegrationCapabilityInfo,
  ProviderValidation,
} from "../../types.js";
import type { IntegrationProvider, ProviderContext } from "../contract.js";
import {
  JIRA_CAPABILITY_INFO,
  JIRA_OPERATIONS,
  enabledCapabilities,
  jiraOperationCapability,
} from "./catalog.js";
import {
  CUSTOM_FIELD_ID,
  jiraSite,
  type JiraFlags,
  type JiraSite,
} from "./config.js";
import { needsUserLookup } from "./jql.js";
import {
  JIRA_HANDLERS,
  JIRA_PROJECTIONS,
  requestedIncludes,
  wantsFieldNames,
} from "./operations.js";
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
 * Jira Cloud API tokens are either the classic 24-character form or the newer
 * prefixed one (`ATATT…`, base64url-ish and long). A pasted URL, a YAML snippet
 * or an `email:token` pair is refused before anything is sent upstream.
 */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,512}$/u;
/** The Atlassian account an API token is spent as. Not a secret; not a host. */
const EMAIL_SHAPE = /^[^\s@]{1,128}@[^\s@]{1,190}$/u;

const NO_INCLUDES: readonly string[] = Object.freeze([]);

/** Deployment types this provider speaks to. Data Center is a different API. */
const CLOUD_DEPLOYMENT = "Cloud";

function accountName(displayName: string | undefined, email: string): string {
  return displayName === undefined || displayName === ""
    ? email
    : `${displayName} (${email})`;
}

/**
 * Jira Cloud provider: operator-configured sites over an Atlassian API token.
 *
 * The token is spent against the site the credential names, and that site is
 * re-resolved from operator config on every call, so a site the deployment
 * removed or repointed closes the connection instead of redirecting it.
 */
export class JiraProvider implements IntegrationProvider {
  readonly id = "jira";
  readonly displayName = "Jira";
  /** What this deployment allows; Jira's own permissions narrow it upstream. */
  readonly capabilities: readonly IntegrationCapability[];
  readonly capabilityInfo: Readonly<
    Record<IntegrationCapability, IntegrationCapabilityInfo>
  > = JIRA_CAPABILITY_INFO;

  private readonly transport: JiraTransport;

  constructor(
    private readonly config: ResolvedQaIntegrationsConfig,
    fetcher: typeof fetch = fetch,
  ) {
    this.transport = new JiraTransport(config, config.jira, fetcher);
    this.capabilities = Object.freeze(enabledCapabilities(config.jira));
  }

  /**
   * Keep the token, the account it belongs to and the site it was minted for.
   * Both non-secret choices come from the connect form and from operator config,
   * never from a tool argument, which is what keeps the broker from dialling any
   * host the caller names.
   */
  parseCredential(
    raw: string,
    options?: Readonly<Record<string, string>>,
  ): { readonly credential: string; readonly portal: string } {
    const token = raw.trim();
    if (!TOKEN_SHAPE.test(token)) {
      throw new IntegrationError(
        "InvalidCredential",
        "Use an Atlassian API token",
      );
    }
    const email = (options?.["email"] ?? "").trim();
    if (!EMAIL_SHAPE.test(email)) {
      throw new IntegrationError(
        "InvalidCredential",
        "Use the e-mail of the Atlassian account the token belongs to",
      );
    }
    const site = this.resolveSite(options?.["siteId"]);
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

  async validate(context: ProviderContext): Promise<ProviderValidation> {
    const credential = credentialFromPlaintext(context.credential);
    const site = credentialSite(this.config.jira, credential);
    const myself = await this.transport.getJson<Record<string, unknown>>(
      site,
      credential,
      "/rest/api/3/myself",
    );
    const accountId = myself["accountId"];
    if (typeof accountId !== "string" || accountId === "") {
      throw new IntegrationError(
        "ProviderUnavailable",
        "Provider identity is unavailable",
      );
    }
    await this.requireCloud(site, credential);
    const email =
      typeof myself["emailAddress"] === "string" &&
      myself["emailAddress"] !== ""
        ? myself["emailAddress"]
        : credential.email;
    const displayName =
      typeof myself["displayName"] === "string" ? myself["displayName"] : "";
    return {
      tenantId: site.baseUrl,
      externalUserId: accountId,
      displayName: accountName(displayName, email),
      // Jira reports no granted scopes for an API token, so the deployment
      // switches are the whole local boundary and the site's own permissions
      // decide upstream.
      capabilities: this.capabilities,
    };
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
          )
        : input;
    const request = handler(prepared, {
      externalUserId: context.externalUserId,
      flags,
    });
    const include =
      operation === "issues.get"
        ? requestedIncludes(input["include"])
        : NO_INCLUDES;
    const data = await this.transport.getJson<unknown>(
      site,
      credential,
      request.path,
      request.query,
    );
    // The schema is read only after the issue answered and only when the model
    // asked for named custom fields: an issue that is not there has nothing to
    // name, and the extra call would have been spent for nothing.
    const fieldNames =
      wantsFieldNames(include) && flags.fieldsRead
        ? await this.fieldNames(site, credential)
        : undefined;
    const projection = JIRA_PROJECTIONS[operation];
    const projected =
      projection === undefined
        ? data
        : projection(data, {
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
   * Replace a person's name with the account id Jira filters on, for the two
   * filters that can carry one. `me` and an account id are already what Jira
   * wants and cost no call.
   *
   * The directory is a read of the site's own user list, bounded to ten hits,
   * and its answer is never handed to the model: it only decides the id the
   * query is built from. A name nobody matches, or a name several people share,
   * is refused with what to do next — an account id from an issue — because the
   * alternative is a query that quietly answers "no such issues".
   */
  private async resolvePeople(
    site: JiraSite,
    credential: JiraCredential,
    input: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<Record<string, unknown>>> {
    const resolved: Record<string, unknown> = { ...input };
    for (const field of ["assignee", "reporter"] as const) {
      const value = input[field];
      if (!needsUserLookup(value)) continue;
      resolved[field] = await this.accountIdFor(
        site,
        credential,
        field,
        String(value).trim(),
      );
    }
    return resolved;
  }

  private async accountIdFor(
    site: JiraSite,
    credential: JiraCredential,
    field: string,
    query: string,
  ): Promise<string> {
    const users = await this.transport.getJson<unknown>(
      site,
      credential,
      "/rest/api/3/user/search",
      { query, maxResults: 10 },
    );
    const byId = new Map<string, string>();
    for (const entry of Array.isArray(users) ? users : []) {
      if (typeof entry !== "object" || entry === null) continue;
      const record = entry as Record<string, unknown>;
      const accountId = record["accountId"];
      if (typeof accountId !== "string" || accountId === "") continue;
      if (record["active"] === false) continue;
      const displayName =
        typeof record["displayName"] === "string"
          ? record["displayName"]
          : accountId;
      byId.set(accountId, displayName);
    }
    const matches = [...byId.entries()];
    if (matches.length === 1 && matches[0] !== undefined) return matches[0][0];
    if (matches.length === 0) {
      throw new IntegrationError(
        "InvalidRequest",
        `${field} matches no Jira user named "${query}"; pass the accountId an issue reported, or "me"`,
      );
    }
    const names = matches
      .slice(0, 3)
      .map(([, displayName]) => displayName)
      .join(", ");
    throw new IntegrationError(
      "InvalidRequest",
      `${field} "${query}" matches ${matches.length} Jira users (${names}); pass the accountId an issue reported`,
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
      "/rest/api/3/field",
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
   * The provider speaks the Cloud-only `/rest/api/3` surface. A Data Center
   * instance answers a different API, and the specification forbids treating it
   * as silently compatible, so the deployment type is checked once, at connect:
   * a site that names a type other than Cloud is refused. A site that does not
   * serve the endpoint at all — an older tenant, a proxy that hides it — is left
   * to the identity call that already succeeded instead of failing on a probe
   * that proves nothing either way.
   */
  private async requireCloud(
    site: JiraSite,
    credential: JiraCredential,
  ): Promise<void> {
    let info: Record<string, unknown>;
    try {
      info = await this.transport.getJson<Record<string, unknown>>(
        site,
        credential,
        "/rest/api/3/serverInfo",
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
    if (typeof deployment !== "string" || deployment === "") return;
    if (deployment !== CLOUD_DEPLOYMENT) {
      throw new IntegrationError(
        "InvalidCredential",
        `Jira ${deployment} is not supported; this provider speaks Jira Cloud`,
      );
    }
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

export default JiraProvider;
