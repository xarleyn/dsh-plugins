import {
  resolveCredentialHelp,
  type CredentialHelp,
} from "@yadsh/dsh-plugin-kit";
import type { ResolvedQaIntegrationsConfig } from "../../config.js";
import { IntegrationError, recoverableResource } from "../../errors.js";
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
  serviceResourceDenied,
} from "../shared/service-boundary.js";
import {
  CONFLUENCE_CAPABILITY_INFO,
  CONFLUENCE_OPERATIONS,
  CONFLUENCE_RESOURCE_KIND,
  confluenceOperationCapability,
  confluenceOperationMetadata,
  enabledCapabilities,
} from "./catalog.js";
import { CONFLUENCE_CREDENTIAL_HELP } from "./credential-help.js";
import {
  credentialFromPlaintext,
  credentialInstance,
  ConfluenceTransport,
  type ConfluenceCredential,
} from "./transport.js";
import { dialectOf, type ConfluenceDialect } from "./dialect.js";
import {
  CONFLUENCE_HANDLERS,
  CONFLUENCE_PROJECTIONS,
  SPACE_TYPES,
  bodyLimit,
  commentCollections,
  commentChildrenPath,
  commentKind,
  commentPath,
  commentReplies,
  confluenceSource,
  isNumericSpace,
  listingCursor,
  numericId,
  offsetCursor,
  pageLimit,
  spaceKeys,
  spaceRef,
  type ConfluenceProjectionContext,
  type ConfluenceRequest,
} from "./operations.js";
import {
  confluenceInstance,
  spaceAllowed,
  type ConfluenceFlags,
  type ConfluenceInstance,
} from "./config.js";

export {
  credentialFromPlaintext,
  credentialInstance,
  type ConfluenceCredential,
} from "./transport.js";

/**
 * Atlassian API tokens are long opaque strings, sometimes prefixed; a Server /
 * Data Center personal access token is base64 and may carry `+`, `/` and
 * padding. The shape a connection accepts is the dialect's own. A pasted URL, a
 * YAML snippet or a credential with whitespace is refused before anything is
 * sent upstream.
 */
const EMAIL_SHAPE = /^[^\s@]{1,64}@[^\s@.]+(?:\.[^\s@.]+)+$/u;

/**
 * The `email:token` pair of a deployment-managed secret. Atlassian
 * authenticates HTTP Basic over exactly this string, so it is the form the
 * operator keeps in the secret file or the environment — one record, because
 * the pair must not be assembled from two. The connect form never produces it:
 * it collects the e-mail next to the token, and a pasted pair stays refused.
 */
function splitBasicPair(
  raw: string,
): { readonly email: string; readonly token: string } | undefined {
  const at = raw.indexOf(":");
  if (at <= 0) return undefined;
  const email = raw.slice(0, at);
  if (!EMAIL_SHAPE.test(email)) return undefined;
  return { email, token: raw.slice(at + 1) };
}

/**
 * How many space keys one CQL `space in (...)` clause can carry. A service
 * boundary wider than this cannot be asked for in one search, and a silently
 * truncated one would answer with a lie by omission.
 */
const SEARCH_SPACE_CAP = 20;

/** Page-addressed reads whose answer carries no space of its own to check. */
const PAGE_ADDRESSED: readonly string[] = Object.freeze([
  "pages.attachments",
  "pages.versions",
]);

function accountName(data: Record<string, unknown>): string {
  for (const key of ["displayName", "publicName", "email"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return "Confluence";
}

function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Which collection a comment of the marker dialect belongs to. Cloud hands out
 * one endpoint per kind, so nothing has to be read off the comment there.
 */
function commentMarker(row: unknown): "footer" | "inline" | undefined {
  const value =
    typeof row === "object" && row !== null
      ? (row as Record<string, unknown>)["kind"]
      : undefined;
  return value === "footer" || value === "inline" ? value : undefined;
}

/**
 * The identifier of one user as either product reports it: Cloud names an
 * account id, a Server / Data Center installation the user key and login its
 * directory uses. The same value is what a later read has to name the user by.
 */
function identityOf(data: Record<string, unknown>): string | undefined {
  return (
    textOf(data["accountId"]) ??
    textOf(data["userKey"]) ??
    textOf(data["username"])
  );
}

/**
 * Whether one space key stays inside the deployment's boundary. The profile's
 * `resources.spaces` lists space keys — the same vocabulary the deployment's
 * own allowlist and the CQL speak — and keys are compared case-insensitively,
 * because operator config, the v2 API and CQL spell the same key in different
 * cases.
 */
export function spaceInBoundary(
  boundary: ServiceResourceBoundary,
  key: string | undefined,
): boolean {
  if (key === undefined) return false;
  const normalized = key.trim().toUpperCase();
  if (normalized === "") return false;
  return (boundary[CONFLUENCE_RESOURCE_KIND] ?? []).some(
    (entry) => entry.trim().toUpperCase() === normalized,
  );
}

/**
 * Confluence provider: operator-configured sites over an Atlassian API token
 * (Cloud) or a personal access token (Server / Data Center).
 *
 * Which product answers at a site — and so which endpoints, which
 * authentication scheme and which shape of body this provider speaks — is the
 * site's own declared deployment type, never a guess made at connect or at run
 * time.
 */
export class ConfluenceProvider implements IntegrationProvider {
  readonly id = "confluence";
  readonly displayName = "Confluence";
  /**
   * What this deployment allows. There is no second, per-credential narrowing:
   * an Atlassian API token cannot be asked which scopes it was granted, so
   * these switches are the whole offer, and Confluence's own permissions answer
   * on every call.
   */
  readonly capabilities: readonly IntegrationCapability[];
  readonly capabilityInfo: Readonly<
    Record<IntegrationCapability, IntegrationCapabilityInfo>
  > = CONFLUENCE_CAPABILITY_INFO;
  /** Where the settings card says this provider's credential comes from. */
  readonly credentialHelp: CredentialHelp | null;
  /** Overrides the deployment got wrong; reported once at startup, never fatal. */
  readonly credentialHelpProblems: readonly string[];

  private readonly transport: ConfluenceTransport;

  constructor(
    private readonly config: ResolvedQaIntegrationsConfig,
    fetcher: typeof fetch = fetch,
  ) {
    this.transport = new ConfluenceTransport(
      config,
      config.confluence,
      fetcher,
    );
    this.capabilities = Object.freeze(enabledCapabilities(config.confluence));
    const help = resolveCredentialHelp(
      CONFLUENCE_CREDENTIAL_HELP,
      config.credentialHelp["confluence"],
    );
    this.credentialHelp = help.help;
    this.credentialHelpProblems = help.problems;
  }

  /**
   * Keep the token together with the account it was minted for and the site it
   * belongs to. Both the site and the e-mail come from the connect form and
   * from operator config, never from a tool argument, which is what keeps the
   * broker from dialling any host the caller names or authenticating as any
   * account the caller names.
   *
   * A deployment-managed secret cannot travel with a connect form, so on Cloud
   * it arrives as the Basic pair Atlassian documents (`email:token`); the two
   * forms can never be confused there, because an API token contains neither
   * `@` nor `:`. A Server / Data Center personal access token is the secret
   * alone, and its connection stores an empty e-mail: the instance's declared
   * deployment type is what decides whether an account is required.
   */
  parseCredential(
    raw: string,
    options?: Readonly<Record<string, string>>,
  ): { readonly credential: string; readonly portal: string } {
    // The instance decides what this connection is allowed to look like, so it
    // is resolved before the secret is judged.
    const instance = this.resolveInstance(options?.["instanceId"]);
    const dialect = dialectOf(instance);
    const provided = raw.trim();
    const pair =
      options?.["email"] === undefined ? splitBasicPair(provided) : undefined;
    const token = pair === undefined ? provided : pair.token;
    if (!dialect.tokenShape.test(token)) {
      throw new IntegrationError(
        "InvalidCredential",
        `Use a Confluence ${dialect.credentialLabel}`,
      );
    }
    const email = (
      pair === undefined ? options?.["email"] : pair.email
    )?.trim();
    if (dialect.requiresEmail && !EMAIL_SHAPE.test(email ?? "")) {
      throw new IntegrationError(
        "InvalidCredential",
        "Use the e-mail of the Atlassian account the token belongs to",
      );
    }
    return {
      credential: JSON.stringify({
        instanceId: instance.id,
        email: email ?? "",
        token,
      } satisfies ConfluenceCredential),
      portal: instance.baseUrl,
    };
  }

  operationCapability(operation: string): IntegrationCapability | undefined {
    return confluenceOperationCapability(operation);
  }

  operationMetadata(operation: string): OperationSecurityMetadata | undefined {
    return confluenceOperationMetadata(operation);
  }

  /** Every space-scoped read is bounded by the profile's space keys. */
  resourceBoundaryKind(operation: string): string | undefined {
    return CONFLUENCE_OPERATIONS[operation]?.security
      .requiresResourceBoundary === true
      ? CONFLUENCE_RESOURCE_KIND
      : undefined;
  }

  /**
   * Portal of a configured site. An empty id means "the only site", the same
   * rule `parseCredential` applies, so deployment configuration and the
   * connect form name sites alike.
   */
  instancePortal(instanceId: string): string | undefined {
    const instances = this.config.confluence.instances;
    const id = instanceId.trim();
    if (id === "") {
      return instances.length === 1 ? instances[0]?.baseUrl : undefined;
    }
    return confluenceInstance(this.config.confluence, id)?.baseUrl;
  }

  capabilityServiceState(
    capability: IntegrationCapability,
  ): CapabilityServiceState | undefined {
    return operationCapabilityServiceState(CONFLUENCE_OPERATIONS, capability);
  }

  async validate(context: ProviderContext): Promise<ProviderValidation> {
    const credential = credentialFromPlaintext(context.credential);
    const instance = credentialInstance(this.config.confluence, credential);
    // The connected user is the one read both products serve, and it is also
    // the cheapest proof that this token may use Confluence at all.
    const { data } = await this.transport.getJson<Record<string, unknown>>(
      instance,
      credential,
      dialectOf(instance).currentUserPath,
    );
    const accountId = identityOf(data);
    if (accountId === undefined) {
      throw new IntegrationError(
        "ProviderUnavailable",
        "Provider identity is unavailable",
      );
    }
    return {
      tenantId: instance.baseUrl,
      externalUserId: accountId,
      displayName: accountName(data),
      capabilities: this.capabilities,
    };
  }

  /**
   * Health of a deployment-managed token. The probe reads only the identity
   * endpoint the personal validation reads, so it never changes upstream state;
   * Confluence exposes no token-scope introspection, so the answer is healthy
   * with a warning — the local service ceiling stays the whole local boundary.
   */
  async validateServiceCredential(
    context: ProviderContext,
  ): Promise<ServiceCredentialHealth> {
    const credential = credentialFromPlaintext(context.credential);
    const instance = credentialInstance(this.config.confluence, credential);
    let data: Record<string, unknown>;
    try {
      const response = await this.transport.getJson<Record<string, unknown>>(
        instance,
        credential,
        dialectOf(instance).currentUserPath,
      );
      data = response.data;
    } catch (error) {
      return healthFromFailure(error);
    }
    const id = identityOf(data);
    return {
      status: "healthy",
      ...(id === undefined
        ? {}
        : { upstreamIdentity: { id, label: accountName(data) } }),
      warnings: [
        "Confluence did not report the token scopes; the local service ceiling still applies",
      ],
    };
  }

  async execute(
    context: ProviderContext,
    operation: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const credential = credentialFromPlaintext(context.credential);
    const instance = credentialInstance(this.config.confluence, credential);
    const definition = CONFLUENCE_OPERATIONS[operation];
    const handler = CONFLUENCE_HANDLERS[operation];
    const projection = CONFLUENCE_PROJECTIONS[operation];
    if (
      definition === undefined ||
      handler === undefined ||
      projection === undefined
    ) {
      throw new IntegrationError(
        "InvalidRequest",
        "Unsupported Confluence operation",
      );
    }
    const flags = this.config.confluence;
    // Ceiling first, then the boundary: what the operation is decides before
    // where it may read.
    if (context.credentialSource === "service") {
      assertServiceOperationAllowed(
        definition.security,
        "This Confluence operation is not available through the service credential",
      );
    }
    const boundary = serviceBoundaryOf(context);
    if (boundary !== undefined && operation === "spaces.list") {
      return this.listBoundedSpaces(
        instance,
        credential,
        boundary,
        input,
        flags,
      );
    }
    if (boundary !== undefined && PAGE_ADDRESSED.includes(operation)) {
      // These answers carry no space of their own, so the page's space is
      // resolved first and verified before anything is fetched for the answer.
      // Comments resolve their page inside their own read, a page read inside
      // its own.
      await this.assertPageReachable(
        instance,
        credential,
        numericId(input["pageId"], "pageId"),
        flags,
        boundary,
        dialectOf(instance),
      );
    }
    if (boundary !== undefined && operation === "spaces.get") {
      const ref = spaceRef(input["space"]);
      // A key is refused without a call; a numeric id is resolved to its key
      // by the read itself, which verifies before anything is returned.
      if (!isNumericSpace(ref) && !spaceInBoundary(boundary, ref)) {
        throw serviceResourceDenied();
      }
    }
    // In service mode a search is narrowed to the boundary before the handler
    // builds the CQL, so the restriction travels upstream.
    const prepared =
      boundary !== undefined && operation === "search.run"
        ? this.boundedSearchInput(input, boundary, flags)
        : input;
    const dialect = dialectOf(instance);
    const request = handler(prepared, {
      externalUserId: context.externalUserId,
      flags,
      dialect,
    });
    if (operation === "pages.get") {
      return this.readPage(
        instance,
        credential,
        request,
        flags,
        prepared,
        boundary,
        dialect,
      );
    }
    if (operation === "pages.comments") {
      return this.readComments(
        instance,
        credential,
        flags,
        prepared,
        boundary,
        dialect,
      );
    }
    if (operation === "spaces.get") {
      return this.readSpace(instance, credential, request, flags, boundary);
    }
    return this.readList(
      instance,
      credential,
      request,
      operation,
      definition.cursor,
      flags,
      prepared,
      boundary,
    );
  }

  /** One list read, with its cursor and with the space policy re-applied. */
  private async readList(
    instance: ConfluenceInstance,
    credential: ConfluenceCredential,
    request: ConfluenceRequest,
    operation: string,
    cursorMode: "offset" | "upstream" | undefined,
    flags: ConfluenceFlags,
    input: Readonly<Record<string, unknown>>,
    boundary: ServiceResourceBoundary | undefined,
  ): Promise<Record<string, unknown>> {
    const projection = CONFLUENCE_PROJECTIONS[operation];
    const response = await this.transport.getJson<unknown>(
      instance,
      credential,
      request.path,
      request.query,
    );
    const answer = projection?.(response.data, {
      ...this.projectionContext(flags, instance, input),
      start:
        cursorMode === "offset" ? offsetCursor(input["cursor"]) : undefined,
    }) ?? { source: {} };
    // The CQL already restricts the search to allowed spaces — and, in service
    // mode, to the boundary. This filter is the second lock: a row whose space
    // cannot be read as an allowed key is dropped rather than shown.
    if (
      operation === "search.run" &&
      (flags.allowedSpaces.length > 0 || boundary !== undefined)
    ) {
      const items = Array.isArray(answer["items"]) ? answer["items"] : [];
      answer["items"] = items.filter((item) =>
        this.itemSpaceReachable(item, flags, boundary),
      );
    }
    // An offset-paged read counts its own rows, but the product's own `next`
    // link is authoritative when it has one: it says where the next page really
    // begins, which matters when a row of this page was dropped by a policy.
    const upstream = response.page?.nextCursor;
    const nextCursor =
      cursorMode === "upstream"
        ? upstream
        : ((answer["nextCursor"] as string | undefined) ?? upstream);
    return nextCursor === undefined ? answer : { ...answer, nextCursor };
  }

  /**
   * A page read is answered with the page's space, because that is what the
   * operator allowlist is written in — and a page whose space the policy does
   * not allow is refused here, after the read and before the model sees it. In
   * service mode the boundary is verified on the same resolved space.
   */
  private async readPage(
    instance: ConfluenceInstance,
    credential: ConfluenceCredential,
    request: ConfluenceRequest,
    flags: ConfluenceFlags,
    input: Readonly<Record<string, unknown>>,
    boundary: ServiceResourceBoundary | undefined,
    dialect: ConfluenceDialect,
  ): Promise<Record<string, unknown>> {
    const projection = CONFLUENCE_PROJECTIONS["pages.get"];
    const response = await this.transport.getJson<Record<string, unknown>>(
      instance,
      credential,
      request.path,
      request.query,
    );
    const space = await this.spaceOfPage(
      instance,
      credential,
      response.data,
      dialect,
    );
    this.assertSpaceReachable(flags, textOf(space["key"]), boundary);
    return (
      projection?.(response.data, {
        ...this.projectionContext(flags, instance, input),
        space,
      }) ?? {}
    );
  }

  /**
   * Comments are read per collection: the catalog names the footer one, the
   * validated `kind` picks between footer-only, inline-only and both. Replies
   * cost one request per parent comment, so a discussion wider than the
   * deployment cap is answered with the parents it did load and says so.
   */
  private async readComments(
    instance: ConfluenceInstance,
    credential: ConfluenceCredential,
    flags: ConfluenceFlags,
    input: Readonly<Record<string, unknown>>,
    boundary: ServiceResourceBoundary | undefined,
    dialect: ConfluenceDialect,
  ): Promise<Record<string, unknown>> {
    const projection = CONFLUENCE_PROJECTIONS["pages.comments"];
    const pageId = numericId(input["pageId"], "pageId");
    const kind = commentKind(input["kind"]);
    if (flags.allowedSpaces.length > 0 || boundary !== undefined) {
      await this.assertPageReachable(
        instance,
        credential,
        pageId,
        flags,
        boundary,
        dialect,
      );
    }
    const includeReplies =
      typeof input["includeReplies"] === "boolean" && input["includeReplies"];
    // Cloud keeps the two kinds in two collections, so a kind selects one; a
    // Server / Data Center installation keeps both in one and marks each
    // comment, so every kind is read from that one collection.
    const collections: readonly ("footer" | "inline")[] =
      dialect.commentKinds === "path" ? commentCollections(kind) : ["footer"];
    const cursor = listingCursor(input["cursor"], dialect);
    const limit = pageLimit(input["limit"], flags);
    const items: unknown[] = [];
    const cursors: Record<string, string> = {};
    let repliesTruncated = false;
    for (const collection of collections) {
      const call = commentPath(dialect, pageId, collection, cursor, limit);
      const response = await this.transport.getJson<unknown>(
        instance,
        credential,
        call.path,
        call.query,
      );
      const context: ConfluenceProjectionContext = {
        ...this.projectionContext(flags, instance, input),
        pageId,
        kind: collection,
      };
      const projected = projection?.(response.data, context) ?? {};
      const projectedRows = Array.isArray(projected["items"])
        ? projected["items"]
        : [];
      // The marker dialect answered one collection for every kind, so a kind
      // the caller named is applied to the rows the product marked.
      const rows =
        dialect.commentKinds === "marker" && kind !== "all"
          ? projectedRows.filter((row) => commentMarker(row) === kind)
          : projectedRows;
      const loaded = includeReplies
        ? await this.withReplies(
            instance,
            credential,
            rows,
            collection,
            flags,
            context,
            dialect,
          )
        : { items: rows, truncated: false };
      repliesTruncated = repliesTruncated || loaded.truncated;
      items.push(...loaded.items);
      const next = response.page?.nextCursor;
      if (next !== undefined) cursors[collection] = next;
    }
    const answer: Record<string, unknown> = {
      source: confluenceSource(instance, { pageId }),
      items,
    };
    if (kind === "all") return { ...answer, cursors, repliesTruncated };
    return {
      ...answer,
      nextCursor: cursors[collections[0] ?? "footer"],
      ...(repliesTruncated ? { repliesTruncated: true } : {}),
    };
  }

  /** One children read per parent comment, capped by the deployment. */
  private async withReplies(
    instance: ConfluenceInstance,
    credential: ConfluenceCredential,
    rows: readonly unknown[],
    collection: "footer" | "inline",
    flags: ConfluenceFlags,
    context: ConfluenceProjectionContext,
    dialect: ConfluenceDialect,
  ): Promise<{ readonly items: unknown[]; readonly truncated: boolean }> {
    const cap = Math.max(flags.maxReplyParents, 0);
    const items: unknown[] = [];
    for (const [index, row] of rows.entries()) {
      if (index >= cap) {
        items.push(row);
        continue;
      }
      const id = textOf((row as Record<string, unknown>)["id"]);
      if (id === undefined) {
        items.push(row);
        continue;
      }
      const call = commentChildrenPath(
        dialect,
        // A row of the marker dialect names its own kind; a reply belongs to the
        // collection its parent was read from.
        commentMarker(row) ?? collection,
        numericId(id, "commentId"),
        undefined,
        pageLimit(undefined, flags),
      );
      const response = await this.transport.getJson<unknown>(
        instance,
        credential,
        call.path,
        call.query,
      );
      items.push({
        ...(row as Record<string, unknown>),
        replies: commentReplies(response.data, collection, context),
      });
    }
    return { items, truncated: rows.length > cap };
  }

  /** One space, by id or by the key the listing endpoint resolves. */
  private async readSpace(
    instance: ConfluenceInstance,
    credential: ConfluenceCredential,
    request: ConfluenceRequest,
    flags: ConfluenceFlags,
    boundary: ServiceResourceBoundary | undefined,
  ): Promise<Record<string, unknown>> {
    const projection = CONFLUENCE_PROJECTIONS["spaces.get"];
    const response = await this.transport.getJson<unknown>(
      instance,
      credential,
      request.path,
      request.query,
    );
    const answer =
      projection?.(response.data, {
        flags,
        instance,
        bodyLimit: bodyLimit(undefined, flags),
      }) ?? {};
    const space = answer["space"];
    this.assertSpaceReachable(
      flags,
      typeof space === "object" && space !== null
        ? textOf((space as Record<string, unknown>)["key"])
        : undefined,
      boundary,
    );
    return answer;
  }

  /**
   * A service search is narrowed to the boundary before the handler builds the
   * CQL: an offset-paginated search whose out-of-boundary rows were dropped
   * afterwards would answer pages that shrink and cursors that lose their
   * place. A space the caller names outside the boundary is refused rather
   * than dropped, and the filter in `readList` stays as the second lock.
   */
  private boundedSearchInput(
    input: Readonly<Record<string, unknown>>,
    boundary: ServiceResourceBoundary,
    flags: ConfluenceFlags,
  ): Readonly<Record<string, unknown>> {
    const requested = spaceKeys(input["spaces"], "spaces");
    for (const key of requested) {
      if (!spaceInBoundary(boundary, key)) {
        throw serviceResourceDenied();
      }
    }
    if (requested.length > 0) return input;
    // Without spaces the caller named, the search asks for the boundary itself
    // — still narrowed by the deployment allowlist, which binds the agent
    // whatever credential it spends.
    const allowlist = flags.allowedSpaces;
    const spaces = (boundary[CONFLUENCE_RESOURCE_KIND] ?? [])
      .map((key) => key.trim().toUpperCase())
      .filter((key) => allowlist.length === 0 || allowlist.includes(key));
    // An empty intersection means the two administrator lists disagree; a list
    // wider than one CQL clause cannot be asked for at all. Both refuse rather
    // than answer with an unbounded or silently truncated search.
    if (spaces.length === 0 || spaces.length > SEARCH_SPACE_CAP) {
      throw serviceResourceDenied();
    }
    return { ...input, spaces };
  }

  /**
   * The bounded space listing. A service profile names the spaces it covers,
   * so the listing is built from that list instead of from whatever the shared
   * account can reach; a space the service token cannot see is reported as
   * unavailable rather than silently dropped. The answer does not page: its
   * size is the boundary the administrator defined, not upstream's.
   */
  private async listBoundedSpaces(
    instance: ConfluenceInstance,
    credential: ConfluenceCredential,
    boundary: ServiceResourceBoundary,
    input: Readonly<Record<string, unknown>>,
    flags: ConfluenceFlags,
  ): Promise<Record<string, unknown>> {
    const requested = spaceKeys(input["keys"], "keys");
    for (const key of requested) {
      if (!spaceInBoundary(boundary, key)) {
        throw serviceResourceDenied();
      }
    }
    const allowlist = flags.allowedSpaces;
    const entries = (boundary[CONFLUENCE_RESOURCE_KIND] ?? []).filter((key) => {
      const normalized = key.trim().toUpperCase();
      return (
        (requested.length === 0 || requested.includes(normalized)) &&
        (allowlist.length === 0 || allowlist.includes(normalized))
      );
    });
    if (entries.length === 0) {
      throw serviceResourceDenied();
    }
    const type = textOf(input["type"]);
    if (type !== undefined && !SPACE_TYPES.includes(type)) {
      throw new IntegrationError("InvalidRequest", "type is invalid");
    }
    const projection = CONFLUENCE_PROJECTIONS["spaces.list"];
    const items: unknown[] = [];
    const unavailable: string[] = [];
    for (const key of entries) {
      try {
        const call = dialectOf(instance).spaceList({
          keys: [key],
          type,
          cursor: undefined,
          limit: 2,
        });
        const { data } = await this.transport.getJson<unknown>(
          instance,
          credential,
          call.path,
          call.query,
        );
        const projected = projection?.(data, { flags, instance }) ?? {};
        const rows = Array.isArray(projected["items"])
          ? projected["items"]
          : [];
        items.push(...rows);
      } catch (error) {
        if (!recoverableResource(error)) throw error;
        unavailable.push(key);
      }
    }
    return {
      source: confluenceSource(instance),
      items,
      serviceScoped: true,
      ...(unavailable.length === 0
        ? {}
        : { unavailableResources: unavailable }),
    };
  }

  /** The fields a space contributes to a page answer, plus its policy key. */
  private async readSpaceFields(
    instance: ConfluenceInstance,
    credential: ConfluenceCredential,
    spaceId: string,
    dialect: ConfluenceDialect,
  ): Promise<Record<string, unknown>> {
    const call = dialect.spacePath(numericId(spaceId, "spaceId"));
    const { data } = await this.transport.getJson<Record<string, unknown>>(
      instance,
      credential,
      call.path,
      call.query,
    );
    return data;
  }

  /**
   * The space a page belongs to, as the product reports it. Cloud names the
   * space by an id on the page, so it is resolved with a second read; a
   * Server / Data Center installation carries the space itself on the page, and
   * that read would be spent for nothing.
   */
  private async spaceOfPage(
    instance: ConfluenceInstance,
    credential: ConfluenceCredential,
    page: Record<string, unknown>,
    dialect: ConfluenceDialect,
  ): Promise<Record<string, unknown>> {
    const inline = recordOf(page["space"]);
    if (Object.keys(inline).length > 0) return inline;
    const spaceId = textOf(page["spaceId"]);
    return spaceId === undefined
      ? {}
      : await this.readSpaceFields(instance, credential, spaceId, dialect);
  }

  /**
   * The space of a page the call is about. Asked for whenever a policy needs
   * it: the deployment allowlist, or — in service mode — the boundary, which is
   * always there. Without either there is no policy to enforce, and the extra
   * reads would be spent for nothing.
   */
  private async assertPageReachable(
    instance: ConfluenceInstance,
    credential: ConfluenceCredential,
    pageId: string,
    flags: ConfluenceFlags,
    boundary: ServiceResourceBoundary | undefined,
    dialect: ConfluenceDialect,
  ): Promise<void> {
    const call = dialect.pageSpacePath(pageId);
    const { data } = await this.transport.getJson<Record<string, unknown>>(
      instance,
      credential,
      call.path,
      call.query,
    );
    const space = await this.spaceOfPage(instance, credential, data, dialect);
    const key = textOf(space["key"]);
    if (key === undefined) {
      // A page answer that names no space at all is a page that is not there —
      // or one the credentials may not see, which Confluence answers the same
      // way on purpose.
      throw new IntegrationError(
        "ResourceNotFound",
        "Confluence page not found",
      );
    }
    this.assertSpaceReachable(flags, key, boundary);
  }

  /**
   * Both space policies of one read, in the order a refusal should name them:
   * the deployment allowlist first, the service boundary — when the call runs
   * on the managed credential — second.
   */
  private assertSpaceReachable(
    flags: ConfluenceFlags,
    key: string | undefined,
    boundary: ServiceResourceBoundary | undefined,
  ): void {
    this.assertSpaceAllowed(flags, key);
    if (boundary !== undefined && !spaceInBoundary(boundary, key)) {
      throw serviceResourceDenied();
    }
  }

  /**
   * A space outside the operator allowlist is refused as a policy decision, not
   * as a Confluence permission: the account may well be allowed to read it, and
   * the model should be told which bound it hit.
   */
  private assertSpaceAllowed(
    flags: ConfluenceFlags,
    key: string | undefined,
  ): void {
    if (spaceAllowed(flags, key)) return;
    throw new IntegrationError(
      "OperationDeniedByPolicy",
      "Space is outside the allowlist of this deployment",
    );
  }

  /** The space of one search row, as the projection resolved it. */
  private itemSpaceReachable(
    item: unknown,
    flags: ConfluenceFlags,
    boundary: ServiceResourceBoundary | undefined,
  ): boolean {
    const space =
      typeof item === "object" && item !== null
        ? (item as Record<string, unknown>)["space"]
        : undefined;
    const key =
      typeof space === "object" && space !== null
        ? textOf((space as Record<string, unknown>)["key"])
        : undefined;
    // A row whose space is unreadable fails closed, so a listing can only show
    // what a policy proves: the deployment allowlist, or — in service mode —
    // the boundary as well.
    if (!spaceAllowed(flags, key)) return false;
    return boundary === undefined || spaceInBoundary(boundary, key);
  }

  private projectionContext(
    flags: ConfluenceFlags,
    instance: ConfluenceInstance,
    input: Readonly<Record<string, unknown>>,
  ): ConfluenceProjectionContext {
    return {
      flags,
      instance,
      bodyLimit: bodyLimit(input["maxChars"], flags),
      pageId:
        input["pageId"] === undefined
          ? undefined
          : numericId(input["pageId"], "pageId"),
    };
  }

  private resolveInstance(requested: string | undefined) {
    const flags = this.config.confluence;
    const id = requested?.trim();
    if (id !== undefined && id !== "") {
      const instance = flags.instances.find((item) => item.id === id);
      if (instance === undefined) {
        throw new IntegrationError(
          "InvalidCredential",
          "Unknown Confluence site",
        );
      }
      return instance;
    }
    const [only] = flags.instances;
    if (only === undefined) {
      throw new IntegrationError(
        "InvalidCredential",
        "No Confluence site is configured",
      );
    }
    if (flags.instances.length > 1) {
      throw new IntegrationError(
        "InvalidCredential",
        "Choose a Confluence site",
      );
    }
    return only;
  }
}

/** A missing or forbidden space inside a boundary is reported, not fatal. */
/** Map an upstream failure of the probe onto a health status. */
export default ConfluenceProvider;
