/**
 * Path arithmetic shared by the reader and the producer.
 *
 * Published as its own subpath (`@yadsh/dsh-audit-core/paths`) because it is
 * the one module in this package that needs `node:path`: the main entry has to
 * stay importable from a browser bundle, where a Node builtin is a load error
 * rather than a fallback.
 *
 * No filesystem access happens here — every decision is a pure function of its
 * arguments, which is what makes containment cheap enough to re-check at every
 * boundary rather than once at startup.
 */
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/**
 * `true` when `candidate` resolves to `root` itself or something under it.
 *
 * Both sides are resolved first, so `..` segments and a trailing separator
 * cannot smuggle a path out. This is the check that stands between a registry
 * entry and an arbitrary file read (SPEC §63).
 */
export function isPathContained(root: string, candidate: string): boolean {
  const rootPath = resolve(root);
  const candidatePath = resolve(candidate);
  if (candidatePath === rootPath) return true;
  const relativePath = relative(rootPath, candidatePath);
  return (
    relativePath.length > 0 &&
    !relativePath.startsWith("..") &&
    !isAbsolute(relativePath)
  );
}

/** `true` when `name` is usable as one directory name under the audit root. */
export function isSafeDirectoryName(name: string): boolean {
  if (name.length === 0 || name === "." || name === "..") return false;
  if (name.includes("/") || name.includes("\\")) return false;
  if (name.includes("\0")) return false;
  // A Windows drive-relative or reserved device name would escape the root.
  if (/^[a-zA-Z]:/u.test(name)) return false;
  return name.trim() === name;
}

/**
 * The directory name a session's audit publishes under.
 *
 * `session-41b4e63f-9e35-…` becomes `session-41b4e63f` — the convention the
 * audit root is already laid out with. The name is an identifier of
 * convenience only: binding always comes from `trajectory.sessionId`, and this
 * name is what prefix resolution falls back to (SPEC §14-15).
 */
export function auditDirectoryName(sessionId: string): string {
  const match = /^session-(?<rest>.*)$/u.exec(sessionId);
  if (match?.groups === undefined) return sessionId;
  const rest = match.groups.rest ?? "";
  const prefix = rest.split("-")[0] ?? "";
  return prefix.length === 0 ? sessionId : `session-${prefix}`;
}

/** Join a directory name onto the audit root, refusing names that escape it. */
export function auditDirectoryPath(root: string, name: string): string {
  if (!isSafeDirectoryName(name)) {
    throw new Error(
      `refusing unsafe audit directory name ${JSON.stringify(name)}`,
    );
  }
  const path = join(root, name);
  if (!isPathContained(root, path)) {
    throw new Error(
      `audit directory ${JSON.stringify(name)} escapes the audit root`,
    );
  }
  return path;
}

/** The staging area a producer writes into before its atomic publish. */
export const AUDIT_INCOMING_DIRECTORY = ".incoming";

/** The two files that make up an audit. */
export const AUDIT_ANALYSIS_FILENAME = "analysis.json";
export const AUDIT_REPORT_FILENAME = "REPORT.md";

/** Platform-aware comparison of two paths that should denote the same file. */
export function isSamePath(left: string, right: string): boolean {
  const normalize = (value: string) =>
    resolve(value).replaceAll(sep, "/").replace(/\/+$/u, "");
  return normalize(left) === normalize(right);
}
