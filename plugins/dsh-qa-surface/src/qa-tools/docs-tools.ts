import { lstat, readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { canonicalCandidate, pathIsInside } from "../user-workspace.js";

/**
 * `docs_search` and `docs_read` — the documentation surface of the QA catalog.
 *
 * A QA chat answers questions from the stand's documentation, and until now the
 * model had no tool that said where that documentation is: the path in a
 * reviewer's remark (`docs/platform/3.8/…`) was something the model had to
 * guess its way to with a glob sweep, and a miss read as "the document does
 * not exist" rather than "wrong tree". These two tools make the tree a
 * first-class surface. Both are read-only, both are fenced to the
 * documentation directory inside the calling chat's workspace
 * (`<session cwd>/docs`, the directory the stand publishes its documentation
 * into), and both name the documentation as what they search, so the tool
 * description itself answers "where do I look for documentation?".
 *
 * The tree is read as a shallow layout convention, not a schema: hits carry
 * the `version` and `module` parsed out of the path (`docs/<module>/<version>/…`)
 * so the model can stay inside one edition of one module, and the same two
 * names are accepted as filters. A path the convention does not describe is
 * still searched and still read — it simply carries no identity.
 *
 * Nothing here is destructive and building it registers nothing: like the rest
 * of the catalog these are side-effect-free definitions, and the workspace root
 * is read from `exec.agent` at call time.
 */

/** The documentation directory inside a chat workspace. */
export const QA_DOCS_DIRECTORY = "docs";

/** Search defaults and budgets, all fixed: a chat cannot raise them. */
export const QA_DOCS_SEARCH_DEFAULT_LIMIT = 8;
export const QA_DOCS_SEARCH_MAX_LIMIT = 40;
export const QA_DOCS_SEARCH_BYTE_BUDGET = 4_000;
export const QA_DOCS_READ_DEFAULT_LINES = 120;
export const QA_DOCS_READ_MAX_LINES = 400;

/** One file larger than this is not documentation a chat needs to search. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Bound on the walk itself, so a huge tree cannot stall the turn. */
const MAX_FILES_SCANNED = 2_000;
/** A matched line is trimmed to this many characters before it is reported. */
const MAX_LINE_CHARS = 240;

const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });

/** Why a documentation tool refused a call. */
export type QaDocsRefusal =
  | "workspace-unavailable"
  | "docs-unavailable"
  | "invalid-request"
  | "outside-docs"
  | "symlink-escape"
  | "not-found"
  | "not-a-file"
  | "not-text";

/**
 * A typed refusal of one documentation call.
 *
 * The message is what the model reads. It names the reason in words and never
 * echoes an absolute host path, so a refusal cannot leak the deployment's
 * layout into the conversation.
 */
export class QaDocsError extends Error {
  constructor(
    readonly code: QaDocsRefusal,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "QaDocsError";
  }
}

const WORKSPACE_UNAVAILABLE =
  "the calling session's workspace root is not available to this execution, so the documentation tree cannot be located. Report that documentation is unavailable rather than guessing its contents.";
const DOCS_UNAVAILABLE = `this chat's workspace has no ${QA_DOCS_DIRECTORY}/ directory, so there is no documentation tree to read. Documentation is published there (${QA_DOCS_DIRECTORY}/<module>/<version>/…); if it is missing, ask the operator instead of substituting a memory or workspace search.`;
const DOCS_NOT_A_DIRECTORY = `the ${QA_DOCS_DIRECTORY}/ entry in this chat's workspace is not a real directory (it is a file or a link), and documentation is never followed through a link.`;
const DOCS_ESCAPE = `the ${QA_DOCS_DIRECTORY}/ directory resolves outside the calling chat's workspace, so the documentation tree is refused.`;
const INVALID_QUERY = "no query was given: pass the phrase to look for.";
const OUTSIDE_DOCS = `this path resolves outside the documentation directory (${QA_DOCS_DIRECTORY}/) of the calling chat's workspace. Documentation is only read where the stand publishes it; pass a path inside ${QA_DOCS_DIRECTORY}/.`;
const SYMLINK_ESCAPE =
  "this path leaves the documentation tree through a symbolic link, and links are not followed out of it.";
const NOT_FOUND =
  "no documentation file or directory exists at this path. Check the spelling against a path docs_search reported.";
const NOT_A_FILE =
  "this path is a directory, not a documentation file: pass the file to read, or use docs_search to find one.";
const NOT_TEXT =
  "this path does not read as UTF-8 text (or is larger than the readable limit), so it is not documentation this tool can return.";

/** The slice of the execution record these tool bodies read. */
interface QaDocsExecution {
  readonly agent?: {
    readonly session: {
      readonly header: {
        readonly cwd?: string;
      };
    };
  };
}

/** The resolved documentation root of one call. */
export interface QaDocsRoot {
  /** Canonical workspace root of the calling chat. */
  readonly workspace: string;
  /** Canonical `<workspace>/docs`. */
  readonly docs: string;
}

/**
 * Module/version identity parsed out of a documentation path.
 *
 * Both are optional and, when a path does not carry one, genuinely absent: the
 * catalog's output schema is read with `exactOptionalPropertyTypes`, so an
 * identity is spread into a report rather than written as `undefined`.
 */
export interface QaDocsIdentity {
  readonly version?: string;
  readonly module?: string;
}

/** One documentation match. */
export interface QaDocsHit extends QaDocsIdentity {
  /** Workspace-relative path, starting at `docs/`, with forward slashes. */
  readonly path: string;
  /** 1-based line number inside the file. */
  readonly line: number;
  /** The matched line, trimmed and bounded. */
  readonly text: string;
}

/** The outcome of one documentation search. */
export interface QaDocsSearchResult extends QaDocsIdentity {
  readonly query: string;
  /** The directory documentation is read from, relative to the workspace. */
  readonly root: string;
  readonly hits: QaDocsHit[];
  readonly truncated: boolean;
  readonly filesScanned: number;
  readonly skipped: number;
}

/** The outcome of one documentation read. */
export interface QaDocsReadResult extends QaDocsIdentity {
  readonly path: string;
  readonly from: number;
  readonly to: number;
  readonly totalLines: number;
  readonly truncated: boolean;
  readonly text: string;
}

const VERSION_SEGMENT = /^v?\d+(?:\.\d+)*$/iu;

function normalizeVersion(value: string): string {
  return value.replace(/^v/u, "").toLowerCase();
}

/**
 * Identity of one documentation path, read relative to the documentation root.
 *
 * The documented layout is `docs/<module>/<version>/…`: the version is the
 * first directory segment that parses as one (`3.8`, `v2`, `2024.1`), and the
 * module is the directory segment immediately before it. A path with no
 * version segment keeps its first directory segment as the module; a file
 * directly in `docs/` carries neither, and is still searched and read.
 */
export function docsIdentityOf(pathFromDocsRoot: string): QaDocsIdentity {
  const segments = pathFromDocsRoot
    .split(/[\\/]/u)
    .slice(0, -1)
    .filter((segment) => segment !== "");
  if (segments.length === 0) return identityOf(undefined, undefined);
  const versionIndex = segments.findIndex((segment) =>
    VERSION_SEGMENT.test(segment),
  );
  if (versionIndex === -1) return identityOf(undefined, segments[0]);
  return identityOf(
    segments[versionIndex],
    versionIndex > 0 ? segments[versionIndex - 1] : undefined,
  );
}

function identityOf(
  version: string | undefined,
  module: string | undefined,
): QaDocsIdentity {
  return {
    ...(version === undefined ? {} : { version }),
    ...(module === undefined ? {} : { module }),
  };
}

function versionMatches(identity: QaDocsIdentity, wanted: string): boolean {
  if (identity.version === undefined) return false;
  return normalizeVersion(identity.version) === normalizeVersion(wanted);
}

function moduleMatches(identity: QaDocsIdentity, wanted: string): boolean {
  if (identity.module === undefined) return false;
  return identity.module.toLowerCase() === wanted.toLowerCase();
}

/**
 * The canonical documentation root of one call.
 *
 * The root is a real directory inside the canonical workspace: a `docs` entry
 * that is a link or a file is refused rather than followed, because the fence
 * is the point of the tool and a link is how a fence is left.
 */
export async function docsRootOf(exec: QaDocsExecution): Promise<QaDocsRoot> {
  const cwd = exec.agent?.session.header.cwd;
  if (typeof cwd !== "string" || cwd.trim() === "") {
    throw new QaDocsError("workspace-unavailable", WORKSPACE_UNAVAILABLE);
  }
  let workspace: string;
  try {
    workspace = canonicalCandidate(cwd);
  } catch {
    throw new QaDocsError("workspace-unavailable", WORKSPACE_UNAVAILABLE);
  }
  const candidate = join(workspace, QA_DOCS_DIRECTORY);
  const entry = await lstat(candidate).catch(
    (error: unknown): NodeJS.ErrnoException => error as NodeJS.ErrnoException,
  );
  if (entry instanceof Error) {
    if (entry.code === "ENOENT") {
      throw new QaDocsError("docs-unavailable", DOCS_UNAVAILABLE);
    }
    throw new QaDocsError("workspace-unavailable", WORKSPACE_UNAVAILABLE);
  }
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new QaDocsError("docs-unavailable", DOCS_NOT_A_DIRECTORY);
  }
  let docs: string;
  try {
    docs = canonicalCandidate(candidate);
  } catch {
    throw new QaDocsError("workspace-unavailable", WORKSPACE_UNAVAILABLE);
  }
  if (!pathIsInside(docs, workspace)) {
    throw new QaDocsError("symlink-escape", DOCS_ESCAPE);
  }
  return { workspace, docs };
}

/** One documentation target: canonical, and inside the documentation root. */
interface QaDocsTarget {
  readonly absolute: string;
  readonly pathFromDocs: string;
}

/**
 * Resolve one tool path against the documentation root.
 *
 * A path starting with `docs/` is read relative to the workspace; anything
 * else is read relative to the documentation directory. Both spellings are
 * ones the model already sees: `docs_search` reports the first, and a
 * reviewer's remark uses it too.
 */
async function docsTargetOf(
  root: QaDocsRoot,
  input: string,
): Promise<QaDocsTarget> {
  const trimmed = input.trim();
  if (trimmed === "" || isAbsolute(trimmed)) {
    throw new QaDocsError("outside-docs", OUTSIDE_DOCS);
  }
  const normalized = trimmed.replace(/\\/gu, "/").replace(/^\.\//u, "");
  const inside =
    normalized === QA_DOCS_DIRECTORY ||
    normalized.startsWith(`${QA_DOCS_DIRECTORY}/`)
      ? normalized
      : `${QA_DOCS_DIRECTORY}/${normalized}`;
  const spelled = resolve(root.workspace, inside);
  if (!pathIsInside(spelled, root.docs)) {
    throw new QaDocsError("outside-docs", OUTSIDE_DOCS);
  }
  let canonical: string;
  try {
    canonical = canonicalCandidate(spelled);
  } catch {
    throw new QaDocsError("outside-docs", OUTSIDE_DOCS);
  }
  if (!pathIsInside(canonical, root.docs)) {
    throw new QaDocsError("symlink-escape", SYMLINK_ESCAPE);
  }
  return { absolute: canonical, pathFromDocs: relative(root.docs, canonical) };
}

/** A workspace-relative report path: `docs/<…>` with forward slashes. */
function reportPath(pathFromDocsRoot: string): string {
  return [QA_DOCS_DIRECTORY, ...pathFromDocsRoot.split(/[\\/]/u)]
    .filter((segment) => segment !== "")
    .join("/");
}

/**
 * The lines of one documentation file.
 *
 * A file that is missing is a plain error, not an empty read: the model has to
 * know that the path is wrong rather than believe a document is empty.
 * @throws QaDocsError with `not-found` or `not-text`.
 */
async function readDocLines(absolute: string): Promise<readonly string[]> {
  const bytes = await readFile(absolute).catch((): undefined => undefined);
  if (bytes === undefined) {
    throw new QaDocsError("not-found", NOT_FOUND);
  }
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new QaDocsError("not-text", NOT_TEXT);
  }
  let text: string;
  try {
    text = TEXT_DECODER.decode(bytes);
  } catch {
    throw new QaDocsError("not-text", NOT_TEXT);
  }
  if (text.includes("\u0000")) {
    throw new QaDocsError("not-text", NOT_TEXT);
  }
  const lines = text.split(/\r?\n/u);
  // A file that ends with a newline has no trailing empty line of its own.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function boundedLine(line: string): string {
  const trimmed = line.trim();
  return trimmed.length > MAX_LINE_CHARS
    ? `${trimmed.slice(0, MAX_LINE_CHARS)}…`
    : trimmed;
}

function clamp(value: number | undefined, low: number, high: number): number {
  if (value === undefined || !Number.isFinite(value)) return low;
  return Math.min(Math.max(Math.trunc(value), low), high);
}

export interface QaDocsSearchRequest {
  readonly query: string;
  readonly version?: string | undefined;
  readonly module?: string | undefined;
  readonly path?: string | undefined;
  readonly limit?: number | undefined;
}

/** How the walk of a documentation tree should continue. */
type VisitOutcome = "continue" | "stop" | "skip";

interface VisitResult {
  readonly filesScanned: number;
  readonly skipped: number;
  readonly stopped: boolean;
}

/**
 * Visit every documentation file of one target, in path order.
 *
 * Symbolic links are counted as skipped and never followed. The visitor
 * returns `stop` to end the walk, which is how the output budget ends it
 * early.
 */
async function visitDocumentation(
  target: QaDocsTarget,
  visit: (
    file: string,
    pathFromDocs: string,
    explicit: boolean,
  ) => Promise<VisitOutcome>,
): Promise<VisitResult> {
  let filesScanned = 0;
  let skipped = 0;
  const info = await lstat(target.absolute).catch((): undefined => undefined);
  if (info === undefined) {
    throw new QaDocsError("not-found", NOT_FOUND);
  }
  if (info.isFile()) {
    return {
      filesScanned: 1,
      skipped,
      stopped:
        (await visit(target.absolute, target.pathFromDocs, true)) === "stop",
    };
  }
  if (!info.isDirectory()) {
    throw new QaDocsError("not-found", NOT_FOUND);
  }
  const pending = [target];
  while (pending.length > 0) {
    const scope = pending.shift()!;
    const entries = await readdir(scope.absolute, {
      withFileTypes: true,
    }).catch(() => []);
    entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const entry of entries) {
      const child = join(scope.absolute, entry.name);
      const pathFromDocs = join(scope.pathFromDocs, entry.name);
      if (entry.isSymbolicLink()) {
        skipped += 1;
        continue;
      }
      if (entry.isDirectory()) {
        pending.push({ absolute: child, pathFromDocs });
        continue;
      }
      if (!entry.isFile()) continue;
      filesScanned += 1;
      if (filesScanned > MAX_FILES_SCANNED) {
        return { filesScanned, skipped, stopped: true };
      }
      const outcome = await visit(child, pathFromDocs, false);
      if (outcome === "stop") {
        return { filesScanned, skipped, stopped: true };
      }
      if (outcome === "skip") skipped += 1;
    }
  }
  return { filesScanned, skipped, stopped: false };
}

/**
 * Search the documentation tree of one chat workspace.
 *
 * Matching is a case-insensitive substring test, line by line: a hit is a
 * line, not a file, so the caller can cite it. The result is bounded twice —
 * by `limit` hits and by the byte budget of the rendered report — and reports
 * which bound cut it short instead of silently dropping matches.
 * @throws QaDocsError when the tree is missing, the scope path is wrong, or the query is empty.
 */
export async function searchDocumentation(
  root: QaDocsRoot,
  request: QaDocsSearchRequest,
): Promise<QaDocsSearchResult> {
  const query = request.query.trim();
  if (query === "") {
    throw new QaDocsError("invalid-request", INVALID_QUERY);
  }
  const needle = query.toLowerCase();
  const limit = clamp(
    request.limit ?? QA_DOCS_SEARCH_DEFAULT_LIMIT,
    1,
    QA_DOCS_SEARCH_MAX_LIMIT,
  );
  const version = request.version?.trim() ?? "";
  const module = request.module?.trim() ?? "";
  const scope =
    request.path === undefined || request.path.trim() === ""
      ? { absolute: root.docs, pathFromDocs: "" }
      : await docsTargetOf(root, request.path);
  const hits: QaDocsHit[] = [];
  let usedBytes = 0;
  let truncated = false;
  const wanted = (pathFromDocs: string): boolean => {
    const identity = docsIdentityOf(pathFromDocs);
    if (version !== "" && !versionMatches(identity, version)) return false;
    if (module !== "" && !moduleMatches(identity, module)) return false;
    return true;
  };
  const visit = async (
    file: string,
    pathFromDocs: string,
    explicit: boolean,
  ): Promise<VisitOutcome> => {
    if (!wanted(pathFromDocs)) return "continue";
    let lines: readonly string[];
    try {
      lines = await readDocLines(file);
    } catch (error) {
      // A file the walk merely met — binary, unreadable, gone — is skipped;
      // a path the caller named explicitly gets the honest refusal.
      if (explicit) throw error;
      return "skip";
    }
    const identity = docsIdentityOf(pathFromDocs);
    for (const [index, line] of lines.entries()) {
      if (!line.toLowerCase().includes(needle)) continue;
      const hit: QaDocsHit = {
        path: reportPath(pathFromDocs),
        line: index + 1,
        text: boundedLine(line),
        ...identity,
      };
      const size =
        Buffer.byteLength(`${hit.path}:${hit.line}: ${hit.text}`) + 1;
      if (
        hits.length >= limit ||
        usedBytes + size > QA_DOCS_SEARCH_BYTE_BUDGET
      ) {
        truncated = true;
        return "stop";
      }
      hits.push(hit);
      usedBytes += size;
    }
    return "continue";
  };
  const walk = await visitDocumentation(scope, visit);
  return {
    ...identityOf(
      version === "" ? undefined : version,
      module === "" ? undefined : module,
    ),
    query,
    root: QA_DOCS_DIRECTORY,
    hits,
    truncated: truncated || walk.stopped,
    filesScanned: walk.filesScanned,
    skipped: walk.skipped,
  };
}

export interface QaDocsReadRequest {
  readonly path: string;
  readonly from?: number | undefined;
  readonly lines?: number | undefined;
}

/**
 * Read one window of one documentation file of a chat workspace.
 * @throws QaDocsError when the path is outside the tree, missing, a directory, or not text.
 */
export async function readDocumentation(
  root: QaDocsRoot,
  request: QaDocsReadRequest,
): Promise<QaDocsReadResult> {
  const target = await docsTargetOf(root, request.path);
  const info = await lstat(target.absolute).catch((): undefined => undefined);
  if (info === undefined) {
    throw new QaDocsError("not-found", NOT_FOUND);
  }
  if (info.isDirectory()) {
    throw new QaDocsError("not-a-file", NOT_A_FILE);
  }
  if (!info.isFile()) {
    throw new QaDocsError("not-found", NOT_FOUND);
  }
  const lines = await readDocLines(target.absolute);
  const from = Math.max(1, Math.trunc(request.from ?? 1) || 1);
  const window = clamp(
    request.lines ?? QA_DOCS_READ_DEFAULT_LINES,
    1,
    QA_DOCS_READ_MAX_LINES,
  );
  const to = Math.min(from + window - 1, lines.length);
  return {
    ...docsIdentityOf(target.pathFromDocs),
    path: reportPath(target.pathFromDocs),
    from,
    to,
    totalLines: lines.length,
    truncated: to < lines.length || from > 1,
    text: lines.slice(from - 1, Math.max(to, from - 1)).join("\n"),
  };
}

function filtersOf(identity: QaDocsIdentity): string {
  const parts: string[] = [];
  if (identity.version !== undefined && identity.version !== "") {
    parts.push(`version ${identity.version}`);
  }
  if (identity.module !== undefined && identity.module !== "") {
    parts.push(`module ${identity.module}`);
  }
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}

function identityLabel(identity: QaDocsIdentity): string {
  return filtersOf(identity);
}

/**
 * `docs_search` — the catalog's documentation search.
 *
 * The description is part of the tool's job: it states that documentation is
 * read here, from `docs/`, and that memory is not a documentation source. The
 * version/module facets exist so a model that has been told "3.8" stops
 * sweeping the whole tree.
 */
export function createDocsSearchTool(): ToolDefinition {
  return defineTool({
    name: "docs_search",
    description: `Search the stand's documentation, which lives in the ${QA_DOCS_DIRECTORY}/ directory of this chat's workspace. Use it — not memory and not a glob sweep over guessed paths — whenever a question is about the product, a version or a module. Hits are lines, tagged with the module and version parsed from the path (${QA_DOCS_DIRECTORY}/<module>/<version>/…); pass version and module to stay inside one edition, and path to stay inside one subtree. Output is bounded by limit and by a byte budget, and a truncated result says so.`,
    parameters: {
      query: {
        type: "string",
        required: true,
        description:
          "Phrase to look for, matched case-insensitively inside single lines of documentation files.",
      },
      version: {
        type: "string",
        description:
          "Keep only documentation from this version, e.g. `3.8` (the directory segment the path carries).",
      },
      module: {
        type: "string",
        description:
          "Keep only documentation from this module, e.g. `platform` (the directory segment before the version).",
      },
      path: {
        type: "string",
        description: `Narrow the search to one subtree, e.g. \`${QA_DOCS_DIRECTORY}/platform/3.8\` or \`platform/3.8\`.`,
      },
      limit: {
        type: "number",
        description: `Maximum hits to return (default ${QA_DOCS_SEARCH_DEFAULT_LIMIT}, at most ${QA_DOCS_SEARCH_MAX_LIMIT}).`,
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", required: true },
          root: { type: "string", required: true },
          hits: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                path: { type: "string", required: true },
                line: { type: "number", required: true },
                text: { type: "string", required: true },
                version: { type: "string" },
                module: { type: "string" },
              },
            },
          },
          truncated: { type: "boolean", required: true },
          filesScanned: { type: "integer", required: true },
          skipped: { type: "integer", required: true },
        },
      },
      render: (_args, value) => {
        const result = value as QaDocsSearchResult;
        const filters = filtersOf(result);
        if (result.hits.length === 0) {
          return [
            {
              type: "text",
              text: `No documentation under ${QA_DOCS_DIRECTORY}/ matches "${result.query}"${filters} (${result.filesScanned} file(s) scanned). Try another phrase, or widen version/module/path.`,
            },
          ];
        }
        const lines = [
          `${result.hits.length} match(es) for "${result.query}" in ${QA_DOCS_DIRECTORY}/${filters === "" ? "" : filters} (${result.filesScanned} file(s) scanned)${result.truncated ? " — truncated, narrow with version, module or path" : ""}:`,
        ];
        for (const hit of result.hits) {
          lines.push(
            `  ${hit.path}:${hit.line}${identityLabel(hit)} ${hit.text}`,
          );
        }
        return [{ type: "text", text: lines.join("\n") }];
      },
    },
    execute: async (args, exec) => {
      const root = await docsRootOf(exec as QaDocsExecution);
      return searchDocumentation(root, {
        query: args.query,
        version: args.version,
        module: args.module,
        path: args.path,
        limit: args.limit,
      });
    },
  });
}

/** `docs_read` — open one documentation file at a bounded window of lines. */
export function createDocsReadTool(): ToolDefinition {
  return defineTool({
    name: "docs_read",
    description: `Read one documentation file of this chat's workspace, ${QA_DOCS_DIRECTORY}/, at a bounded window of lines. Use it after docs_search reports a path, to read the passage a hit belongs to. Only files inside ${QA_DOCS_DIRECTORY}/ can be read; directories, paths outside the tree and paths that leave it through a symbolic link are refused with the reason.`,
    parameters: {
      path: {
        type: "string",
        required: true,
        description: `The documentation file, as docs_search reports it (\`${QA_DOCS_DIRECTORY}/<module>/<version>/<file>\`) or relative to ${QA_DOCS_DIRECTORY}/.`,
      },
      from: {
        type: "number",
        description: "First line to read, 1-based (default 1).",
      },
      lines: {
        type: "number",
        description: `How many lines to read (default ${QA_DOCS_READ_DEFAULT_LINES}, at most ${QA_DOCS_READ_MAX_LINES}).`,
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", required: true },
          from: { type: "number", required: true },
          to: { type: "number", required: true },
          totalLines: { type: "number", required: true },
          truncated: { type: "boolean", required: true },
          text: { type: "string", required: true },
          version: { type: "string" },
          module: { type: "string" },
        },
      },
      render: (_args, value) => {
        const result = value as QaDocsReadResult;
        const lines = [
          `${result.path} (lines ${result.from}–${result.to} of ${result.totalLines}${identityLabel(result)})${result.truncated ? " — window truncated, read on with from" : ""}:`,
        ];
        result.text.split("\n").forEach((line, index) => {
          lines.push(`${result.from + index}  ${line}`);
        });
        return [{ type: "text", text: lines.join("\n") }];
      },
    },
    execute: async (args, exec) => {
      const root = await docsRootOf(exec as QaDocsExecution);
      return readDocumentation(root, {
        path: args.path,
        from: args.from,
        lines: args.lines,
      });
    },
  });
}
