import { IntegrationError } from "../../errors.js";
import {
  CONFLUENCE_COMPANION_PATHS,
  CONFLUENCE_INLINE_COMMENTS_PATH,
  CONFLUENCE_SERVER_COMPANION_PATHS,
  confluenceOperationPath,
} from "./catalog.js";
import type { ConfluenceDeployment, ConfluenceInstance } from "./config.js";

/** The catalog's path of one operation on one product. */
function operationPath(
  operation: string,
  deployment: ConfluenceDeployment,
): string {
  return confluenceOperationPath(operation, deployment) ?? "";
}

/** The same, with one `:placeholder` filled from a value we validated first. */
function fill(
  operation: string,
  deployment: ConfluenceDeployment,
  placeholders: Readonly<Record<string, string>>,
  declared?: string | undefined,
): string {
  let path = declared ?? operationPath(operation, deployment);
  for (const [name, value] of Object.entries(placeholders)) {
    path = path.replace(`:${name}`, value);
  }
  return path;
}

/** The comment collection of one Cloud page, by the kind the caller named. */
function commentCollection(pageId: string, kind: "footer" | "inline"): string {
  const declared =
    kind === "footer"
      ? confluenceOperationPath("pages.comments", "cloud")
      : CONFLUENCE_INLINE_COMMENTS_PATH;
  return fill("pages.comments", "cloud", { pageId }, declared);
}
/**
 * Where one Confluence read lives, and how it pages. Cloud and Server / Data
 * Center are two products behind one name: Cloud answers the v2 API relative to
 * `/wiki` and pages its listings with an opaque cursor, while a self-hosted
 * installation answers its own v1 API relative to `/rest/api` and pages by row
 * offset. Everything that differs is a member of this interface, so an
 * operation asks the dialect where to read instead of deciding for itself which
 * Confluence it is talking to.
 *
 * Nothing here is inferred at run time: the deployment type comes from the
 * operator's instance list, and a connection whose stored credential does not
 * match it is refused.
 */
export interface ConfluenceDialect {
  readonly deployment: ConfluenceDeployment;
  /** What the connect form calls the secret this product accepts. */
  readonly credentialLabel: string;
  /** Shape of one pasteable token, before anything is sent upstream. */
  readonly tokenShape: RegExp;
  /**
   * Whether an account e-mail must travel with the token. Cloud spends an
   * Atlassian API token as HTTP Basic over `email:token`; a Server / Data
   * Center personal access token is a bearer token and needs no account.
   */
  readonly requiresEmail: boolean;
  /** How the name of this product reads in a message. */
  readonly productName: string;
  /**
   * Which page-addressed collection path one comment kind has, or none when the
   * product keeps both kinds in one collection and marks them per comment.
   */
  readonly commentKinds: "path" | "marker";
  /** The identity read a connect proves itself with. */
  readonly currentUserPath: string;
  /** The CQL search. */
  searchPath(input: SearchInput): ConfluenceRead;
  /** One space, by the key or id the model named. */
  spacePath(ref: string): ConfluenceRead;
  /** The space listing, filtered by keys when the caller named any. */
  spaceList(input: SpaceListInput): ConfluenceRead;
  /** The space a page belongs to, for the deployment's own space policy. */
  pageSpacePath(pageId: string): ConfluenceRead;
  /** One page with the body and metadata an answer carries. */
  pagePath(pageId: string): ConfluenceRead;
  /** The comments of one page; `kind` selects the collection where it can. */
  commentPath(input: CommentInput): ConfluenceRead;
  /** The replies of one comment. */
  commentChildrenPath(input: CommentChildrenInput): ConfluenceRead;
  /** The attachments of one page, metadata only. */
  attachmentPath(input: PageInput): ConfluenceRead;
  /** The versions of one page. */
  versionPath(input: PageInput): ConfluenceRead;
}

/** One read: a path relative to the instance base, with its own parameters. */
export interface ConfluenceRead {
  readonly path: string;
  readonly query: ConfluenceQuery;
}

export interface PagedInput {
  /** A continuation token this provider already shape-checked. */
  readonly cursor: string | undefined;
  readonly limit: number;
}

export interface SearchInput {
  readonly cql: string;
  /** Rows before this page; both products page a CQL search by offset. */
  readonly start: number;
  readonly limit: number;
  /** Archived spaces are a Cloud concept; the field is ignored elsewhere. */
  readonly includeArchived: boolean | undefined;
}

export interface SpaceListInput extends PagedInput {
  readonly keys: readonly string[];
  readonly type: string | undefined;
}

export interface CommentInput extends PagedInput {
  readonly pageId: string;
  readonly kind: "footer" | "inline";
}

export interface PageInput extends PagedInput {
  readonly pageId: string;
}

export interface CommentChildrenInput extends PagedInput {
  readonly commentId: string;
  readonly kind: "footer" | "inline";
}

/**
 * Query parameters of one read. Every value is a constant, a number, or a
 * string this provider validated first — never caller input as-is.
 */
export interface ConfluenceQuery {
  readonly [key: string]: string | number | boolean | undefined;
}

/**
 * The continuation parameter of one paged read. Cloud continues a v2 collection
 * with the opaque cursor it handed out; a Server / Data Center installation
 * continues a v1 collection at the row offset it reported. Keeping this here is
 * what makes every caller of the dialect paging-agnostic.
 */
function paged(cursor: string | undefined, limit: number): ConfluenceQuery {
  return cursor === undefined ? { limit } : { limit, start: Number(cursor) };
}

/** The same, for the one collection Cloud pages by cursor. */
function cursorPaged(
  cursor: string | undefined,
  limit: number,
): ConfluenceQuery {
  return cursor === undefined ? { limit } : { limit, cursor };
}

/**
 * Atlassian Cloud: the v2 API under the site's `/wiki` root, an API token over
 * HTTP Basic, and listings paged by an opaque upstream cursor.
 */
const CLOUD: ConfluenceDialect = Object.freeze<ConfluenceDialect>({
  deployment: "cloud",
  credentialLabel: "Atlassian API token",
  tokenShape: /^[A-Za-z0-9._=+/-]{16,512}$/u,
  requiresEmail: true,
  productName: "Confluence Cloud",
  commentKinds: "path",
  currentUserPath: operationPath("connection.get", "cloud"),
  searchPath: ({ cql, start, limit, includeArchived }) => ({
    path: operationPath("search.run", "cloud"),
    query: {
      cql,
      limit,
      start,
      includeArchivedSpaces: includeArchived === true ? "true" : undefined,
    },
  }),
  spacePath: (ref) =>
    isNumericSpace(ref)
      ? {
          path: fill("spaces.get", "cloud", { spaceId: ref }),
          query: { "description-format": "plain" },
        }
      : {
          path: operationPath("spaces.list", "cloud"),
          query: { keys: ref, limit: 2, "description-format": "plain" },
        },
  spaceList: ({ keys, type, cursor, limit }) => ({
    path: operationPath("spaces.list", "cloud"),
    query: {
      keys: keys.length === 0 ? undefined : keys.join(","),
      type,
      ...cursorPaged(cursor, limit),
    },
  }),
  pageSpacePath: (pageId) => ({
    path: fill("pages.get", "cloud", { pageId }),
    query: {},
  }),
  pagePath: (pageId) => ({
    path: fill("pages.get", "cloud", { pageId }),
    query: { "body-format": "atlas_doc_format", "include-labels": "true" },
  }),
  commentPath: ({ pageId, kind, cursor, limit }) => ({
    path: commentCollection(pageId, kind),
    query: {
      "body-format": "atlas_doc_format",
      sort: "created-date",
      ...cursorPaged(cursor, limit),
    },
  }),
  commentChildrenPath: ({ commentId, kind, cursor, limit }) => ({
    path: fill(
      "commentChildren",
      "cloud",
      { commentId },
      kind === "footer"
        ? CONFLUENCE_COMPANION_PATHS[0]
        : CONFLUENCE_COMPANION_PATHS[1],
    ),
    query: {
      "body-format": "atlas_doc_format",
      sort: "created-date",
      ...cursorPaged(cursor, limit),
    },
  }),
  attachmentPath: ({ pageId, cursor, limit }) => ({
    path: fill("pages.attachments", "cloud", { pageId }),
    query: { sort: "created-date", ...cursorPaged(cursor, limit) },
  }),
  versionPath: ({ pageId, cursor, limit }) => ({
    path: fill("pages.versions", "cloud", { pageId }),
    query: cursorPaged(cursor, limit),
  }),
});

/**
 * Server and Data Center: the v1 API under the installation's own base, a
 * personal access token over Bearer, and listings paged by row offset. A
 * self-hosted installation has no `/wiki` context of its own — an installation
 * that lives behind a context path declares it in `baseUrl`, and every path
 * below is relative to that.
 */
const SERVER: ConfluenceDialect = Object.freeze<ConfluenceDialect>({
  deployment: "server",
  credentialLabel: "personal access token",
  // A Data Center personal access token is base64, so it may carry `+`, `/` and
  // padding; the shape is checked for "one opaque token" rather than an
  // alphabet an API token happens to use.
  tokenShape: /^[A-Za-z0-9._+/=-]{16,1024}$/u,
  requiresEmail: false,
  productName: "Confluence Server / Data Center",
  // The v1 API keeps footer and inline comments in one collection and marks
  // each comment with its location, so the kind is filtered after the read
  // instead of selecting an endpoint.
  commentKinds: "marker",
  currentUserPath: operationPath("connection.get", "server"),
  searchPath: ({ cql, start, limit }) => ({
    path: operationPath("search.run", "server"),
    query: {
      cql,
      limit,
      start,
      // The excerpt is what a search answer hands the model instead of the
      // whole body, so the collection read asks for it explicitly.
      expand: "space,version,excerpt",
    },
  }),
  spacePath: (ref) => ({
    path: operationPath("spaces.list", "server"),
    query: { keys: ref, limit: 2, expand: "description.plain" },
  }),
  spaceList: ({ keys, type, cursor, limit }) => ({
    path: operationPath("spaces.list", "server"),
    query: {
      keys: keys.length === 0 ? undefined : keys.join(","),
      type,
      ...paged(cursor, limit),
    },
  }),
  pageSpacePath: (pageId) => ({
    path: fill("pages.get", "server", { pageId }),
    query: { expand: "space" },
  }),
  pagePath: (pageId) => ({
    path: fill("pages.get", "server", { pageId }),
    query: {
      expand: "body.storage,version,space,ancestors,metadata.labels",
    },
  }),
  commentPath: ({ pageId, cursor, limit }) => ({
    path: fill("pages.comments", "server", { pageId }),
    query: {
      expand: "body.storage,version,extensions",
      ...paged(cursor, limit),
    },
  }),
  commentChildrenPath: ({ commentId, cursor, limit }) => ({
    path: fill(
      "commentChildren",
      "server",
      { commentId },
      CONFLUENCE_SERVER_COMPANION_PATHS[0],
    ),
    query: {
      expand: "body.storage,version,extensions",
      ...paged(cursor, limit),
    },
  }),
  attachmentPath: ({ pageId, cursor, limit }) => ({
    path: fill("pages.attachments", "server", { pageId }),
    query: { expand: "version", ...paged(cursor, limit) },
  }),
  versionPath: ({ pageId, cursor, limit }) => ({
    path: fill("pages.versions", "server", { pageId }),
    query: paged(cursor, limit),
  }),
});

export const CONFLUENCE_DIALECTS: Readonly<
  Record<ConfluenceDeployment, ConfluenceDialect>
> = Object.freeze({ cloud: CLOUD, server: SERVER });

/** The dialect of one configured instance. */
export function dialectOf(instance: ConfluenceInstance): ConfluenceDialect {
  return CONFLUENCE_DIALECTS[instance.deploymentType];
}

const NUMERIC = /^\d{1,20}$/u;

/** Whether a space reference is the numeric id the v2 API addresses it by. */
function isNumericSpace(value: string): boolean {
  return NUMERIC.test(value);
}

/**
 * The `Authorization` header of one stored credential. Cloud spends an
 * Atlassian API token as HTTP Basic over `email:token`; a Server / Data Center
 * personal access token is a bearer token whose account is the token's own, so
 * no e-mail travels with it.
 *
 * The credential carries what the operator's instance declared, so an instance
 * whose deployment type no longer matches the stored credential is refused
 * here, before the secret is spent: a token minted for one product must not be
 * offered to the other.
 */
export function authorizationFor(
  dialect: ConfluenceDialect,
  credential: { readonly email: string; readonly token: string },
): string {
  if (dialect.deployment === "server") return `Bearer ${credential.token}`;
  if (credential.email.trim() === "") {
    throw new IntegrationError(
      "CredentialRevoked",
      "This Confluence site is configured as Cloud and needs the account e-mail; reconnect it",
    );
  }
  const pair = Buffer.from(
    `${credential.email}:${credential.token}`,
    "utf8",
  ).toString("base64");
  return `Basic ${pair}`;
}
