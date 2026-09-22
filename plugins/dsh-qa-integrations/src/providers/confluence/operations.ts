import {
  invalid,
  optionalBoolean,
  optionalInteger,
  optionalText,
  requiredDate,
  requiredStringList,
} from "../../coerce.js";
import { IntegrationError } from "../../errors.js";
import {
  arrayOf,
  booleanOf,
  compact,
  numberOf,
  recordOf,
  stringOf,
} from "../shared/payload.js";
import { adfToText, textBudget } from "./adf.js";
import type { ConfluenceInstance, ConfluenceFlags } from "./config.js";
import type { ConfluenceDialect, ConfluenceQuery } from "./dialect.js";
import {
  CONTENT_TYPES,
  ORDER_BY,
  buildCql,
  type ConfluenceOrder,
} from "./cql.js";
import { storageToText } from "./storage.js";

/** Confluence page and comment ids are decimal, and only that. */
const NUMERIC_ID = /^\d{1,20}$/u;
/** A space key or id, as it travels inside a path segment. */
const SPACE_REF = /^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$/u;
/** An opaque cursor Confluence itself handed out; never a URL or a path. */
const UPSTREAM_CURSOR = /^[A-Za-z0-9+/=_.:-]{1,400}$/u;

/** Rows one answer asks for when the model names no `limit`. */
export const DEFAULT_LIMIT = 20;
/** Deepest offset a search may walk to; search pagination is not a crawl API. */
const MAX_START = 10_000;
/** Floor for a requested body budget, so a tiny number is not a silent zero. */
const MIN_BODY_CHARS = 100;

/** A page or comment id, accepted as a number or as its decimal digits. */
export function numericId(value: unknown, field: string): string {
  const text =
    typeof value === "number" && Number.isInteger(value)
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";
  if (!NUMERIC_ID.test(text)) invalid(field);
  return text;
}

/** A space key or numeric id, as `confluence_get_space` accepts either. */
export function spaceRef(value: unknown, field = "space"): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!SPACE_REF.test(text)) invalid(field);
  return text;
}

/** Whether a space reference is the numeric id v2 wants in a path. */
export function isNumericSpace(value: string): boolean {
  return NUMERIC_ID.test(value);
}

/** Space keys the model named, upper-cased the way CQL and the policy spell them. */
export function spaceKeys(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  return requiredStringList(value, field, 20, 255).map((key) =>
    key.toUpperCase(),
  );
}

/** Content types, validated against what CQL accepts. */
function contentTypes(value: unknown): string[] {
  return requiredStringList(value, "contentTypes", 2, 16).filter((type) =>
    (CONTENT_TYPES as readonly string[]).includes(type),
  );
}

function ordering(value: unknown): ConfluenceOrder | undefined {
  const text = optionalText(value, "orderBy", 3, 16);
  if (text === undefined) return undefined;
  if (text === "relevance") return undefined;
  if (text in ORDER_BY) return text as ConfluenceOrder;
  return invalid("orderBy");
}

/**
 * Rows per answer. A `limit` above the deployment cap is clamped rather than
 * refused: the answer says how many rows it carries, so the model can page on
 * without having to guess what this stand allows.
 */
export function pageLimit(value: unknown, flags: ConfluenceFlags): number {
  const requested = optionalInteger(value, "limit", 1, 100_000);
  return Math.min(requested ?? DEFAULT_LIMIT, flags.maxResults);
}

/** Character budget of one body, bounded by the deployment ceiling. */
export function bodyLimit(value: unknown, flags: ConfluenceFlags): number {
  const requested = optionalInteger(
    value,
    "maxChars",
    MIN_BODY_CHARS,
    flags.maxBodyChars,
  );
  return requested ?? Math.min(flags.defaultBodyChars, flags.maxBodyChars);
}

/**
 * Search pagination is offset-based, so its cursor is the row offset the
 * previous answer ended at. It carries no identity: every call re-resolves the
 * account and the space policy from the session, so an offset cannot reach
 * another user's data.
 */
export function offsetCursor(value: unknown): number {
  if (value === undefined) return 0;
  const text =
    typeof value === "number" && Number.isInteger(value)
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";
  if (!NUMERIC_ID.test(text)) invalid("cursor");
  const offset = Number(text);
  if (!Number.isFinite(offset) || offset > MAX_START) invalid("cursor");
  return offset;
}

/**
 * v2 pagination is cursor-based and a v1 listing is offset-based, so the shape
 * of a continuation token depends on the product that issued it. Both are
 * shape-checked before they are spent, and neither is ever a URL.
 */
export function listingCursor(
  value: unknown,
  dialect: ConfluenceDialect,
): string | undefined {
  if (value === undefined) return undefined;
  if (dialect.deployment === "server") return String(offsetCursor(value));
  return upstreamCursor(value);
}

/** v2 pagination is cursor-based; the token is shape-checked before it is spent. */
export function upstreamCursor(value: unknown): string | undefined {
  const text = optionalText(value, "cursor", 1, 400);
  if (text === undefined) return undefined;
  if (!UPSTREAM_CURSOR.test(text)) invalid("cursor");
  return text;
}

/**
 * A relative window, as the search shorthand spells it: `-7d`, `-2w`, `-1m`,
 * `-1y`. The question "what changed this week" is the common one, and an agent
 * whose system prompt carries no clock cannot turn it into a date — so the
 * provider accepts the window and resolves it against its own clock.
 */
const RELATIVE_WINDOW = /^-(\d{1,4})([dwmy])$/u;
/** Longest window a shorthand may name, so a typo cannot scan the whole site. */
const MAX_WINDOW_DAYS = 3_650;
const MS_PER_DAY = 86_400_000;

/**
 * The inclusive lower bound on `lastmodified`, either as an absolute date or as
 * a window counted back from today. Resolution happens here, once, so the CQL
 * the provider builds is always an absolute date.
 */
export function modifiedAfterDate(
  value: unknown,
  today: Date = new Date(),
): string | undefined {
  if (value === undefined) return undefined;
  const text = optionalText(value, "modifiedAfter", 3, 10);
  if (text === undefined) return undefined;
  const match = RELATIVE_WINDOW.exec(text);
  if (match === null) return requiredDate(value, "modifiedAfter");
  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isInteger(amount) || amount < 1) invalid("modifiedAfter");
  const days =
    unit === "d"
      ? amount
      : unit === "w"
        ? amount * 7
        : unit === "m"
          ? amount * 30
          : amount * 365;
  if (days > MAX_WINDOW_DAYS) invalid("modifiedAfter");
  return new Date(today.getTime() - days * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

export const COMMENT_KINDS = Object.freeze([
  "footer",
  "inline",
  "all",
] as const);

export type ConfluenceCommentKind = (typeof COMMENT_KINDS)[number];

/** Comment kind, defaulting to the page's footer discussion. */
export function commentKind(value: unknown): ConfluenceCommentKind {
  const text = optionalText(value, "kind", 3, 6) ?? "footer";
  if (!(COMMENT_KINDS as readonly string[]).includes(text)) invalid("kind");
  return text as ConfluenceCommentKind;
}

/** Collections a kind reads; `all` is the two of them, in this order. */
export function commentCollections(
  kind: ConfluenceCommentKind,
): readonly ("footer" | "inline")[] {
  return kind === "all" ? ["footer", "inline"] : [kind];
}

/** The page-relative collection path of one comment kind, on this product. */
export function commentPath(
  dialect: ConfluenceDialect,
  pageId: string,
  kind: "footer" | "inline",
  cursor: string | undefined,
  limit: number,
): ConfluenceRequest {
  return dialect.commentPath({ pageId, kind, cursor, limit });
}

/** The replies of one comment; the collection decides which endpoint owns them. */
export function commentChildrenPath(
  dialect: ConfluenceDialect,
  kind: "footer" | "inline",
  commentId: string,
  cursor: string | undefined,
  limit: number,
): ConfluenceRequest {
  return dialect.commentChildrenPath({ commentId, kind, cursor, limit });
}

export const SPACE_TYPES: readonly string[] = Object.freeze([
  "global",
  "personal",
  "collaboration",
  "knowledge_base",
]);

export interface OperationContext {
  /**
   * External user id of the credential owner, read from the stored integration.
   * Confluence cannot express "mine" through CQL for every account shape, so no
   * operation substitutes it for a model argument; it is part of the contract
   * for providers that need it.
   */
  readonly externalUserId?: string | undefined;
  readonly flags: ConfluenceFlags;
  /** The product this instance is, which decides endpoints and paging. */
  readonly dialect: ConfluenceDialect;
}

export interface ConfluenceRequest {
  readonly path: string;
  readonly query: ConfluenceQuery;
}

export type ConfluenceOperationHandler = (
  input: Readonly<Record<string, unknown>>,
  context: OperationContext,
) => ConfluenceRequest;

/**
 * Every handler builds a request out of validated arguments: the path is a
 * fixed string with our own placeholders filled, and every query value is
 * either a constant, a number, or a value this module checked first.
 */
export const CONFLUENCE_HANDLERS: Readonly<
  Record<string, ConfluenceOperationHandler>
> = Object.freeze({
  "connection.get": (_input, context) => ({
    path: context.dialect.currentUserPath,
    query: {},
  }),

  "search.run": (input, context) => {
    const allowed = context.flags.allowedSpaces;
    const requested = spaceKeys(input["spaces"], "spaces");
    // A space outside the operator allowlist is refused here rather than
    // silently dropped: the model asked for something it may not have, and the
    // honest answer is a refusal it can learn from.
    for (const key of requested) {
      if (allowed.length > 0 && !allowed.includes(key)) {
        throw new IntegrationError(
          "OperationDeniedByPolicy",
          "Space is outside the allowlist of this deployment",
        );
      }
    }
    const cql = buildCql({
      query: optionalText(input["query"], "query", 1, 400),
      spaces: requested.length > 0 ? requested : allowed,
      contentTypes:
        input["contentTypes"] === undefined
          ? undefined
          : contentTypes(input["contentTypes"]),
      labels:
        input["labels"] === undefined
          ? undefined
          : requiredStringList(input["labels"], "labels", 20, 255),
      creator: optionalText(input["creator"], "creator", 1, 255),
      contributor: optionalText(input["contributor"], "contributor", 1, 255),
      modifiedAfter: modifiedAfterDate(input["modifiedAfter"]),
      orderBy: ordering(input["orderBy"]),
    });
    // A CQL search is offset-paged on both products, so its cursor is the row
    // offset the previous answer ended at.
    return context.dialect.searchPath({
      cql,
      start: offsetCursor(input["cursor"]),
      limit: pageLimit(input["limit"], context.flags),
      includeArchived: optionalBoolean(
        input["includeArchived"],
        "includeArchived",
      ),
    });
  },

  "spaces.list": (input, context) => {
    const allowed = context.flags.allowedSpaces;
    const requested = spaceKeys(input["keys"], "keys");
    for (const key of requested) {
      if (allowed.length > 0 && !allowed.includes(key)) {
        throw new IntegrationError(
          "OperationDeniedByPolicy",
          "Space is outside the allowlist of this deployment",
        );
      }
    }
    const keys = requested.length > 0 ? requested : allowed;
    const type = optionalText(input["type"], "type", 3, 32);
    if (type !== undefined && !SPACE_TYPES.includes(type)) invalid("type");
    return context.dialect.spaceList({
      keys,
      type,
      cursor: listingCursor(input["cursor"], context.dialect),
      limit: pageLimit(input["limit"], context.flags),
    });
  },

  "spaces.get": (input, context) =>
    // A key is looked up through the listing endpoint, so the model still gets
    // to speak in keys without the request ever holding a caller-shaped path.
    context.dialect.spacePath(spaceRef(input["space"])),

  "pages.get": (input, context) =>
    context.dialect.pagePath(numericId(input["pageId"], "pageId")),

  "pages.comments": (input, context) => {
    // Cloud declares the footer collection and `kind` picks between the two
    // fixed paths; a Server / Data Center installation keeps both kinds in one
    // collection and marks each comment, so the kind travels as a query the
    // provider filters on after the read.
    const kind = commentKind(input["kind"]);
    const pageId = numericId(input["pageId"], "pageId");
    const requested = commentCollections(kind)[0] ?? "footer";
    return context.dialect.commentPath({
      pageId,
      kind: requested,
      cursor: listingCursor(input["cursor"], context.dialect),
      limit: pageLimit(input["limit"], context.flags),
    });
  },

  "pages.attachments": (input, context) =>
    context.dialect.attachmentPath({
      pageId: numericId(input["pageId"], "pageId"),
      cursor: listingCursor(input["cursor"], context.dialect),
      limit: pageLimit(input["limit"], context.flags),
    }),

  "pages.versions": (input, context) =>
    context.dialect.versionPath({
      pageId: numericId(input["pageId"], "pageId"),
      cursor: listingCursor(input["cursor"], context.dialect),
      limit: pageLimit(input["limit"], context.flags),
    }),
});

/**
 * A page URL a person can open. Confluence answers `_links.webui` as an
 * absolute *path* relative to the product's own root: under the site's `/wiki`
 * on Cloud, under the installation's own context path — which its `baseUrl`
 * already names — on Server / Data Center. Resolving that path the wrong way
 * would hand the model a link that 404s. A deployment configured with the
 * Atlassian gateway base has no site origin to name, and answering with a
 * gateway URL would be worse than answering with none.
 */
function humanUrl(
  relative: string | undefined,
  declaredBase: string | undefined,
  instance: ConfluenceInstance,
): string | undefined {
  if (relative === undefined) return undefined;
  if (/^https?:\/\//u.test(relative)) return relative;
  const declared = declaredBase?.trim();
  const declaredIsSite =
    declared !== undefined &&
    /^https?:\/\//u.test(declared) &&
    new URL(declared).host !== "api.atlassian.com";
  // A gateway instance, such as the one scoped API tokens need, has no site
  // origin of its own to name.
  const site =
    new URL(instance.baseUrl).host === "api.atlassian.com"
      ? undefined
      : instance.baseUrl;
  const root =
    site === undefined
      ? undefined
      : instance.deploymentType === "server"
        ? site
        : `${site}/wiki`;
  const base = declaredIsSite
    ? declared
    : declared !== undefined && !/^https?:\/\//u.test(declared)
      ? site === undefined
        ? undefined
        : `${site}${declared}`
      : root;
  if (base === undefined) return undefined;
  return relative.startsWith("/")
    ? `${base.replace(/\/+$/u, "")}${relative}`
    : `${base.replace(/\/+$/u, "")}/${relative}`;
}

/**
 * Any text taken from Confluence, with the budget that applies to it. One
 * shape everywhere, so a reader can tell content from metadata without
 * knowing which tool produced the answer.
 */
function contentBlock(
  text: string,
  limit: number,
  format: "markdown-like" | "plain",
): Record<string, unknown> {
  return { format, ...textBudget(text, limit) };
}

/**
 * A page body of either product, as text. Cloud answers Atlassian Document
 * Format, a Server / Data Center installation answers storage markup, and both
 * arrive under `body`: the two are rendered by their own reader so an answer
 * reads the same whichever product produced it.
 */
function bodyOf(source: Record<string, unknown>): string {
  const body = recordOf(source["body"]);
  const storage = recordOf(body["storage"]);
  const storageValue = storage["value"];
  if (storageValue !== undefined) return storageToText(storageValue);
  const adf = recordOf(body["atlas_doc_format"]);
  return adfToText(adf["value"]);
}

/**
 * One person of either product. Cloud names an account id, a Server / Data
 * Center installation the user name and key its directory uses, so both are
 * carried and whichever the product did not send stays absent.
 */
function personRef(value: unknown): Record<string, unknown> | undefined {
  const source = recordOf(value);
  if (Object.keys(source).length === 0) return undefined;
  const picked = compact({
    accountId: stringOf(source, "accountId"),
    name: stringOf(source, "username") ?? stringOf(source, "name"),
    userKey: stringOf(source, "userKey") ?? stringOf(source, "key"),
    displayName: stringOf(source, "displayName"),
  });
  return Object.keys(picked).length === 0 ? undefined : picked;
}

/** The version of one page or comment, as either product spells it. */
function versionOf(value: unknown): Record<string, unknown> {
  const version = recordOf(value);
  return compact({
    number: numberOf(version, "number"),
    // Cloud dates a version when it was made; a v1 version dates it `when`,
    // which is also the only date a self-hosted page carries at all.
    createdAt: stringOf(version, "createdAt") ?? stringOf(version, "when"),
    message: stringOf(version, "message"),
    authorId: stringOf(version, "authorId"),
    author: personRef(version["by"]),
    minorEdit: booleanOf(version, "minorEdit"),
  });
}

/** Labels arrive as a `results` collection under `labels` or `metadata.labels`. */
function labelNames(value: unknown): string[] | undefined {
  const results = arrayOf(recordOf(value), "results");
  const names = results
    .map((item) => stringOf(recordOf(item), "name"))
    .filter((name): name is string => name !== undefined);
  return names.length === 0 ? undefined : names;
}

/** A numeric identifier as the decimal string every path addresses it by. */
function numberId(value: unknown): string | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : undefined;
}

/** The labels of a page on either product: v2 lists them, v1 nests them. */
function pageLabels(source: Record<string, unknown>): string[] | undefined {
  return (
    labelNames(source["labels"]) ??
    labelNames(recordOf(source["metadata"])["labels"])
  );
}

/**
 * Search excerpts arrive highlighted: the default representation wraps the
 * matched terms in `<span>`. The provider hands the words over, never the
 * markup, and undoes only the five entities a highlight can produce.
 */
export function plainExcerpt(value: string): string {
  return value
    .replace(/<[^>]*>/gu, "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replace(/\s+/gu, " ")
    .trim();
}

/** The space of one search result: content, the flat field, or its breadcrumb. */
function resultSpace(source: Record<string, unknown>): {
  readonly key?: string | undefined;
  readonly name?: string | undefined;
} {
  const content = recordOf(source["content"]);
  const direct = recordOf(content["space"] ?? source["space"]);
  const key = stringOf(direct, "key") ?? keyFromDisplayUrl(source);
  const name =
    stringOf(direct, "name") ??
    stringOf(recordOf(source["resultGlobalContainer"]), "title");
  return { key, name };
}

/** `resultGlobalContainer.displayUrl` is `/spaces/KEY`, so it names the space. */
function keyFromDisplayUrl(
  source: Record<string, unknown>,
): string | undefined {
  const container = recordOf(source["resultGlobalContainer"]);
  const display = stringOf(container, "displayUrl");
  if (display === undefined) return undefined;
  const match = /\/spaces\/([^/?#]+)/u.exec(display);
  return match?.[1];
}

function unwrapResults(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return arrayOf(recordOf(value), "results");
}

/**
 * The spaces of a `spaces.get` answer. A numeric-id read answers the space
 * itself, while the keyed lookup answers a collection with zero or one row.
 */
function spaceMatches(value: unknown): unknown[] {
  const record = recordOf(value);
  if (Array.isArray(record["results"])) return record["results"];
  const looksLikeSpace =
    stringOf(record, "key") !== undefined ||
    stringOf(record, "id") !== undefined;
  return looksLikeSpace ? [record] : [];
}

function searchItem(
  item: unknown,
  context: ConfluenceProjectionContext,
): Record<string, unknown> {
  const source = recordOf(item);
  const content = recordOf(source["content"]);
  const space = resultSpace(source);
  const id = stringOf(content, "id") ?? stringOf(source, "id");
  const excerpt = stringOf(source, "excerpt");
  return compact({
    id,
    type:
      stringOf(content, "type") ??
      stringOf(source, "type") ??
      stringOf(source, "entityType"),
    title: stringOf(content, "title") ?? stringOf(source, "title"),
    space: compact({ key: space.key, name: space.name }),
    modifiedAt:
      stringOf(source, "lastModified") ??
      stringOf(recordOf(content["version"]), "when") ??
      stringOf(recordOf(source["version"]), "when"),
    url: humanUrl(
      stringOf(source, "url") ?? stringOf(recordOf(source["_links"]), "webui"),
      stringOf(recordOf(source["_links"]), "base"),
      context.instance,
    ),
    untrustedContent:
      excerpt === undefined
        ? undefined
        : { format: "text" as const, excerpt: plainExcerpt(excerpt) },
  });
}

/**
 * One comment as the model reads it. The list endpoints carry no author name
 * and no date of their own: Confluence keeps both on the comment's version, so
 * that is where they are read from. Which collection a comment came from is the
 * endpoint on Cloud and the comment's own location marker on a Server / Data
 * Center installation, which keeps both kinds in one collection.
 */
function commentItem(
  item: unknown,
  kind: "footer" | "inline",
  context: ConfluenceProjectionContext,
): Record<string, unknown> {
  const source = recordOf(item);
  const extensions = recordOf(source["extensions"]);
  const marker = stringOf(extensions, "location");
  const text = bodyOf(source);
  return compact({
    id: stringOf(source, "id"),
    kind: marker === "inline" || marker === "footer" ? marker : kind,
    parentCommentId:
      stringOf(source, "parentCommentId") ??
      parentCommentIdOf(source["ancestors"]),
    resolutionStatus: stringOf(source, "resolutionStatus"),
    version: versionOf(source["version"]),
    url: humanUrl(
      stringOf(recordOf(source["_links"]), "webui"),
      stringOf(recordOf(source["_links"]), "base"),
      context.instance,
    ),
    untrustedContent: contentBlock(
      text,
      context.bodyLimit ?? text.length,
      "markdown-like",
    ),
  });
}

/**
 * The comment one reply answers, as a v1 listing reports it: the reply's
 * ancestors are its parent chain, starting at the page. A product that names
 * the parent outright does not need this, and a chain that holds nothing but
 * pages has no comment to name.
 */
function parentCommentIdOf(value: unknown): string | undefined {
  const ancestors = arrayOf({ ancestors: value }, "ancestors");
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = recordOf(ancestors[index]);
    if (stringOf(ancestor, "type") === "page") break;
    const id = stringOf(ancestor, "id");
    if (id !== undefined) return id;
  }
  return undefined;
}

/** The replies of one comment, from a children read of its own. */
export function commentReplies(
  data: unknown,
  kind: "footer" | "inline",
  context: ConfluenceProjectionContext,
): Record<string, unknown>[] {
  return unwrapResults(data).map((item) => commentItem(item, kind, context));
}

function spaceSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    // Cloud spells a space id as a string, a v1 listing as a number; both name
    // the same space and both are handed over as the string it is addressed by.
    id: stringOf(source, "id") ?? numberId(source["id"]),
    key: stringOf(source, "key"),
    name: stringOf(source, "name"),
    type: stringOf(source, "type"),
    status: stringOf(source, "status"),
    homepageId: stringOf(source, "homepageId"),
  });
}

export interface ConfluenceProjectionContext {
  readonly flags: ConfluenceFlags;
  readonly instance: ConfluenceInstance;
  /** Character budget for a body, resolved from the tool argument. */
  readonly bodyLimit?: number | undefined;
  /** Row offset a search answer started at, needed for its own cursor. */
  readonly start?: number | undefined;
  /** Page the answer is about, as the validated tool argument named it. */
  readonly pageId?: string | undefined;
  /** Space resolved for a page, so its key and name travel with the answer. */
  readonly space?: Record<string, unknown> | undefined;
  /** Which collection a comment answer came from. */
  readonly kind?: "footer" | "inline" | undefined;
}

export type ConfluenceProjection = (
  data: unknown,
  context: ConfluenceProjectionContext,
) => Record<string, unknown>;

/** One source block for every answer: identity of the read, never its content. */
export function confluenceSource(
  instance: ConfluenceInstance,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return compact({
    provider: "confluence",
    site: instance.baseUrl,
    ...extra,
  });
}

export const CONFLUENCE_PROJECTIONS: Readonly<
  Record<string, ConfluenceProjection>
> = Object.freeze({
  "connection.get": (data, context) => {
    const source = recordOf(data);
    return {
      source: confluenceSource(context.instance),
      account: compact({
        accountId: stringOf(source, "accountId"),
        name:
          stringOf(source, "username") ??
          stringOf(source, "publicName") ??
          stringOf(source, "userKey"),
        displayName: stringOf(source, "displayName"),
        publicName: stringOf(source, "publicName"),
        email: stringOf(source, "email"),
        accountType: stringOf(source, "accountType"),
        type: stringOf(source, "type"),
      }),
    };
  },

  "search.run": (data, context) => {
    const source = recordOf(data);
    const items = arrayOf(source, "results").map((item) =>
      searchItem(item, context),
    );
    const start = context.start ?? numberOf(source, "start") ?? 0;
    const totalSize = numberOf(source, "totalSize");
    // An empty page never carries a cursor: handing back the offset it started
    // at would let a caller that follows it loop forever.
    const nextCursor =
      items.length > 0 &&
      totalSize !== undefined &&
      start + items.length < totalSize
        ? String(start + items.length)
        : undefined;
    return {
      source: confluenceSource(context.instance),
      items,
      nextCursor,
      totalSize,
    };
  },

  "spaces.list": (data, context) => ({
    source: confluenceSource(context.instance),
    items: unwrapResults(data)
      .map(spaceSummary)
      .filter((space) => spaceWithinPolicy(space, context)),
  }),

  "spaces.get": (data, context) => {
    const matches = spaceMatches(data);
    const space = matches.length === 1 ? matches[0] : undefined;
    if (space === undefined) {
      throw new IntegrationError(
        "ResourceNotFound",
        "Confluence space not found",
      );
    }
    const summary = spaceSummary(space);
    const description = recordOf(
      recordOf(recordOf(space)["description"])["plain"],
    );
    const text = stringOf(description, "value");
    return {
      source: confluenceSource(context.instance),
      space: summary,
      untrustedContent:
        text === undefined
          ? undefined
          : contentBlock(text, context.bodyLimit ?? text.length, "plain"),
    };
  },

  "pages.get": (data, context) => {
    const source = recordOf(data);
    const links = recordOf(source["_links"]);
    const ancestors = arrayOf(source, "ancestors");
    const text = bodyOf(source);
    const budgetLimit = context.bodyLimit ?? text.length;
    const space = context.space ?? {};
    return {
      source: confluenceSource(context.instance, {
        pageId: stringOf(source, "id") ?? context.pageId,
        url: humanUrl(
          stringOf(links, "webui"),
          stringOf(links, "base"),
          context.instance,
        ),
      }),
      page: compact({
        title: stringOf(source, "title"),
        status: stringOf(source, "status"),
        space: compact({
          id: stringOf(space, "id") ?? stringOf(source, "spaceId"),
          key: stringOf(space, "key"),
          name: stringOf(space, "name"),
        }),
        parentId:
          stringOf(source, "parentId") ??
          (ancestors.length === 0
            ? undefined
            : stringOf(recordOf(ancestors[ancestors.length - 1]), "id")),
        // Cloud names the creator outright; a v1 page carries only the version
        // it is at, whose author is the last editor — so the field stays absent
        // rather than claiming the editor created it.
        author: compact({ accountId: stringOf(source, "authorId") }),
        owner: compact({ accountId: stringOf(source, "ownerId") }),
        createdAt: stringOf(source, "createdAt"),
        version: versionOf(source["version"]),
        labels: pageLabels(source),
      }),
      untrustedContent: contentBlock(text, budgetLimit, "markdown-like"),
    };
  },

  "pages.comments": (data, context) => {
    const kind = context.kind ?? "footer";
    return {
      source: confluenceSource(context.instance, {
        pageId: context.pageId,
      }),
      items: unwrapResults(data).map((item) =>
        commentItem(item, kind, context),
      ),
    };
  },

  "pages.attachments": (data, context) => ({
    source: confluenceSource(context.instance, { pageId: context.pageId }),
    items: unwrapResults(data).map((item) => {
      const attachment = recordOf(item);
      const version = recordOf(attachment["version"]);
      const links = recordOf(attachment["_links"]);
      // A v2 attachment carries its type and size at the top level; a v1 one
      // keeps them under `extensions` and its media type under `metadata`.
      const extensions = recordOf(attachment["extensions"]);
      const metadata = recordOf(attachment["metadata"]);
      return compact({
        id: stringOf(attachment, "id"),
        title: stringOf(attachment, "title"),
        mediaType:
          stringOf(attachment, "mediaType") ??
          stringOf(metadata, "mediaType") ??
          stringOf(extensions, "mediaType"),
        fileSize:
          numberOf(attachment, "fileSize") ?? numberOf(extensions, "fileSize"),
        status: stringOf(attachment, "status"),
        versionNumber: numberOf(version, "number"),
        createdAt:
          stringOf(attachment, "createdAt") ?? stringOf(version, "when"),
        authorId:
          stringOf(version, "authorId") ??
          stringOf(recordOf(version["by"]), "username"),
        pageId: stringOf(attachment, "pageId"),
        // Metadata only: a download link is handed over, the bytes are not
        // fetched — whether an attachment body may ever leave Confluence is a
        // deployment decision this read-only provider does not take.
        // v2 hands these over as absolute links; a v1 attachment reports paths
        // relative to the installation's context, so those are resolved here.
        webuiLink:
          stringOf(attachment, "webuiLink") ??
          humanUrl(
            stringOf(links, "webui"),
            stringOf(links, "base"),
            context.instance,
          ),
        downloadLink:
          stringOf(attachment, "downloadLink") ??
          humanUrl(
            stringOf(links, "download"),
            stringOf(links, "base"),
            context.instance,
          ),
      });
    }),
  }),

  "pages.versions": (data, context) => ({
    source: confluenceSource(context.instance, { pageId: context.pageId }),
    items: unwrapResults(data).map((item) => {
      const version = recordOf(item);
      // Only Cloud nests the page inside its version; a v1 version names its
      // content through the expansion this provider asks for.
      const page = recordOf(version["page"] ?? version["content"]);
      return compact({
        number: numberOf(version, "number"),
        message: stringOf(version, "message"),
        createdAt: stringOf(version, "createdAt") ?? stringOf(version, "when"),
        authorId:
          stringOf(version, "authorId") ??
          stringOf(recordOf(version["by"]), "username"),
        author: personRef(version["by"]),
        minorEdit: booleanOf(version, "minorEdit"),
        pageId: stringOf(page, "id") ?? context.pageId,
        title: stringOf(page, "title"),
      });
    }),
  }),
});

/**
 * Whether a projected space passes the operator allowlist. The upstream `keys`
 * filter already narrows the request when the policy is set; this second check
 * makes the answer independent of that filter holding.
 */
function spaceWithinPolicy(
  space: Record<string, unknown>,
  context: ConfluenceProjectionContext,
): boolean {
  const allowed = context.flags.allowedSpaces;
  if (allowed.length === 0) return true;
  const key = typeof space["key"] === "string" ? space["key"] : undefined;
  return key !== undefined && allowed.includes(key.toUpperCase());
}
