import { open, realpath, stat, lstat, readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type {
  QaSourceFilePreview,
  QaWorkspaceEntry,
  QaWorkspaceFile,
  QaWorkspaceListing,
} from "../types.js";
import { canonicalizeWorkspacePath } from "./normalize.js";

/**
 * Coarse, wire-safe preview refusal codes. They ride the shared
 * `(reason: <code>)` marker, so the panel can tell "this file is not in a
 * directory the QA read policy opens" from "this file is gone" instead of
 * telling every audience that a present file moved away.
 */
export type QaSourcePreviewReason =
  "outside-roots" | "not-evidence" | "unavailable";

/** Host refusal whose wire message carries the coarse reason marker. */
export class QaSourcePreviewError extends Error {
  constructor(readonly reason: QaSourcePreviewReason) {
    super("Source preview is unavailable.");
    this.name = "QaSourcePreviewError";
  }
}

export interface QaSourceFilePreviewRequest {
  readonly sourcePath: string;
  /**
   * The attested chat's cwd. It is the root every relative source path in the
   * evidence bundle was canonicalized against, and the anchor this read
   * resolves a relative request against.
   */
  readonly cwd: string;
  /**
   * Whether one canonical path is evidence of the attested chat. The preview
   * never browses: it opens exactly the files the bundle already recorded.
   */
  readonly isEvidence: (canonicalPath: string) => boolean;
  /**
   * Shared read directories of the deployment. The per-user execution guard
   * already lets the model read these, so a source recorded from one of them
   * must stay previewable.
   */
  readonly sharedReadOnlyRoots?: readonly string[];
  /**
   * The mounted attachment store. It sits outside every workspace on purpose,
   * and the upload prompt points the model at the exact file an upload
   * produced, so that one file is readable here too.
   */
  readonly attachmentRoot?: string;
  readonly maxBytes: number;
  readonly maxMarkdownRenderBytes: number;
}

/** Canonical form of one root, or nothing when that root is not there at all. */
async function canonicalRoot(root: string): Promise<string | undefined> {
  try {
    return await realpath(root);
  } catch {
    return undefined;
  }
}

/** Whether a canonical file sits strictly below a canonical root. */
function insideRoot(root: string, file: string): boolean {
  const fromRoot = relative(root, file);
  return (
    fromRoot !== "" &&
    fromRoot !== ".." &&
    !fromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(fromRoot)
  );
}

/** A file request the panel may make: the chat's own tree or a shared root. */
export interface QaAllowedFileRequest {
  readonly filePath: string;
  /** The attested chat's cwd: the anchor a relative request resolves against. */
  readonly cwd: string;
  readonly sharedReadOnlyRoots?: readonly string[];
  readonly attachmentRoot?: string;
}

/** One resolved file that passed the read policy. */
interface QaAllowedFile {
  /** The path as the caller spelled it, canonicalized against the chat cwd. */
  readonly canonicalPath: string;
  /** Its real filesystem path, once symlinks are followed. */
  readonly canonical: string;
  readonly size: number;
}

/**
 * Resolve one requested file and check it against the readable roots.
 *
 * The roots mirror the per-user execution guard — the chat's own cwd plus the
 * deployment's shared read-only directories and the attachment store — so a
 * file the model was explicitly allowed to read stays readable in the panel,
 * while anything else is refused with the coarse `outside-roots` reason
 * instead of leaking whether it exists.
 */
async function resolveAllowedFile({
  filePath,
  cwd,
  sharedReadOnlyRoots = [],
  attachmentRoot,
}: QaAllowedFileRequest): Promise<QaAllowedFile> {
  const canonicalPath = canonicalizeWorkspacePath(filePath, cwd);
  const chatRoot = await canonicalRoot(cwd);
  if (chatRoot === undefined) throw new QaSourcePreviewError("unavailable");
  const candidate = isAbsolute(canonicalPath)
    ? canonicalPath
    : resolve(chatRoot, canonicalPath);
  const canonical = await realpath(candidate).catch(() => undefined);
  if (canonical === undefined) throw new QaSourcePreviewError("unavailable");

  const declared = [chatRoot, ...sharedReadOnlyRoots];
  if (attachmentRoot !== undefined) declared.push(attachmentRoot);
  const allowed = (await Promise.all(declared.map(canonicalRoot))).filter(
    (root): root is string => root !== undefined,
  );
  if (!allowed.some((root) => insideRoot(root, canonical))) {
    throw new QaSourcePreviewError("outside-roots");
  }

  const info = await stat(canonical).catch(() => undefined);
  if (info === undefined || !info.isFile()) {
    throw new QaSourcePreviewError("unavailable");
  }
  return { canonicalPath, canonical, size: info.size };
}

/**
 * Read one evidence file from the roots the QA read policy opens.
 *
 * The bundle canonicalized each recorded path against the chat cwd, while the
 * browser may hold either spelling of the same file: it projects sources with
 * the *configured* session cwd, which is null whenever the chat is pinned by
 * workspaceId or by an account directory. So the request is canonicalized the
 * same way before it is matched, or a file inside the chat's own workspace is
 * refused as foreign evidence.
 */
export async function readSourceFilePreview({
  sourcePath,
  cwd,
  isEvidence,
  sharedReadOnlyRoots = [],
  attachmentRoot,
  maxBytes,
  maxMarkdownRenderBytes,
}: QaSourceFilePreviewRequest): Promise<QaSourceFilePreview> {
  const canonicalPath = canonicalizeWorkspacePath(sourcePath, cwd);
  if (!isEvidence(canonicalPath)) {
    throw new QaSourcePreviewError("not-evidence");
  }
  const file = await resolveAllowedFile({
    filePath: canonicalPath,
    cwd,
    sharedReadOnlyRoots,
    ...(attachmentRoot === undefined ? {} : { attachmentRoot }),
  });
  const limit = Math.min(maxBytes, file.size);
  const buffer = Buffer.alloc(limit);
  const handle = await open(file.canonical, "r").catch(() => undefined);
  if (handle === undefined) throw new QaSourcePreviewError("unavailable");
  try {
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    const markdown = /\.(?:md|markdown)$/iu.test(file.canonical);
    return {
      path: canonicalPath,
      content: buffer.subarray(0, bytesRead).toString("utf8"),
      size: file.size,
      truncated: file.size > bytesRead,
      markdown,
      renderableMarkdown: markdown && file.size <= maxMarkdownRenderBytes,
    };
  } finally {
    await handle.close();
  }
}

/** One directory request from the files panel. */
export interface QaWorkspaceListRequest {
  /** The directory to list, absolute or relative to the chat cwd. Empty = root. */
  readonly dirPath: string;
  readonly cwd: string;
  /** Children one listing carries; the rest is reported as truncated. */
  readonly maxEntries: number;
}

/** Extensions the preview advertises so the panel can pick a renderer. */
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  bmp: "image/bmp",
  csv: "text/csv",
  gif: "image/gif",
  html: "text/html",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  md: "text/markdown",
  markdown: "text/markdown",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  txt: "text/plain",
  webp: "image/webp",
  xml: "text/xml",
  yaml: "text/yaml",
  yml: "text/yaml",
};

/** The advertised type of one file: by extension, else opaque bytes. */
function mimeOf(path: string): string {
  const extension = /\.([a-z\d]+)$/iu.exec(path)?.[1]?.toLowerCase();
  return (
    (extension === undefined ? undefined : MIME_BY_EXTENSION[extension]) ??
    "application/octet-stream"
  );
}

/** Whether a byte window decodes as UTF-8 text rather than binary. */
function decodesAsText(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

/**
 * List one directory of the chat's own workspace.
 *
 * Browsing is deliberately narrower than previewing: the panel walks the tree
 * the chat works in, never the deployment's shared read-only roots, so the
 * visitor cannot enumerate the deployment from the rail. The request is
 * confined with the same realpath-then-contain check the preview uses, which
 * is what makes `..` and symlinked directories harmless.
 * Symlinked children are omitted rather than followed: a link inside the
 * workspace may point anywhere, and a tree that silently leaves the chat's
 * directory is worse than one that hides a link.
 */
export async function listWorkspaceDirectory({
  dirPath,
  cwd,
  maxEntries,
}: QaWorkspaceListRequest): Promise<QaWorkspaceListing> {
  const requested = canonicalizeWorkspacePath(dirPath, cwd);
  const chatRoot = await canonicalRoot(cwd);
  if (chatRoot === undefined) throw new QaSourcePreviewError("unavailable");
  const candidate =
    requested === "" || requested === "."
      ? chatRoot
      : isAbsolute(requested)
        ? requested
        : resolve(chatRoot, requested);
  const canonical = await realpath(candidate).catch(() => undefined);
  if (canonical === undefined) throw new QaSourcePreviewError("unavailable");
  if (canonical !== chatRoot && !insideRoot(chatRoot, canonical)) {
    throw new QaSourcePreviewError("outside-roots");
  }

  const info = await stat(canonical).catch(() => undefined);
  if (info === undefined || !info.isDirectory()) {
    throw new QaSourcePreviewError("unavailable");
  }
  const dirents = await readdir(canonical, { withFileTypes: true }).catch(
    () => undefined,
  );
  if (dirents === undefined) throw new QaSourcePreviewError("unavailable");

  const entries: QaWorkspaceEntry[] = [];
  let truncated = false;
  const sorted = [...dirents].sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
  for (const dirent of sorted) {
    if (dirent.isSymbolicLink()) continue;
    const type = dirent.isDirectory()
      ? "directory"
      : dirent.isFile()
        ? "file"
        : undefined;
    if (type === undefined) continue;
    if (entries.length >= maxEntries) {
      truncated = true;
      break;
    }
    const size =
      type === "file"
        ? ((await lstat(resolve(canonical, dirent.name)).catch(() => undefined))
            ?.size ?? null)
        : null;
    entries.push({ name: dirent.name, type, size });
  }
  entries.sort((left, right) => {
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
    return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
  });
  return { path: requested === "." ? "" : requested, entries, truncated };
}

/** One file request from the files panel. */
export interface QaWorkspaceFileRequest extends QaAllowedFileRequest {
  readonly maxBytes: number;
  readonly maxMarkdownRenderBytes: number;
}

/**
 * Read one file of the chat's workspace for the panel: text when it decodes as
 * UTF-8, base64 bytes when it does not, so a document the agent produced can be
 * offered for download while a note previews inline.
 *
 * Unlike the source preview this is not bound to recorded evidence — the panel
 * browses what the chat's workspace holds — but it is bound to the same roots
 * the model itself may read.
 */
export async function readWorkspaceFile({
  filePath,
  cwd,
  sharedReadOnlyRoots = [],
  attachmentRoot,
  maxBytes,
  maxMarkdownRenderBytes,
}: QaWorkspaceFileRequest): Promise<QaWorkspaceFile> {
  const file = await resolveAllowedFile({
    filePath,
    cwd,
    sharedReadOnlyRoots,
    ...(attachmentRoot === undefined ? {} : { attachmentRoot }),
  });
  const limit = Math.min(maxBytes, file.size);
  const buffer = Buffer.alloc(limit);
  const handle = await open(file.canonical, "r").catch(() => undefined);
  if (handle === undefined) throw new QaSourcePreviewError("unavailable");
  let read: Awaited<ReturnType<typeof handle.read>>;
  try {
    read = await handle.read(buffer, 0, limit, 0);
  } finally {
    await handle.close();
  }
  const bytesRead = read.bytesRead;
  const window = buffer.subarray(0, bytesRead);
  const markdown = /\.(?:md|markdown)$/iu.test(file.canonical);
  const truncated = file.size > bytesRead;
  const base = {
    path: file.canonicalPath,
    size: file.size,
    truncated,
    markdown,
    renderableMarkdown: markdown && file.size <= maxMarkdownRenderBytes,
    mime: mimeOf(file.canonical),
  };
  // A truncated read of a text file stays text: the panel shows the head and
  // says the rest was cut, which is more useful than refusing the whole file.
  if (!decodesAsText(window) && !truncated) {
    return { ...base, base64: window.toString("base64") };
  }
  return { ...base, text: window.toString("utf8") };
}
