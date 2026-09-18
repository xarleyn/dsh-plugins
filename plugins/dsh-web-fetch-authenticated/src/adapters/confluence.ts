/**
 * Confluence content adapter (SPEC §15.2/§16): recognize page URLs, fetch the
 * page through the Confluence REST API with the SAME authenticated transport,
 * and normalize the storage-format XHTML body into compact Markdown text —
 * page metadata plus the readable content, without theme chrome or macros.
 * Recognized page URLs: `/**\/pages/<id>/**` (Server and Cloud, including
 * `/wiki/…` paths), `/**\/display/<SPACE>/<Title>`, and the page links
 * Confluence itself hands out — `<context>/pages/viewpage.action?pageId=<id>`
 * plus its legacy `?spaceKey=<key>&title=<title>` form.
 *
 * Storage bodies carry a lot of page chrome beside the prose: layout macros,
 * navigation macros, status badges, attachment previews, emoticons. How much
 * of it survives into the Markdown is the rule's `adapter.cleanup` level
 * ({@link CleanupLevel}); the readable content — headings, text, lists,
 * tables, code — is rendered the same way at every level.
 *
 * Attachments are the one thing a page body cannot say by itself: the storage
 * format records a filename and nothing else (`<ri:attachment ri:filename>`),
 * so an attachment reference used to reach the model as a bare name it could
 * do nothing with. The adapter therefore resolves every attachment reference
 * into its download URL, and appends the page's attachment list — the same
 * list Confluence's own "Attachments" view shows — so a document the prose
 * mentions but the body does not link is still reachable. Whether attachments
 * are served at all follows the cleanup level's `media` policy: `strict` drops
 * them, like every other auxiliary marker.
 * @module adapters/confluence
 */

import type { CleanupLevel, ResolvedAdapter } from "../types.js";
import * as errors from "../errors.js";
import {
  formatByteSize,
  isElement,
  isText,
  parseMarkup,
  textContent,
  type MarkupElement,
  type MarkupNode,
} from "./markup.js";

export type FetchJson = (
  url: URL,
) => Promise<{ statusCode: number; data: unknown }>;

/** A recognized Confluence page reference. */
export interface PageRef {
  /** Numeric content id, for direct `/pages/<id>` and `?pageId=` URLs. */
  readonly id?: string;
  /** Space-key + title lookup, for display URLs and `?title=` links. */
  readonly spaceKey?: string;
  readonly title?: string;
}

/**
 * Path suffix of the "view page" link Confluence Server puts in the address
 * bar and in every "copy link" action.
 */
const VIEW_PAGE_SUFFIX = /viewpage\.action$/iu;

/**
 * Extract a page reference from a URL. Recognizes:
 * - `/**\/pages/<id>/**` (Server and Cloud; Cloud paths carry a `/wiki` prefix),
 * - `/**\/display/<SPACE>/<Title+With+Plus>` (Server display URLs),
 * - `/**\/pages/viewpage.action?pageId=<id>` and its legacy
 *   `?spaceKey=<KEY>&title=<Title>` form (the links Confluence hands out).
 * Returns `undefined` for URLs the adapter cannot map.
 */
export function extractPageRef(
  pathname: string,
  search?: URLSearchParams,
): PageRef | undefined {
  if (search !== undefined && VIEW_PAGE_SUFFIX.test(pathname)) {
    const id = (search.get("pageId") ?? "").trim();
    if (/^\d+$/u.test(id)) return { id };
    // The legacy form carries the page title and its space instead of an id;
    // without both, there is nothing the REST lookup could ask for.
    const title = (search.get("title") ?? "").trim();
    const spaceKey = (search.get("spaceKey") ?? "").trim();
    if (title.length > 0 && spaceKey.length > 0) {
      return { spaceKey: spaceKey.toUpperCase(), title };
    }
    return undefined;
  }
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  const pagesIndex = segments.lastIndexOf("pages");
  if (pagesIndex >= 0) {
    const id = segments[pagesIndex + 1];
    if (id !== undefined && /^\d+$/u.test(id)) return { id };
  }
  const displayIndex = segments.lastIndexOf("display");
  if (displayIndex >= 0) {
    const spaceKey = segments[displayIndex + 1];
    const title = segments.slice(displayIndex + 2).join("/");
    if (spaceKey !== undefined && title.length > 0) {
      return {
        spaceKey: spaceKey.toUpperCase(),
        title: decodeURIComponent(title).replace(/\+/gu, " "),
      };
    }
  }
  return undefined;
}

/**
 * REST base path prefix: Cloud paths live under `/wiki` and so does its REST
 * API; Server instances serve `/rest/api` at the origin root.
 */
export function restPrefix(pathname: string): string {
  return /^\/wiki(?:\/|$)/u.test(pathname) ? "/wiki/rest/api" : "/rest/api";
}

/** REST URL of one content item with the expansions the renderer needs. */
export function contentApiUrl(origin: string, prefix: string, id: string): URL {
  const url = new URL(`${prefix}/content/${id}`, origin);
  url.searchParams.set("expand", "body.storage,space,version");
  return url;
}

/** REST URL of the space-key + title lookup used by `/display/` URLs. */
export function contentLookupUrl(
  origin: string,
  prefix: string,
  spaceKey: string,
  title: string,
): URL {
  const url = new URL(`${prefix}/content`, origin);
  url.searchParams.set("spaceKey", spaceKey);
  url.searchParams.set("title", title);
  url.searchParams.set("expand", "body.storage,space,version");
  return url;
}

/** REST URL of one page's attachment collection. */
export function contentAttachmentsUrl(
  origin: string,
  prefix: string,
  pageId: string,
  limit: number,
): URL {
  const url = new URL(`${prefix}/content/${pageId}/child/attachment`, origin);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("expand", "version,metadata");
  return url;
}

/**
 * Deployment context path a download URL hangs off: `/wiki` for a Cloud URL or
 * a Server instance mounted under a context path, otherwise the origin root.
 */
export function attachmentContextPath(pathname: string): string {
  return restPrefix(pathname).replace(/\/rest\/api$/u, "");
}

/**
 * Download URL of one attachment. Confluence serves attachments from a fixed
 * path that needs the page id and the file name, so a reference in the body is
 * enough to build it — no extra request per file.
 */
export function attachmentDownloadUrl(
  origin: string,
  contextPath: string,
  pageId: string,
  filename: string,
): string {
  return `${origin}${contextPath}/download/attachments/${pageId}/${encodeURIComponent(filename)}?api=v2`;
}

/**
 * Resolves an attachment filename found in a page body to its download URL.
 * `undefined` means the reference cannot be turned into a link (the page id is
 * unknown), and the caller keeps the plain-name marker instead.
 */
export type AttachmentLinks = (filename: string) => string | undefined;

/** One entry of the attachment collection, as far as the adapter reads it. */
interface AttachmentEntry {
  readonly filename: string;
  readonly mediaType?: string;
  readonly bytes?: number;
  readonly link?: string;
}

interface AttachmentCollection {
  readonly entries: readonly AttachmentEntry[];
  readonly truncated: boolean;
}

/** Read the attachment collection response into entries the section renders. */
export function parseAttachmentCollection(
  data: unknown,
  context: {
    readonly origin: string;
    readonly contextPath: string;
    readonly pageId: string;
    readonly maxAttachments: number;
  },
): AttachmentCollection {
  const results = asRecord(data)?.results;
  if (!Array.isArray(results)) return { entries: [], truncated: false };
  const entries: AttachmentEntry[] = [];
  for (const item of results) {
    const record = asRecord(item);
    const filename =
      typeof record?.title === "string" ? record.title.trim() : "";
    if (filename.length === 0) continue;
    const mediaType = asRecord(record?.metadata)?.mediaType;
    const extensions = asRecord(record?.extensions);
    const links = asRecord(record?._links);
    entries.push({
      filename,
      ...(typeof mediaType === "string" ? { mediaType } : {}),
      ...(typeof extensions?.fileSize === "number"
        ? { bytes: extensions.fileSize }
        : {}),
      link: attachmentEntryUrl(
        { link: links?.download, base: links?.base },
        context,
        filename,
      ),
    });
  }
  const truncated = entries.length > context.maxAttachments;
  return {
    entries: truncated ? entries.slice(0, context.maxAttachments) : entries,
    truncated,
  };
}

/**
 * Prefer the link Confluence itself returned (it carries the version and
 * modification date); fall back to the canonical download path.
 */
function attachmentEntryUrl(
  links: { readonly link?: unknown; readonly base?: unknown },
  context: {
    readonly origin: string;
    readonly contextPath: string;
    readonly pageId: string;
  },
  filename: string,
): string {
  if (typeof links.link === "string" && links.link.length > 0) {
    try {
      const base =
        typeof links.base === "string" && links.base.length > 0
          ? links.base
          : `${context.origin}${context.contextPath}/`;
      return new URL(links.link, base).toString();
    } catch {
      // Fall through to the canonical path below.
    }
  }
  return attachmentDownloadUrl(
    context.origin,
    context.contextPath,
    context.pageId,
    filename,
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

interface ContentResult {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly space?: { readonly name?: unknown; readonly key?: unknown };
  readonly version?: { readonly when?: unknown; readonly number?: unknown };
  readonly body?: { readonly storage?: { readonly value?: unknown } };
}

/** Attachment outcome: a collection, or `"unavailable"` when the list failed. */
type AttachmentLookup = AttachmentCollection | "unavailable";

/** Fetch a Confluence page and normalize it into Markdown text. */
export async function fetchPageMarkdown(
  requestUrl: URL,
  adapter: ResolvedAdapter,
  fetchJson: FetchJson,
): Promise<{ statusCode: number; markdown: string }> {
  const ref = extractPageRef(requestUrl.pathname, requestUrl.searchParams);
  if (ref === undefined)
    throw errors.adapterFailed(
      `URL path "${requestUrl.pathname}" is not a recognizable Confluence page URL`,
    );
  const prefix = restPrefix(requestUrl.pathname);
  let response: { statusCode: number; data: unknown };
  if (ref.id !== undefined) {
    response = await fetchJson(
      contentApiUrl(requestUrl.origin, prefix, ref.id),
    );
  } else {
    response = await fetchJson(
      contentLookupUrl(
        requestUrl.origin,
        prefix,
        ref.spaceKey ?? "",
        ref.title ?? "",
      ),
    );
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    // Non-2xx stays a RESULT (the seam contract), like the Jira adapter.
    const target =
      ref.id !== undefined
        ? `page ${ref.id}`
        : `"${ref.title}" in space ${ref.spaceKey}`;
    return {
      statusCode: response.statusCode,
      markdown: `[Confluence] The Confluence REST API returned HTTP ${response.statusCode} for ${target} at ${requestUrl.origin}${prefix}.`,
    };
  }
  const page = asContent(response.data);
  const pageId =
    typeof page.id === "string" || typeof page.id === "number"
      ? String(page.id)
      : ref.id;
  const cleanup = adapter.cleanup;
  const media = (CLEANUP_POLICIES[cleanup] ?? CLEANUP_POLICIES.balanced).media;
  const linkable = media && pageId !== undefined;
  return {
    statusCode: response.statusCode,
    markdown: renderPage(
      page,
      cleanup,
      linkable
        ? (filename) =>
            attachmentDownloadUrl(
              requestUrl.origin,
              attachmentContextPath(requestUrl.pathname),
              pageId,
              filename,
            )
        : undefined,
      linkable && adapter.maxAttachments > 0
        ? await loadAttachments(requestUrl, pageId, adapter, fetchJson)
        : undefined,
    ),
  };
}

/**
 * Read the page's attachment collection. A failure here must never cost the
 * page: the caller renders the prose either way, and reports the missing list
 * as a marker.
 */
async function loadAttachments(
  requestUrl: URL,
  pageId: string,
  adapter: ResolvedAdapter,
  fetchJson: FetchJson,
): Promise<AttachmentLookup> {
  const limit = Math.min(Math.max(adapter.maxAttachments, 1), 100);
  try {
    const response = await fetchJson(
      contentAttachmentsUrl(
        requestUrl.origin,
        restPrefix(requestUrl.pathname),
        pageId,
        limit,
      ),
    );
    if (response.statusCode < 200 || response.statusCode >= 300)
      return "unavailable";
    return parseAttachmentCollection(response.data, {
      origin: requestUrl.origin,
      contextPath: attachmentContextPath(requestUrl.pathname),
      pageId,
      maxAttachments: adapter.maxAttachments,
    });
  } catch {
    return "unavailable";
  }
}

function asContent(data: unknown): ContentResult {
  // The title lookup returns a results envelope; direct fetches return the page.
  const record = data as { results?: unknown } & ContentResult;
  if (Array.isArray(record.results)) {
    const first = record.results[0];
    if (typeof first !== "object" || first === null) {
      throw errors.adapterFailed(
        "Confluence REST lookup returned no page for the requested title",
      );
    }
    return first as ContentResult;
  }
  return record;
}

function renderPage(
  page: ContentResult,
  cleanup: CleanupLevel,
  links: AttachmentLinks | undefined,
  attachments: AttachmentLookup | undefined,
): string {
  const lines: string[] = [];
  const title =
    typeof page.title === "string" && page.title.length > 0
      ? page.title
      : "Untitled page";
  const space =
    typeof page.space?.name === "string"
      ? page.space.name
      : typeof page.space?.key === "string"
        ? page.space.key
        : undefined;
  const updated =
    typeof page.version?.when === "string"
      ? page.version.when.slice(0, 10)
      : undefined;
  lines.push(`# ${title}`);
  lines.push("");
  const facts: string[] = [];
  if (space !== undefined) facts.push(`Space: ${space}`);
  if (updated !== undefined) facts.push(`Updated: ${updated}`);
  if (facts.length > 0) {
    for (const fact of facts) lines.push(`- ${fact}`);
    lines.push("");
  }
  const storage = page.body?.storage?.value;
  if (typeof storage === "string" && storage.trim().length > 0) {
    lines.push(storageToMarkdown(storage, cleanup, links));
    lines.push("");
  }
  const policy = CLEANUP_POLICIES[cleanup] ?? CLEANUP_POLICIES.balanced;
  if (policy.media && attachments !== undefined) {
    const section = renderAttachments(attachments);
    // A page without attachments says nothing about them: the section exists
    // only when it gives the model something to fetch, or reports that the
    // list could not be read.
    if (section.length > 0) {
      lines.push(section);
      lines.push("");
    }
  }
  return lines.join("\n").trimEnd();
}

/**
 * The page's attachments, in the one form the model can act on: a name, what it
 * is, how big it is, and the URL that downloads it. Bodies mention attachments
 * by filename only, so this list is what turns "see the attached regulation"
 * into something fetchable.
 */
function renderAttachments(lookup: AttachmentLookup): string {
  if (lookup === "unavailable")
    return "## Attachments\n\n_[attachment list unavailable]_";
  if (lookup.entries.length === 0) return "";
  const lines = ["## Attachments", ""];
  for (const entry of lookup.entries) {
    const facts = [
      entry.bytes === undefined ? undefined : formatByteSize(entry.bytes),
      entry.mediaType,
    ].filter((fact): fact is string => fact !== undefined && fact.length > 0);
    const suffix = facts.length > 0 ? ` — ${facts.join(", ")}` : "";
    lines.push(`- [${entry.filename}](${entry.link ?? ""})${suffix}`);
  }
  if (lookup.truncated)
    lines.push("", `_[list capped at ${lookup.entries.length} attachments]_`);
  return lines.join("\n");
}

// ---- Confluence storage-format XHTML → Markdown ----

/**
 * How much auxiliary markup a cleanup level keeps. The readable content —
 * headings, paragraphs, lists, tables, code and panels — is rendered at every
 * level; the levels differ only in what chrome they report.
 */
interface CleanupPolicy {
  /** Navigation/aggregation macros (toc, children, …) leave a marker. */
  readonly navigationMarkers: boolean;
  /** An unknown macro's marker repeats its parameter values. */
  readonly macroParameters: boolean;
  /** Auxiliary `_[…]_` markers exist at all. */
  readonly markers: boolean;
  /** Attachments and images leave a `_[file]_` marker. */
  readonly media: boolean;
  /** Confluence emoticons leave their name as text. */
  readonly emoticons: boolean;
}

/** The three documented levels, `off` ⊃ `balanced` ⊃ `strict`. */
const CLEANUP_POLICIES: Readonly<Record<CleanupLevel, CleanupPolicy>> =
  Object.freeze({
    off: {
      navigationMarkers: true,
      macroParameters: true,
      markers: true,
      media: true,
      emoticons: true,
    },
    balanced: {
      navigationMarkers: false,
      macroParameters: false,
      markers: true,
      media: true,
      emoticons: true,
    },
    strict: {
      navigationMarkers: false,
      macroParameters: false,
      markers: false,
      media: false,
      emoticons: false,
    },
  });

/** Convert a Confluence storage body (XHTML + `ac:` macros) into Markdown. */
export function storageToMarkdown(
  storage: string,
  cleanup: CleanupLevel = "balanced",
  links?: AttachmentLinks,
): string {
  // A level that reaches here from an unvalidated config still renders.
  const policy = CLEANUP_POLICIES[cleanup] ?? CLEANUP_POLICIES.balanced;
  const nodes = parseMarkup(storage);
  const blocks = renderBlocks(nodes, policy, links);
  return polish(blocks, policy);
}

/**
 * Final pass over the rendered blocks: drop marker-only lines the policy does
 * not want, trailing spaces, and the blank-line runs the recursive renderer
 * leaves behind.
 */
function polish(blocks: readonly string[], policy: CleanupPolicy): string {
  let text = blocks.join("\n\n");
  if (!policy.markers) {
    text = text
      .split("\n")
      .filter((line) => !/^_\[[^\]]*\]_$/u.test(line.trim()))
      .join("\n");
  }
  return text
    .replace(/[ \t]+$/gmu, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/** Elements whose rendered content stays on the current block. */
const INLINE_ELEMENTS: ReadonlySet<string> = new Set([
  "span",
  "a",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "strike",
  "code",
  "sub",
  "sup",
  "tt",
  "br",
  "time",
  "ac:link",
  "ac:emoticon",
  "ac:plain-text-link-body",
  "ac:link-body",
  "ac:image",
  "ac:inline-comment-marker",
  "ri:attachment",
  "ri:page",
  "ri:user",
  "ac:placeholder",
]);

/**
 * Macros whose `ac:rich-text-body` IS the page content: the conversion
 * unwraps them instead of leaving a placeholder (SPEC §15.2 — a layout macro
 * must never swallow the paragraph structure it wraps).
 */
const CONTAINER_MACROS: ReadonlySet<string> = new Set([
  "section",
  "column",
  "cell",
  "div",
  "columns",
  "details",
  "excerpt",
  "toc-zone",
  "scroll-ignore",
  "scroll-only",
  "scroll-ignore-title",
  "scroll-page-properties",
  "scroll-title",
  "scroll-versions",
]);

/** Panels and callouts render as blockquotes so they stay visually distinct. */
const CALLOUT_MACROS: ReadonlySet<string> = new Set([
  "panel",
  "info",
  "note",
  "warning",
  "tip",
]);

/**
 * Macros that embed a document in a viewer rather than listing it. The page
 * still means "read this attachment", and the model can only do that with a
 * URL, so these render as attachment links (SPEC §15.2).
 */
const DOCUMENT_VIEW_MACROS: ReadonlySet<string> = new Set([
  "view-file",
  "viewdoc",
  "viewpdf",
  "viewppt",
  "viewxls",
]);

/**
 * Macros that aggregate or navigate (a table of contents, a child-page list,
 * attachments, search widgets). They carry no page content of their own, so
 * `balanced` and `strict` drop them.
 */
const NAVIGATION_MACROS: ReadonlySet<string> = new Set([
  "anchor",
  "attachments",
  "blog-posts",
  "children",
  "contentbylabel",
  "contributors",
  "detailssummary",
  "gallery",
  "html",
  "html-bobswift",
  "index",
  "jira",
  "jirachart",
  "jiraissues",
  "livesearch",
  "multimedia",
  "navmap",
  "page-properties",
  "page-properties-report",
  "page-tree",
  "pagetree",
  "recently-updated",
  "recently-updated-dashboard",
  "roadmap",
  "search",
  "space-list",
  "spaces",
  "tasks-report",
  "timeline",
  "toc",
  "widget",
  "widget-connector",
]);

/** Macros that pull content from another page; only their target is knowable. */
const INCLUDE_MACROS: ReadonlySet<string> = new Set([
  "include",
  "excerpt-include",
  "include-excerpt",
]);

function renderBlocks(
  nodes: readonly MarkupNode[],
  policy: CleanupPolicy,
  links?: AttachmentLinks,
): string[] {
  const out: string[] = [];
  let inlineBuffer: string[] = [];
  const flush = (): void => {
    const text = inlineBuffer.join("").trim();
    inlineBuffer = [];
    if (text.length > 0) out.push(text);
  };
  for (const node of nodes) {
    if (isText(node)) {
      inlineBuffer.push(collapseWhitespace(node.value));
      continue;
    }
    if (INLINE_ELEMENTS.has(node.name)) {
      inlineBuffer.push(renderInlineElement(node, policy, links));
      continue;
    }
    flush();
    out.push(...renderBlockElement(node, policy, links));
  }
  flush();
  return out.filter((block) => block.length > 0);
}

function renderBlockElement(
  node: MarkupElement,
  policy: CleanupPolicy,
  links?: AttachmentLinks,
): string[] {
  switch (node.name) {
    case "p": {
      const text = renderInline(node.children, policy, links)
        .replace(/\s+/gu, " ")
        .trim();
      return text.length === 0 ? [] : [text];
    }
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const text = renderInline(node.children, policy, links).trim();
      return text.length === 0
        ? []
        : [`${"#".repeat(Number(node.name.slice(1)))} ${text}`];
    }
    case "ul":
    case "ol":
      // One block: a blank line between items would break the list apart.
      return [
        renderList(node, node.name === "ol" ? 1 : 0, 0, policy, links).join(
          "\n",
        ),
      ];
    case "blockquote": {
      const inner = renderBlocks(node.children, policy, links).join("\n\n");
      return inner.length === 0
        ? []
        : [
            inner
              .split("\n")
              .map((line) => `> ${line}`)
              .join("\n"),
          ];
    }
    case "pre":
      return [
        "```\n" + textContent(node.children).replace(/\n$/u, "") + "\n```",
      ];
    case "table": {
      // One block: blank lines between rows would split the table in two.
      const rows = renderTable(node, policy, links);
      return rows.length === 0 ? [] : [rows.join("\n")];
    }
    case "hr":
      return ["---"];
    case "ac:task-list": {
      const tasks = renderTaskList(node, policy, links);
      return tasks.length === 0 ? [] : [tasks.join("\n")];
    }
    case "ac:structured-macro":
      return [renderMacro(node, policy, links)].filter(
        (block) => block.length > 0,
      );
    case "ac:layout":
    case "ac:layout-section":
    case "ac:layout-cell":
    case "ac:rich-text-body":
    case "ac:plain-text-body":
    case "div":
    case "section":
    case "article":
    case "tbody":
    case "thead":
    case "tfoot":
      return renderBlocks(node.children, policy, links);
    default:
      // Unknown block elements: keep their text so content is never dropped.
      return renderBlocks(node.children, policy, links);
  }
}

function renderInlineElement(
  node: MarkupElement,
  policy: CleanupPolicy,
  links?: AttachmentLinks,
): string {
  switch (node.name) {
    case "br":
      return "  \n";
    case "a": {
      const href = node.attrs.href ?? "";
      const text = renderInline(node.children, policy, links).trim();
      if (href.length === 0) return text;
      return `[${text.length > 0 ? text : href}](${href})`;
    }
    case "strong":
    case "b": {
      const text = renderInline(node.children, policy, links).trim();
      return text.length === 0 ? "" : `**${text}**`;
    }
    case "em":
    case "i": {
      const text = renderInline(node.children, policy, links).trim();
      return text.length === 0 ? "" : `*${text}*`;
    }
    case "s":
    case "strike": {
      const text = renderInline(node.children, policy, links).trim();
      return text.length === 0 ? "" : `~~${text}~~`;
    }
    case "code":
    case "tt": {
      const text = textContent(node.children);
      return text.length === 0 ? "" : "`" + text + "`";
    }
    case "ac:emoticon": {
      if (!policy.emoticons) return "";
      return node.attrs["ac:name"] ?? "";
    }
    case "ac:link":
      return renderAcLink(node, policy, links);
    case "ac:placeholder":
      return "";
    case "ac:image":
      return renderImage(node, policy, links);
    case "ri:attachment": {
      const name = node.attrs["ri:filename"] ?? "attachment";
      return renderAttachmentReference(name, policy, links);
    }
    default:
      return renderInline(node.children, policy, links);
  }
}

/**
 * An image embedded in the page: a link when it is an attachment, the storage
 * URL when it is external. Never a bare `_[file.png]_` — the model cannot fetch
 * a name, and an attachment it cannot fetch is not worth a line of context.
 */
function renderImage(
  node: MarkupElement,
  policy: CleanupPolicy,
  links?: AttachmentLinks,
): string {
  const filename = attachmentNameOf(node);
  if (filename !== undefined)
    return renderAttachmentReference(filename, policy, links);
  const external = findDescendantAttr(node, "ri:url", "ri:value");
  if (typeof external === "string" && external.length > 0)
    return `![](${external})`;
  return "";
}

/** `[name](url)` for an attachment, or the plain-name marker when unresolvable. */
function renderAttachmentReference(
  name: string,
  policy: CleanupPolicy,
  links?: AttachmentLinks,
): string {
  if (!policy.media) return "";
  const href = links?.(name);
  if (href !== undefined && href.length > 0) return `[${name}](${href})`;
  return `_[${name}]_`;
}

/** Filename of the attachment an element points at, if any. */
function attachmentNameOf(node: MarkupElement): string | undefined {
  const direct =
    node.attrs["ri:filename"] ??
    findDescendantAttr(node, "ri:attachment", "ri:filename");
  return typeof direct === "string" && direct.length > 0 ? direct : undefined;
}

function renderAcLink(
  node: MarkupElement,
  policy: CleanupPolicy,
  links?: AttachmentLinks,
): string {
  const body = node.children.find(
    (child) =>
      isElement(child) &&
      (child.name === "ac:link-body" ||
        child.name === "ac:plain-text-link-body"),
  );
  let label: string | undefined;
  if (isElement(body)) {
    label =
      body.name === "ac:plain-text-link-body"
        ? textContent(body.children).trim()
        : renderInline(body.children, policy, links).trim();
  }
  const attachment = attachmentNameOf(node);
  if (attachment !== undefined) {
    const text = label !== undefined && label.length > 0 ? label : attachment;
    return renderAttachmentReference(text, policy, links);
  }
  const pageRef = findDescendantAttr(node, "ri:page", "ri:content-title");
  const anchor = node.attrs["ac:anchor"];
  if (label !== undefined && label.length > 0) return label;
  if (typeof pageRef === "string" && pageRef.length > 0) return pageRef;
  // A user mention carries only an account id in storage format — the display
  // name is not in the body — so it keeps a visible placeholder instead of
  // leaving the sentence that introduced it dangling.
  if (findDescendantAttr(node, "ri:user", "ri:account-id") !== undefined)
    return "@user";
  if (typeof anchor === "string" && anchor.length > 0) return anchor;
  return "";
}

function findDescendantAttr(
  node: MarkupElement,
  name: string,
  attr: string,
): string | undefined {
  for (const child of node.children) {
    if (!isElement(child)) continue;
    if (child.name === name) {
      const value = child.attrs[attr];
      if (typeof value === "string") return value;
    }
    const found = findDescendantAttr(child, name, attr);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The structural pieces a macro's children carry. */
interface MacroParts {
  /** `ac:parameter` entries by `ac:name`. */
  readonly params: ReadonlyMap<string, string>;
  /** `ac:rich-text-body` children (or the non-parameter children as a fallback). */
  readonly body: readonly MarkupNode[];
  /** `ac:plain-text-body` text (code/noformat bodies, raw payloads). */
  readonly plainBody: string;
}

function macroParts(node: MarkupElement): MacroParts {
  const params = new Map<string, string>();
  let body: readonly MarkupNode[] | undefined;
  let plainBody = "";
  const loose: MarkupNode[] = [];
  for (const child of node.children) {
    if (!isElement(child)) {
      loose.push(child);
      continue;
    }
    if (child.name === "ac:parameter") {
      const name = child.attrs["ac:name"];
      if (typeof name === "string")
        params.set(name, textContent(child.children));
      continue;
    }
    if (child.name === "ac:rich-text-body") {
      body = child.children;
      continue;
    }
    if (child.name === "ac:plain-text-body") {
      plainBody = textContent(child.children);
      continue;
    }
    loose.push(child);
  }
  return { params, body: body ?? loose, plainBody };
}

/** Render one `ac:structured-macro` to a Markdown block. */
function renderMacro(
  node: MarkupElement,
  policy: CleanupPolicy,
  links?: AttachmentLinks,
): string {
  const name = node.attrs["ac:name"] ?? "macro";
  const parts = macroParts(node);
  const title = (parts.params.get("title") ?? "").trim();
  const body = (): string =>
    renderBlocks(parts.body, policy, links).join("\n\n");
  // Code macros are the ones the model actually needs verbatim.
  if (name === "code") {
    const language = (
      parts.params.get("language") ??
      parts.params.get("syntaxhighlighter-parameter") ??
      ""
    ).trim();
    const text = plainBody(parts).replace(/\n$/u, "");
    if (text.trim().length === 0) return "";
    return "```" + language + "\n" + text + "\n```";
  }
  if (name === "noformat") {
    const text = plainBody(parts).replace(/\n$/u, "");
    if (text.trim().length === 0) return "";
    return "```\n" + text + "\n```";
  }
  if (name === "status") {
    // A status badge is content: it reads as a bold label inline.
    const label = (title.length > 0 ? title : plainBody(parts)).trim();
    return label.length === 0 ? "" : `**${label}**`;
  }
  if (DOCUMENT_VIEW_MACROS.has(name)) {
    // An embedded Office/PDF document: the macro shows a viewer, the page means
    // "read this attachment". Link it so the model can fetch it.
    const filename = attachmentNameOf(node) ?? title;
    if (filename.length === 0) return "";
    return renderAttachmentReference(filename, policy, links);
  }
  if (CONTAINER_MACROS.has(name)) {
    return joinBlocks(title.length > 0 ? `**${title}**` : "", body());
  }
  if (CALLOUT_MACROS.has(name)) {
    const inner = joinBlocks(title.length > 0 ? `**${title}**` : "", body());
    return inner.length === 0
      ? ""
      : inner
          .split("\n")
          .map((line) => (line.length > 0 ? `> ${line}` : ">"))
          .join("\n");
  }
  if (name === "expand") {
    return joinBlocks(title.length > 0 ? `**${title}**` : "", body());
  }
  if (NAVIGATION_MACROS.has(name)) {
    return policy.navigationMarkers ? macroMarker(name, parts, policy) : "";
  }
  if (INCLUDE_MACROS.has(name)) {
    return policy.markers ? includeMarker(name, node, parts) : "";
  }
  // Every other macro: keep a visible placeholder so the model knows
  // structured content existed here instead of silently dropping it, and keep
  // whatever body it rendered so a container the conversion does not know
  // still contributes its content.
  const inner = body();
  if (!policy.markers) return inner;
  return joinBlocks(macroMarker(name, parts, policy), inner);
}

/** `ac:plain-text-body` text, or the rich body's text when no plain body exists. */
function plainBody(parts: MacroParts): string {
  return parts.plainBody.length > 0 ? parts.plainBody : textContent(parts.body);
}

function joinBlocks(...blocks: readonly string[]): string {
  return blocks
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .join("\n\n");
}

/** `_[macro: name — details]_`, with the details only where the level asks for them. */
function macroMarker(
  name: string,
  parts: MacroParts,
  policy: CleanupPolicy,
): string {
  const details = policy.macroParameters ? macroDetails(parts) : "";
  return `_[macro: ${name}${details.length > 0 ? ` — ${details}` : ""}]_`;
}

/** Short, single-line digest of a macro's parameters for its marker. */
function macroDetails(parts: MacroParts): string {
  const values = [...parts.params.values()]
    .map((value) => collapseWhitespace(value).trim())
    .filter((value) => value.length > 0);
  if (values.length === 0) return "";
  const joined = values.join(" · ");
  return joined.length > 160 ? `${joined.slice(0, 159)}…` : joined;
}

/** `_[includes: Target]_` — the only trace a cross-page include leaves. */
function includeMarker(
  name: string,
  node: MarkupElement,
  parts: MacroParts,
): string {
  const target = findDescendantAttr(node, "ri:page", "ri:content-title");
  const label = (target ?? macroDetails(parts)).trim();
  const verb = name === "excerpt-include" ? "excerpt from" : "includes";
  return label.length > 0 ? `_[${verb}: ${label}]_` : `_[macro: ${name}]_`;
}

function renderList(
  node: MarkupElement,
  ordered: number | 0,
  depth: number,
  policy: CleanupPolicy,
  links?: AttachmentLinks,
): string[] {
  const out: string[] = [];
  let index = 0;
  for (const child of node.children) {
    if (!isElement(child) || child.name !== "li") continue;
    index += 1;
    const marker = ordered === 0 ? "-" : `${ordered + index - 1}.`;
    const inline: string[] = [];
    const nested: string[] = [];
    for (const part of child.children) {
      if (!isElement(part)) {
        const text = collapseWhitespace(part.value).trim();
        if (text.length > 0) inline.push(text);
        continue;
      }
      if (INLINE_ELEMENTS.has(part.name) || part.name === "p")
        inline.push(renderInlineElement(part, policy, links));
      else if (part.name === "ul" || part.name === "ol")
        nested.push(
          ...renderList(
            part,
            part.name === "ol" ? 1 : 0,
            depth + 1,
            policy,
            links,
          ),
        );
      else nested.push(...renderBlockElement(part, policy, links));
    }
    const text = inline.join("").trim();
    out.push(`${"  ".repeat(depth)}${marker} ${text}`);
    out.push(...nested);
  }
  return out;
}

/**
 * Task lists render as Markdown checkboxes: the task text is page content and
 * its completion state is the only thing the macro adds.
 */
function renderTaskList(
  node: MarkupElement,
  policy: CleanupPolicy,
  links?: AttachmentLinks,
): string[] {
  const out: string[] = [];
  for (const child of node.children) {
    if (!isElement(child) || child.name !== "ac:task") continue;
    const status = findElementText(child, "ac:task-status").toLowerCase();
    const body = child.children.find(
      (part) => isElement(part) && part.name === "ac:task-body",
    );
    const text = isElement(body)
      ? renderBlocks(body.children, policy, links)
          .join(" ")
          .replace(/\s+/gu, " ")
          .trim()
      : "";
    if (text.length === 0) continue;
    const done = status === "complete" || status === "done";
    out.push(`- [${done ? "x" : " "}] ${text}`);
  }
  return out;
}

function findElementText(node: MarkupElement, name: string): string {
  for (const child of node.children) {
    if (!isElement(child)) continue;
    if (child.name === name) return textContent(child.children).trim();
    const nested = findElementText(child, name);
    if (nested.length > 0) return nested;
  }
  return "";
}

function renderTable(
  node: MarkupElement,
  policy: CleanupPolicy,
  links?: AttachmentLinks,
): string[] {
  const rows: string[][] = [];
  for (const child of node.children) {
    if (!isElement(child) || child.name !== "tr") {
      if (
        isElement(child) &&
        (child.name === "thead" ||
          child.name === "tbody" ||
          child.name === "tfoot")
      ) {
        for (const row of child.children) {
          if (isElement(row) && row.name === "tr")
            rows.push(rowCells(row, policy, links));
        }
      }
      continue;
    }
    rows.push(rowCells(child, policy, links));
  }
  if (rows.length === 0) return [];
  const width = Math.max(...rows.map((row) => row.length), 1);
  const emit = (cells: string[]): string =>
    `| ${Array.from({ length: width }, (_, index) => (cells[index] ?? "").trim()).join(" | ")} |`;
  const out = [
    emit(rows[0] ?? []),
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
  ];
  for (const row of rows.slice(1)) out.push(emit(row));
  return out;
}

function rowCells(
  row: MarkupElement,
  policy: CleanupPolicy,
  links?: AttachmentLinks,
): string[] {
  const cells: MarkupElement[] = [];
  for (const child of row.children) {
    if (isElement(child) && (child.name === "td" || child.name === "th"))
      cells.push(child);
  }
  return cells.map((cell) => {
    const blocks = renderBlocks(cell.children, policy, links);
    return blocks.join(" ").replace(/\|/gu, "\\|").trim();
  });
}

/** Render any inline run of nodes to text (paragraph bodies, headings). */
function renderInline(
  nodes: readonly MarkupNode[],
  policy: CleanupPolicy,
  links?: AttachmentLinks,
): string {
  let out = "";
  for (const node of nodes) {
    if (isText(node)) {
      out += node.value;
      continue;
    }
    if (INLINE_ELEMENTS.has(node.name)) {
      out += renderInlineElement(node, policy, links);
      continue;
    }
    if (node.name === "ac:structured-macro") {
      out += renderInlineMacro(node, policy, links);
      continue;
    }
    out += renderInline(node.children, policy, links);
  }
  return out;
}

/** A macro met mid-paragraph: its text stays, its chrome follows the policy. */
function renderInlineMacro(
  node: MarkupElement,
  policy: CleanupPolicy,
  links?: AttachmentLinks,
): string {
  const name = node.attrs["ac:name"] ?? "macro";
  const parts = macroParts(node);
  if (name === "status") {
    const label = (
      (parts.params.get("title") ?? "").trim() || plainBody(parts)
    ).trim();
    return label.length === 0 ? "" : `**${label}**`;
  }
  if (DOCUMENT_VIEW_MACROS.has(name)) {
    const filename = attachmentNameOf(node) ?? "";
    return filename.length === 0
      ? ""
      : renderAttachmentReference(filename, policy, links);
  }
  if (
    CONTAINER_MACROS.has(name) ||
    CALLOUT_MACROS.has(name) ||
    name === "expand" ||
    name === "excerpt"
  ) {
    return renderInline(parts.body, policy, links).trim();
  }
  if (NAVIGATION_MACROS.has(name))
    return policy.navigationMarkers ? `_[macro: ${name}]_` : "";
  if (!policy.markers) return "";
  return macroMarker(name, parts, policy);
}

function collapseWhitespace(text: string): string {
  return text
    .replace(/[\u00ad\u200b-\u200d\ufeff]/gu, "")
    .replace(/[ \t\r\n]+/gu, " ");
}
