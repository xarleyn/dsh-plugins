import type { OperationSecurityMetadata } from "../../service-credentials/types.js";
import type {
  IntegrationCapability,
  IntegrationCapabilityInfo,
} from "../../types.js";
import type { ConfluenceDeployment, ConfluenceFlags } from "./config.js";

/**
 * Capabilities this provider offers. They are narrower than Confluence's own
 * scopes on purpose: one switch per kind of data, so the operator decides what
 * a deployment is willing to expose at all.
 *
 * Unlike GitLab there is no second, per-credential narrowing: an Atlassian API
 * token cannot be asked which scopes it carries, so these switches are the
 * whole of what the agent is offered, and Confluence's own permissions answer
 * on every call. Access a granted capability still needs is refused upstream
 * and surfaces as a permission deny.
 */
export type ConfluenceCapability =
  | "identity.read"
  | "spaces.read"
  | "search.read"
  | "content.read"
  | "comments.read"
  | "attachments.read"
  | "versions.read";

export interface ConfluenceCapabilityDefinition {
  readonly capability: ConfluenceCapability;
  readonly flag: Exclude<
    keyof ConfluenceFlags,
    | "instances"
    | "retries"
    | "enabled"
    | "allowInsecureHttp"
    | "allowedSpaces"
    | "defaultBodyChars"
    | "maxBodyChars"
    | "maxResults"
    | "maxReplyParents"
  >;
  readonly label: string;
  readonly hint: string;
}

export const CONFLUENCE_CAPABILITIES: readonly ConfluenceCapabilityDefinition[] =
  Object.freeze([
    {
      capability: "identity.read",
      flag: "identityRead",
      label: "Свой профиль",
      hint: "Подключённый пользователь Confluence: имя, accountId и адрес сайта",
    },
    {
      capability: "spaces.read",
      flag: "spacesRead",
      label: "Читать пространства",
      hint: "Список пространств, карточка пространства и его описание",
    },
    {
      capability: "search.read",
      flag: "searchRead",
      label: "Искать по Confluence",
      hint: "Поиск страниц по тексту, пространству, меткам и дате изменения (CQL собирает провайдер)",
    },
    {
      capability: "content.read",
      flag: "contentRead",
      label: "Читать страницы",
      hint: "Страница целиком: текст в виде markdown-подобной разметки, метки, версия, родитель",
    },
    {
      capability: "comments.read",
      flag: "commentsRead",
      label: "Читать комментарии",
      hint: "Комментарии страницы: подвал и inline, с ответами и статусом резолва",
    },
    {
      capability: "attachments.read",
      flag: "attachmentsRead",
      label: "Читать вложения",
      hint: "Только метаданные вложений страницы: имя, тип, размер, версия",
    },
    {
      capability: "versions.read",
      flag: "versionsRead",
      label: "Читать версии страниц",
      hint: "История версий: номер, автор, дата и комментарий к версии",
    },
  ]);

/**
 * A read of the connected identity alone: no resource, nothing personal.
 */
const IDENTITY_READ = {
  effect: "read",
  sensitivity: "normal",
  serviceCredential: "allow",
  requiresResourceBoundary: false,
} as const satisfies OperationSecurityMetadata;

/**
 * A read whose answer belongs to a space. `requiresResourceBoundary` makes the
 * broker prove the profile bounds spaces at all, and the provider holds the
 * call inside the boundary — which is what a service account needs, because it
 * can see far more than the user it stands in for.
 *
 * This is also the ceiling of what this catalog contains. Every read answers
 * authored Confluence content or its metadata; the one read that would return
 * arbitrary uploaded bytes — an attachment body download — does not exist here.
 * Should a write or a byte-returning read ever be added, it must be classified
 * on purpose: an unclassified operation is unreachable through the managed
 * credential, which is the fail-closed default.
 */
const SPACE_READ = {
  effect: "read",
  sensitivity: "normal",
  serviceCredential: "allow",
  requiresResourceBoundary: true,
} as const satisfies OperationSecurityMetadata;

export interface ConfluenceOperationDefinition {
  readonly capability: ConfluenceCapability;
  /** Every Confluence read is a GET; the catalog declares it, the gate checks it. */
  readonly method: "GET";
  /**
   * REST path under the instance's base. `:placeholders` are filled by the
   * handler; the value is a fixed string, so the model can never pick an
   * endpoint of its own.
   */
  readonly path: string;
  /**
   * The path of this operation on a Server / Data Center installation. The two
   * products genuinely differ here — Cloud answers the v2 API under `/wiki`
   * (`/wiki/api/v2/pages/:pageId`), a self-hosted installation its own v1 API
   * (`/rest/api/content/:pageId`) — so nearly every read names both rather than
   * deriving one from the other.
   */
  readonly serverPath: string;
  /** Set when the operation answers with one page of a collection. */
  readonly list?: boolean;
  /**
   * How the operation pages. Confluence v2 hands out an opaque cursor, while
   * the v1 search endpoint counts rows, so the provider has to know which of
   * the two a `nextCursor` belongs to.
   */
  readonly cursor?: "offset" | "upstream";
  /** What this operation does, how sensitive it is, who may reach it. */
  readonly security: OperationSecurityMetadata;
}

/** The resource kind every space-scoped operation of this provider is bounded by. */
export const CONFLUENCE_RESOURCE_KIND = "spaces";

/**
 * Every model-reachable operation. The provider refuses any operation that is
 * not listed here, so this table — together with `capability` and `security`
 * — is the permission surface. Only GET: the catalog carries no operation that
 * could change Confluence state, and the confirmation framework does not exist
 * yet.
 *
 * The mix of REST versions is deliberate. On Cloud the v2 API covers pages,
 * comments, attachments, versions and spaces, and that is where those reads go,
 * while the CQL search and the "who am I" call exist only in v1; on a Server /
 * Data Center installation the whole surface is that v1 API. Each operation
 * declares the endpoint of both products, and the dialect builds the request
 * from the one the instance declared. Tools never see the difference — an
 * operation answers a normalized object either way.
 */
export const CONFLUENCE_OPERATIONS: Readonly<
  Record<string, ConfluenceOperationDefinition>
> = Object.freeze({
  /**
   * The connected Atlassian account. v2 has no "current user" endpoint, so this
   * is the one v1 call outside search.
   */
  "connection.get": {
    capability: "identity.read",
    method: "GET",
    path: "/wiki/rest/api/user/current",
    serverPath: "/rest/api/user/current",
    security: IDENTITY_READ,
  },
  /** CQL search: the only read Confluence offers for free-text lookup. */
  "search.run": {
    capability: "search.read",
    method: "GET",
    path: "/wiki/rest/api/search",
    serverPath: "/rest/api/content/search",
    list: true,
    cursor: "offset",
    security: SPACE_READ,
  },
  "spaces.list": {
    capability: "spaces.read",
    method: "GET",
    path: "/wiki/api/v2/spaces",
    serverPath: "/rest/api/space",
    list: true,
    cursor: "upstream",
    security: SPACE_READ,
  },
  /**
   * v2 addresses a space by numeric id only; a key is resolved through
   * `spaces.list` first, inside the handler, and never by the model.
   */
  "spaces.get": {
    capability: "spaces.read",
    method: "GET",
    path: "/wiki/api/v2/spaces/:spaceId",
    serverPath: "/rest/api/space",
    security: SPACE_READ,
  },
  "pages.get": {
    capability: "content.read",
    method: "GET",
    path: "/wiki/api/v2/pages/:pageId",
    serverPath: "/rest/api/content/:pageId",
    security: SPACE_READ,
  },
  /**
   * The catalog names the footer collection; inline comments live at the same
   * path with `inline-comments`, chosen by the handler from a validated `kind`,
   * never from a caller-supplied path.
   */
  "pages.comments": {
    capability: "comments.read",
    method: "GET",
    path: "/wiki/api/v2/pages/:pageId/footer-comments",
    serverPath: "/rest/api/content/:pageId/child/comment",
    list: true,
    cursor: "upstream",
    security: SPACE_READ,
  },
  /**
   * Attachment metadata only: a name, a size, a download link. The bytes are
   * never fetched — a read that returned arbitrary uploaded content would be a
   * different classification entirely.
   */
  "pages.attachments": {
    capability: "attachments.read",
    method: "GET",
    path: "/wiki/api/v2/pages/:pageId/attachments",
    serverPath: "/rest/api/content/:pageId/child/attachment",
    list: true,
    cursor: "upstream",
    security: SPACE_READ,
  },
  "pages.versions": {
    capability: "versions.read",
    method: "GET",
    path: "/wiki/api/v2/pages/:pageId/versions",
    serverPath: "/rest/api/content/:pageId/version",
    list: true,
    cursor: "upstream",
    security: SPACE_READ,
  },
});

/**
 * The inline comment collection of a Cloud page. The catalog declares the
 * footer one as the operation's endpoint; the inline kind is the same collection
 * under its own name, and it is declared here rather than derived, so both paths
 * a request may reach are lines somebody added on purpose.
 */
export const CONFLUENCE_INLINE_COMMENTS_PATH =
  "/wiki/api/v2/pages/:pageId/inline-comments";

/**
 * The reads this provider performs that are not operations of the catalog: the
 * replies of one comment, which Cloud keeps in a collection per comment kind
 * and a Server / Data Center installation in the comment's own children.
 */
export const CONFLUENCE_COMPANION_PATHS: readonly string[] = Object.freeze([
  "/wiki/api/v2/footer-comments/:commentId/children",
  "/wiki/api/v2/inline-comments/:commentId/children",
]);

/** The same read on a Server / Data Center installation, which has one kind. */
export const CONFLUENCE_SERVER_COMPANION_PATHS: readonly string[] =
  Object.freeze(["/rest/api/content/:commentId/child/comment"]);

/** The path of one operation on the instance's product. */
export function confluenceOperationPath(
  operation: string,
  deployment: ConfluenceDeployment,
): string | undefined {
  const definition = CONFLUENCE_OPERATIONS[operation];
  if (definition === undefined) return undefined;
  return deployment === "server" ? definition.serverPath : definition.path;
}

/** Capabilities this deployment allows, in catalog order. */
export function enabledCapabilities(
  flags: ConfluenceFlags,
): readonly ConfluenceCapability[] {
  return CONFLUENCE_CAPABILITIES.filter((item) => flags[item.flag]).map(
    (item) => item.capability,
  );
}

/** Label and hint per capability, for clients that render what we declare. */
export const CONFLUENCE_CAPABILITY_INFO: Readonly<
  Record<ConfluenceCapability, IntegrationCapabilityInfo>
> = Object.freeze(
  Object.fromEntries(
    CONFLUENCE_CAPABILITIES.map((item) => [
      item.capability,
      { label: item.label, hint: item.hint },
    ]),
  ) as Record<ConfluenceCapability, IntegrationCapabilityInfo>,
);

/** Capability an operation needs, or undefined when the catalog has none. */
export function confluenceOperationCapability(
  operation: string,
): IntegrationCapability | undefined {
  return CONFLUENCE_OPERATIONS[operation]?.capability;
}

/** Security classification of an operation, or undefined when it is unknown. */
export function confluenceOperationMetadata(
  operation: string,
): OperationSecurityMetadata | undefined {
  return CONFLUENCE_OPERATIONS[operation]?.security;
}
