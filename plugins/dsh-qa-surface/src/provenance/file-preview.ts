import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { QaSourceFilePreview } from "../types.js";
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
  const limit = Math.min(maxBytes, info.size);
  const buffer = Buffer.alloc(limit);
  const handle = await open(canonical, "r").catch(() => undefined);
  if (handle === undefined) throw new QaSourcePreviewError("unavailable");
  try {
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    const markdown = /\.(?:md|markdown)$/iu.test(canonical);
    return {
      path: canonicalPath,
      content: buffer.subarray(0, bytesRead).toString("utf8"),
      size: info.size,
      truncated: info.size > bytesRead,
      markdown,
      renderableMarkdown: markdown && info.size <= maxMarkdownRenderBytes,
    };
  } finally {
    await handle.close();
  }
}
