import { realpath, stat, unlink } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";

/**
 * `file_delete` — the QA catalog's one destructive capability.
 *
 * The QA surface serves untrusted-audience chats pinned to a read-only or
 * workspace-write sandbox, and until now no chat could remove a file it had
 * created. This tool deletes exactly one regular file strictly inside the
 * calling agent's workspace root (the session cwd) and refuses everything
 * else with a reason the model can act on: directories, missing paths, paths
 * spelled outside the root, and paths that leave it through a symbolic link.
 * Every call is additionally answered `ask` by the always-ask gate, so the
 * interactive approval card parks it for the operator before this body ever
 * runs — the fence here is the second of two boundaries, not the only one.
 *
 * The workspace root is read from `exec.agent` at call time, so building the
 * tool (and the catalog that carries it) stays side-effect free.
 */

/** Why `file_delete` refused a call. */
export type QaFileDeleteRefusal =
  | "workspace-unavailable"
  | "outside-workspace"
  | "symlink-escape"
  | "not-found"
  | "not-a-file";

/**
 * A typed refusal of one `file_delete` call.
 *
 * The message is what the model reads; it names the reason in words and
 * deliberately never echoes the requested absolute host path, so a refusal
 * cannot leak the deployment's layout into the conversation.
 */
export class QaFileDeleteError extends Error {
  constructor(
    readonly code: QaFileDeleteRefusal,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "QaFileDeleteError";
  }
}

/** The slice of the execution record this tool body reads. */
interface QaFileDeleteExecution {
  readonly agent?: {
    readonly session: {
      readonly header: {
        readonly cwd?: string;
      };
    };
  };
}

const OUTSIDE_WORKSPACE =
  "file_delete refused this path: it resolves outside the calling session's workspace. Only files inside the workspace can be deleted; pass a path relative to the workspace root.";
const SYMLINK_ESCAPE =
  "file_delete refused this path: it escapes the workspace through a symbolic link, and links may not be followed out of the workspace.";
const NOT_FOUND =
  "file_delete refused this path: no file exists there. Check the spelling relative to the workspace root, or create the file first.";
const NOT_A_FILE =
  "file_delete refused this path: it is a directory, and only a regular file can be deleted.";

/**
 * The calling agent's workspace root, resolved on disk.
 *
 * A session without a cwd gets a refusal rather than the host process's cwd:
 * guessing a root would point the fence at whatever directory the Host was
 * started from, which is exactly where an untrusted chat must not delete.
 */
async function workspaceRootOf(exec: QaFileDeleteExecution): Promise<string> {
  const cwd = exec.agent?.session.header.cwd;
  if (typeof cwd !== "string" || cwd.trim() === "") {
    throw new QaFileDeleteError(
      "workspace-unavailable",
      "file_delete needs the calling session's workspace root, which this execution does not carry, so nothing is deleted.",
    );
  }
  try {
    return await realpath(cwd);
  } catch {
    throw new QaFileDeleteError(
      "workspace-unavailable",
      "file_delete could not resolve the calling session's workspace root on disk, so nothing is deleted.",
    );
  }
}

/**
 * Whether `target` sits inside `root` once both are canonical. The root
 * itself counts as inside: it is a directory, and the regular-file check is
 * what refuses it, with a reason that matches what is actually there.
 */
function insideRoot(root: string, target: string): boolean {
  const fromRoot = relative(root, target);
  return (
    fromRoot === "" ||
    (!fromRoot.startsWith(`..${sep}`) &&
      fromRoot !== ".." &&
      !isAbsolute(fromRoot))
  );
}

/**
 * Canonical form of `input`: the deepest existing ancestor resolved with
 * `fs.realpath`, the missing suffix re-attached. A final entry that does not
 * exist is still checked against the boundary its existing ancestors really
 * live behind, so a symlinked directory cannot carry a request out of the
 * workspace even when the target file is absent.
 */
async function canonicalCandidate(input: string): Promise<string> {
  const resolved = resolve(input);
  const suffix: string[] = [];
  let cursor = resolved;
  for (;;) {
    try {
      return resolve(await realpath(cursor), ...suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw error;
      suffix.unshift(basename(cursor));
      cursor = parent;
    }
  }
}

export function createFileDeleteTool(): ToolDefinition {
  return defineTool({
    name: "file_delete",
    description:
      "Delete one regular file inside this session's workspace. Use it to remove scratch files a task produced and no longer needs. Directories, missing paths and anything outside the workspace — including paths that escape through a symbolic link — are refused. Every deletion is confirmed by the operator before it runs.",
    parameters: {
      path: {
        type: "string",
        required: true,
        description:
          "The file to delete. Relative paths start at the workspace root; an absolute path must stay inside it.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          deleted: { type: "boolean", required: true },
          path: { type: "string", required: true },
        },
      },
      render: (_args, value) => {
        const record = value as { deleted?: unknown; path?: unknown };
        return [
          {
            type: "text",
            text: `Deleted ${String(record.path)} from the workspace.`,
          },
        ];
      },
    },
    execute: async (args, exec) => {
      const root = await workspaceRootOf(exec);
      // Refuse the spelling first: a path that already leaves the root
      // without any symlink has no reason to touch the filesystem further.
      const absolute = isAbsolute(args.path)
        ? resolve(args.path)
        : resolve(root, args.path);
      if (!insideRoot(root, absolute)) {
        throw new QaFileDeleteError("outside-workspace", OUTSIDE_WORKSPACE);
      }
      let canonical: string;
      try {
        canonical = await canonicalCandidate(absolute);
      } catch {
        throw new QaFileDeleteError(
          "workspace-unavailable",
          "file_delete could not verify the requested path against the workspace boundary, so nothing is deleted.",
        );
      }
      if (!insideRoot(root, canonical)) {
        // The spelling stayed inside but a symbolic link moved the request
        // out: the honest reason names the link, not the workspace.
        throw new QaFileDeleteError("symlink-escape", SYMLINK_ESCAPE);
      }
      const info = await stat(canonical).catch(
        (error: unknown): NodeJS.ErrnoException =>
          error as NodeJS.ErrnoException,
      );
      if (info instanceof Error) {
        if (info.code === "ENOENT") {
          throw new QaFileDeleteError("not-found", NOT_FOUND);
        }
        throw new QaFileDeleteError(
          "workspace-unavailable",
          "file_delete could not inspect the requested entry, so nothing is deleted.",
        );
      }
      if (!info.isFile()) {
        throw new QaFileDeleteError("not-a-file", NOT_A_FILE);
      }
      try {
        await unlink(absolute);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? "unknown";
        throw new QaFileDeleteError(
          "workspace-unavailable",
          `file_delete could not delete the file (${String(code)}).`,
          { cause: error },
        );
      }
      return {
        deleted: true,
        path: relative(root, absolute).split(sep).join("/"),
      };
    },
  });
}
