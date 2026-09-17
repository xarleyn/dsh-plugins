import {
  resolveCredentialHelp,
  type CredentialHelp,
} from "@yadsh/dsh-plugin-kit";
import type { ResolvedQaIntegrationsConfig } from "../../config.js";
import { IntegrationError } from "../../errors.js";
import type {
  IntegrationCapability,
  IntegrationCapabilityInfo,
  ProviderValidation,
} from "../../types.js";
import type { IntegrationProvider, ProviderContext } from "../contract.js";
import {
  CONFLUENCE_CAPABILITY_INFO,
  CONFLUENCE_OPERATIONS,
  enabledCapabilities,
  confluenceOperationCapability,
} from "./catalog.js";
import { CONFLUENCE_CREDENTIAL_HELP } from "./credential-help.js";
import {
  credentialFromPlaintext,
  credentialInstance,
  ConfluenceTransport,
  type ConfluenceCredential,
} from "./transport.js";
import {
  CONFLUENCE_HANDLERS,
  CONFLUENCE_PROJECTIONS,
  bodyLimit,
  commentChildrenPath,
  commentCollections,
  commentKind,
  commentPath,
  commentReplies,
  confluenceSource,
  numericId,
  offsetCursor,
  pageLimit,
  type ConfluenceProjectionContext,
  type ConfluenceRequest,
} from "./operations.js";
import {
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
 * Atlassian API tokens are long opaque strings, sometimes prefixed. A pasted
 * URL, a YAML snippet or a credential with whitespace is refused before
 * anything is sent upstream.
 */
const TOKEN_SHAPE = /^[A-Za-z0-9._=+/-]{16,512}$/u;
/** The Atlassian account the token belongs to; the pair is what authenticates. */
const EMAIL_SHAPE = /^[^\s@]{1,64}@[^\s@.]+(?:\.[^\s@.]+)+$/u;

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

/** Confluence provider: operator-configured sites over an Atlassian API token. */
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
    const instance = this.resolveInstance(options?.["instanceId"]);
    return {
      credential: JSON.stringify({
        instanceId: instance.id,
        email,
        token,
      } satisfies ConfluenceCredential),
      portal: instance.baseUrl,
    };
  }

  operationCapability(operation: string): IntegrationCapability | undefined {
    return confluenceOperationCapability(operation);
  }

  async validate(context: ProviderContext): Promise<ProviderValidation> {
    const credential = credentialFromPlaintext(context.credential);
    const instance = credentialInstance(this.config.confluence, credential);
    // The connected user is the one read Confluence only serves over v1, and it
    // is also the cheapest proof that this token may use Confluence at all.
    const { data } = await this.transport.getJson<Record<string, unknown>>(
      instance,
      credential,
      "/wiki/rest/api/user/current",
    );
    const accountId =
      textOf(data["accountId"]) ??
      textOf(data["userKey"]) ??
      textOf(data["username"]);
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
    const request = handler(input, {
      externalUserId: context.externalUserId,
      flags,
    });
    if (operation === "pages.get") {
      return this.readPage(instance, credential, request, flags, input);
    }
    if (operation === "pages.comments") {
      return this.readComments(instance, credential, request, flags, input);
    }
    if (operation === "spaces.get") {
      return this.readSpace(instance, credential, request, flags);
    }
    return this.readList(
      instance,
      credential,
      request,
      operation,
      definition.cursor,
      flags,
      input,
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
    // The CQL already restricts the search to allowed spaces, and the space
    // listing asks for them by key. This filter is the second lock: a row whose
    // space cannot be read as an allowed key is dropped rather than shown.
    if (operation === "search.run" && flags.allowedSpaces.length > 0) {
      const items = Array.isArray(answer["items"]) ? answer["items"] : [];
      answer["items"] = items.filter((item) =>
        this.itemSpaceAllowed(item, flags),
      );
    }
    const nextCursor =
      cursorMode === "upstream" ? response.page?.nextCursor : undefined;
    return nextCursor === undefined ? answer : { ...answer, nextCursor };
  }

  /**
   * A page read is answered with the page's space, because that is what the
   * operator allowlist is written in — and a page whose space the policy does
   * not allow is refused here, after the read and before the model sees it.
   */
  private async readPage(
    instance: ConfluenceInstance,
    credential: ConfluenceCredential,
    request: ConfluenceRequest,
    flags: ConfluenceFlags,
    input: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    const projection = CONFLUENCE_PROJECTIONS["pages.get"];
    const response = await this.transport.getJson<Record<string, unknown>>(
      instance,
      credential,
      request.path,
      request.query,
    );
    const spaceId = textOf(response.data["spaceId"]);
    const space =
      spaceId === undefined
        ? {}
        : await this.readSpaceFields(instance, credential, spaceId);
    this.assertSpaceAllowed(flags, textOf(space["key"]));
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
    request: ConfluenceRequest,
    flags: ConfluenceFlags,
    input: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    const projection = CONFLUENCE_PROJECTIONS["pages.comments"];
    const pageId = numericId(input["pageId"], "pageId");
    const kind = commentKind(input["kind"]);
    if (flags.allowedSpaces.length > 0) {
      await this.assertPageAllowedBySpace(instance, credential, pageId, flags);
    }
    const includeReplies =
      typeof input["includeReplies"] === "boolean" && input["includeReplies"];
    const collections = commentCollections(kind);
    const items: unknown[] = [];
    const cursors: Record<string, string> = {};
    let repliesTruncated = false;
    for (const collection of collections) {
      const response = await this.transport.getJson<unknown>(
        instance,
        credential,
        commentPath(pageId, collection),
        request.query,
      );
      const context: ConfluenceProjectionContext = {
        ...this.projectionContext(flags, instance, input),
        pageId,
        kind: collection,
      };
      const projected = projection?.(response.data, context) ?? {};
      const rows = Array.isArray(projected["items"]) ? projected["items"] : [];
      const loaded = includeReplies
        ? await this.withReplies(
            instance,
            credential,
            rows,
            collection,
            flags,
            context,
          )
        : { items: rows, truncated: false };
      repliesTruncated = repliesTruncated || loaded.truncated;
      items.push(...loaded.items);
      const cursor = response.page?.nextCursor;
      if (cursor !== undefined) cursors[collection] = cursor;
    }
    const answer: Record<string, unknown> = {
      source: confluenceSource(instance, { pageId }),
      items,
    };
    if (kind === "all") return { ...answer, cursors, repliesTruncated };
    return {
      ...answer,
      nextCursor: cursors[kind],
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
      const response = await this.transport.getJson<unknown>(
        instance,
        credential,
        commentChildrenPath(collection, numericId(id, "commentId")),
        {
          "body-format": "atlas_doc_format",
          limit: pageLimit(undefined, flags),
          sort: "created-date",
        },
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
    this.assertSpaceAllowed(
      flags,
      typeof space === "object" && space !== null
        ? textOf((space as Record<string, unknown>)["key"])
        : undefined,
    );
    return answer;
  }

  /** The fields a space contributes to a page answer, plus its policy key. */
  private async readSpaceFields(
    instance: ConfluenceInstance,
    credential: ConfluenceCredential,
    spaceId: string,
  ): Promise<Record<string, unknown>> {
    const { data } = await this.transport.getJson<Record<string, unknown>>(
      instance,
      credential,
      // An id that arrived from upstream is not trusted as a path segment.
      `/wiki/api/v2/spaces/${numericId(spaceId, "spaceId")}`,
      {},
    );
    return data;
  }

  /**
   * The space of a page the call is about. Only asked for when the deployment
   * narrowed spaces: without an allowlist there is no policy to enforce, and
   * the extra read would be spent for nothing.
   */
  private async assertPageAllowedBySpace(
    instance: ConfluenceInstance,
    credential: ConfluenceCredential,
    pageId: string,
    flags: ConfluenceFlags,
  ): Promise<void> {
    const { data } = await this.transport.getJson<Record<string, unknown>>(
      instance,
      credential,
      `/wiki/api/v2/pages/${pageId}`,
      {},
    );
    const spaceId = textOf(data["spaceId"]);
    if (spaceId === undefined) {
      throw new IntegrationError(
        "ResourceNotFound",
        "Confluence page not found",
      );
    }
    const space = await this.readSpaceFields(instance, credential, spaceId);
    this.assertSpaceAllowed(flags, textOf(space["key"]));
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
  private itemSpaceAllowed(item: unknown, flags: ConfluenceFlags): boolean {
    const space =
      typeof item === "object" && item !== null
        ? (item as Record<string, unknown>)["space"]
        : undefined;
    const key =
      typeof space === "object" && space !== null
        ? textOf((space as Record<string, unknown>)["key"])
        : undefined;
    // An empty allowlist never reaches here; a row whose space is unreadable
    // fails closed, so a listing can only show what this policy proves.
    return flags.allowedSpaces.length > 0 && spaceAllowed(flags, key);
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

export default ConfluenceProvider;
