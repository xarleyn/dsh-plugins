import path from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolExecution } from "@deepseek-ai/dsh-tools";
import { qaFilesystemIntent } from "../filesystem-intent.js";
import type { QaSessionOwnership } from "../session-ownership.js";
import type { QaFileWritePolicy } from "../shared/file-write-policy.js";
import { canonicalCandidate } from "../user-workspace.js";

/** Check both path spellings, including Windows suffix and stream aliases. */
function blockedSuffix(file: string, extensions: readonly string[]) {
  const basename = file.split(/[/\\]/u).at(-1) ?? "";
  const normalized = basename
    .split(":", 1)[0]!
    .replace(/[. ]+$/u, "")
    .toLowerCase();
  return extensions.find((extension) => normalized.endsWith(extension));
}

/** Global monotonic guard: covers attested roots, children and nested dispatch. */
export function installQaFileWriteGate(
  ctx: Context,
  ownership: QaSessionOwnership,
  policy: () => QaFileWritePolicy,
): () => void {
  ownership.install(ctx);
  return ctx.tools.guard((execution: Readonly<ToolExecution>) => {
    const session = execution.agent?.session;
    if (
      session === undefined ||
      ownership.rootOf(String(session.id)) === undefined
    )
      return undefined;
    const args = execution.arguments;
    if (args === null || typeof args !== "object" || Array.isArray(args))
      return undefined;
    const intent = qaFilesystemIntent(
      execution.name,
      args as Record<string, unknown>,
    );
    if (intent?.kind !== "write") return undefined;
    const current = policy();
    if (current.blockedExtensions.length === 0) return undefined;
    const denied = (extension: string) =>
      `QA file write blocked (${extension}). ${current.message}`;
    const requested = blockedSuffix(intent.path, current.blockedExtensions);
    if (requested !== undefined) return denied(requested);
    // An allowed-looking symlink must not overwrite a blocked target.
    try {
      const absolute = path.isAbsolute(intent.path)
        ? intent.path
        : path.resolve(session.header.cwd ?? ".", intent.path);
      const canonical = blockedSuffix(
        canonicalCandidate(absolute),
        current.blockedExtensions,
      );
      return canonical === undefined ? undefined : denied(canonical);
    } catch {
      return `QA file write policy could not verify the target. ${current.message}`;
    }
  });
}
