import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";

/** Stable, non-workspace child used to keep account directories out of sight. */
export const QA_USER_WORKSPACES_DIRECTORY = ".qa-users";

/** Conservative fixed budgets; there is deliberately no browser override. */
export const QA_USER_WORKSPACE_MAX_BYTES = 256 * 1024 * 1024;
export const QA_USER_WORKSPACE_MAX_WRITE_BYTES = 10 * 1024 * 1024;

const USER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PATH_DENIAL =
  "QA workspace boundary: path is outside this user's directory.";
const QUOTA_DENIAL = "QA workspace boundary: storage quota exceeded.";

export interface QaToolExecutionLike {
  readonly name: string;
  readonly arguments: unknown;
}

export interface QaUserWorkspaceReadPolicy {
  /** Shared directories exposed only to read-only filesystem tools. */
  readonly sharedReadOnlyRoots?: readonly string[];
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

export function pathIsInside(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

/**
 * Resolve the deepest existing ancestor, preserving the missing suffix. This
 * catches symlink escapes for reads and for files which a write is about to
 * create.
 */
export function canonicalCandidate(input: string): string {
  const resolved = path.resolve(input);
  const suffix: string[] = [];
  let cursor = resolved;
  for (;;) {
    try {
      return path.resolve(realpathSync.native(cursor), ...suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      suffix.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

function assertPlainDirectory(input: string): void {
  const stat = lstatSync(input);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`QA user workspace must be a real directory: ${input}`);
  }
}

/**
 * Materialize `<registered workspace>/.qa-users/<account UUID>` without
 * registering the child as a DSH Workspace. Both directory levels reject
 * symlinks, and their real paths must stay below the configured workspace.
 */
export function prepareQaUserWorkspace(
  workspaceRoot: string,
  userId: string,
): string {
  if (!USER_ID_PATTERN.test(userId)) {
    throw new Error("QA account id is not safe for a workspace directory");
  }
  const canonicalWorkspace = realpathSync.native(workspaceRoot);
  const usersRoot = path.join(canonicalWorkspace, QA_USER_WORKSPACES_DIRECTORY);
  mkdirSync(usersRoot, { recursive: true, mode: 0o700 });
  assertPlainDirectory(usersRoot);
  if (process.platform !== "win32") chmodSync(usersRoot, 0o700);
  const canonicalUsersRoot = realpathSync.native(usersRoot);
  if (!pathIsInside(canonicalUsersRoot, canonicalWorkspace)) {
    throw new Error("QA user-workspace root escapes the configured workspace");
  }

  const userRoot = path.join(canonicalUsersRoot, userId);
  mkdirSync(userRoot, { recursive: true, mode: 0o700 });
  assertPlainDirectory(userRoot);
  if (process.platform !== "win32") chmodSync(userRoot, 0o700);
  const canonicalUserRoot = realpathSync.native(userRoot);
  if (
    !pathIsInside(canonicalUserRoot, canonicalUsersRoot) ||
    !samePath(path.dirname(canonicalUserRoot), canonicalUsersRoot)
  ) {
    throw new Error("QA user workspace escapes its account directory");
  }
  return canonicalUserRoot;
}

/** Resolve an already provisioned account directory for admission checks. */
export function existingQaUserWorkspace(
  workspaceRoot: string,
  userId: string,
): string {
  if (!USER_ID_PATTERN.test(userId)) {
    throw new Error("QA account id is not safe for a workspace directory");
  }
  const canonicalWorkspace = realpathSync.native(workspaceRoot);
  const usersRoot = path.join(canonicalWorkspace, QA_USER_WORKSPACES_DIRECTORY);
  const userRoot = path.join(usersRoot, userId);
  assertPlainDirectory(usersRoot);
  assertPlainDirectory(userRoot);
  const canonicalUsersRoot = realpathSync.native(usersRoot);
  const canonicalUserRoot = realpathSync.native(userRoot);
  if (
    !pathIsInside(canonicalUsersRoot, canonicalWorkspace) ||
    !pathIsInside(canonicalUserRoot, canonicalUsersRoot) ||
    !samePath(path.dirname(canonicalUserRoot), canonicalUsersRoot)
  ) {
    throw new Error("QA user workspace escapes the configured workspace");
  }
  return canonicalUserRoot;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function requestedPaths(execution: QaToolExecutionLike): readonly string[] {
  const args = record(execution.arguments);
  if (args === undefined) return [];
  switch (execution.name) {
    case "read":
    case "read_image":
    case "write":
    case "edit": {
      return typeof args.file_path === "string" ? [args.file_path] : [];
    }
    case "glob":
    case "grep": {
      return [typeof args.path === "string" ? args.path : "."];
    }
    case "str_replace_editor": {
      return typeof args.path === "string" ? [args.path] : [];
    }
    default:
      return [];
  }
}

/**
 * Whether the named path is only read. Directory-wide tools stay confined even
 * for reads: the attachment store is shared by every account, and only the
 * exact file an upload produced is meant to be reachable.
 */
function readsSharedRoot(execution: QaToolExecutionLike): boolean {
  if (
    execution.name === "read" ||
    execution.name === "read_image" ||
    execution.name === "glob" ||
    execution.name === "grep"
  ) {
    return true;
  }
  return (
    execution.name === "str_replace_editor" &&
    record(execution.arguments)?.command === "view"
  );
}

function readsSingleFile(execution: QaToolExecutionLike): boolean {
  if (execution.name === "read" || execution.name === "read_image") return true;
  return (
    execution.name === "str_replace_editor" &&
    record(execution.arguments)?.command === "view"
  );
}

function directoryBytes(root: string, stopAfter: number): number {
  let total = 0;
  const pending = [root];
  while (pending.length > 0 && total <= stopAfter) {
    const current = pending.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isFile()) total += statSync(candidate).size;
      if (total > stopAfter) break;
    }
  }
  return total;
}

function requestedWriteBytes(execution: QaToolExecutionLike): number {
  const args = record(execution.arguments);
  if (args === undefined) return 0;
  const values = [args.content, args.new_string, args.new_str];
  return values.reduce<number>(
    (total, value) =>
      total + (typeof value === "string" ? Buffer.byteLength(value) : 0),
    0,
  );
}

/**
 * Monotonic guard used in addition to DSH's workspace-write sandbox. It
 * fences model-controlled file paths for both reads and writes, rejects tools
 * whose implementation can walk above cwd, and enforces bounded scratch use.
 *
 * `attachmentRoot` is the one deliberate read exemption: an uploaded file is
 * an immutable content-addressed copy the deployment stores outside every
 * workspace, and the model reaches it exactly as the harness intends (the
 * prompt carries the stored path). Reads of a single such file are allowed;
 * directory-wide tools stay confined because the store is shared by every
 * account, and writes are never exempted.
 */
export function qaUserWorkspaceDenial(
  execution: QaToolExecutionLike,
  root: string,
  attachmentRoot?: string,
  readPolicy: QaUserWorkspaceReadPolicy = {},
): string | undefined {
  const args = record(execution.arguments);
  if (
    args?.sandbox_permissions !== undefined ||
    (execution.name === "edit" &&
      (args?.replace_all === true || args?.replaceAll === true))
  ) {
    return PATH_DENIAL;
  }
  if (
    execution.name === "bash" ||
    execution.name === "shell" ||
    execution.name.startsWith("terminal_") ||
    execution.name.startsWith("job_") ||
    execution.name === "run_code" ||
    execution.name === "lsp" ||
    execution.name === "apply_patch"
  ) {
    return PATH_DENIAL;
  }
  const readsShared = readsSharedRoot(execution);
  const readsOneFile = readsSingleFile(execution);
  try {
    const sharedReadOnlyRoots = (readPolicy.sharedReadOnlyRoots ?? []).map(
      canonicalCandidate,
    );
    for (const requested of requestedPaths(execution)) {
      const absolute = path.isAbsolute(requested)
        ? requested
        : path.resolve(root, requested);
      const canonical = canonicalCandidate(absolute);
      if (pathIsInside(canonical, root)) continue;
      if (
        readsShared &&
        sharedReadOnlyRoots.some((readRoot) =>
          pathIsInside(canonical, readRoot),
        )
      ) {
        continue;
      }
      // Resolved only for a path the fence would otherwise refuse, so the
      // common case pays no extra filesystem walk.
      if (
        readsOneFile &&
        attachmentRoot !== undefined &&
        pathIsInside(canonical, canonicalCandidate(attachmentRoot))
      ) {
        continue;
      }
      return PATH_DENIAL;
    }
    if (
      execution.name === "write" ||
      execution.name === "edit" ||
      (execution.name === "str_replace_editor" &&
        record(execution.arguments)?.command !== "view")
    ) {
      const requested = requestedWriteBytes(execution);
      if (
        requested > QA_USER_WORKSPACE_MAX_WRITE_BYTES ||
        directoryBytes(root, QA_USER_WORKSPACE_MAX_BYTES) + requested >
          QA_USER_WORKSPACE_MAX_BYTES
      ) {
        return QUOTA_DENIAL;
      }
    }
    return undefined;
  } catch {
    return PATH_DENIAL;
  }
}
