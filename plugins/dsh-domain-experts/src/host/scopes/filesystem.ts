import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import type { ResolvedResourceEntry } from "../../types.js";
import { refusalFor } from "./path-guard.js";
import type {
  DomainScopeProvider,
  ScopeProviderInput,
  ScopeProviderOutput,
} from "./registry.js";

export const FILESYSTEM_PROVIDER_ID = "filesystem";

/** Built-in filesystem scope: the three resource classes of design §13. */
export function createFilesystemProvider(): DomainScopeProvider {
  return {
    id: FILESYSTEM_PROVIDER_ID,
    title: "Filesystem",
    // Paths only become a restriction when a path-aware worker consumes them;
    // the resolver marks entries enforced once such a worker is selected.
    enforcement: "advisory",
    builtin: true,
    validate(): void {
      // The filesystem scope has first-class fields, not a config document.
    },
    describe(): string {
      return "Primary, shared read-only and denied workspace paths.";
    },
    async apply(input: ScopeProviderInput): Promise<ScopeProviderOutput> {
      const { filesystem } = input.domain.scope;
      const enforced = input.enforcedBy.length > 0;
      const enforcement = enforced ? "enforced" : "advisory";
      const enforcedBy = [...input.enforcedBy];
      const entries: ResolvedResourceEntry[] = [
        ...filesystem.primary.map((path) =>
          entry(
            path,
            "primary",
            enforcement,
            enforcedBy,
            "Owned by this domain.",
          ),
        ),
        ...filesystem.sharedReadOnly.map((path) =>
          entry(
            path,
            "shared",
            enforcement,
            enforcedBy,
            "Cross-domain resource, read-only for this domain.",
          ),
        ),
        ...filesystem.denied.map((path) =>
          entry(
            path,
            "denied",
            enforcement,
            enforcedBy,
            "Explicitly outside this domain.",
          ),
        ),
      ];
      return { resources: entries, external: "" };
    },
  };
}

function entry(
  path: string,
  resourceClass: ResolvedResourceEntry["class"],
  enforcement: ResolvedResourceEntry["enforcement"],
  enforcedBy: readonly string[],
  note: string,
): ResolvedResourceEntry {
  return {
    path,
    class: resourceClass,
    enforcement,
    enforcedBy,
    provider: FILESYSTEM_PROVIDER_ID,
    note:
      enforcement === "enforced"
        ? note
        : `${note} Not applied by any selected worker.`,
  };
}

export type ResolvedPath =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Resolve a workspace-relative candidate to an absolute path that is provably
 * inside `root`, following symlinks.
 *
 * Lexical containment is not enough: a symlink inside an allowed root can point
 * anywhere, and an intermediate directory may not exist yet. The check
 * therefore resolves the nearest existing ancestor for real and appends the
 * remaining segments, then requires the result to stay under the real root.
 * Any consumer that hands a path to a subprocess should call this first.
 */
export function resolveWithinRoot(
  root: string,
  candidate: string,
): ResolvedPath {
  const refusal = refusalFor(candidate);
  if (refusal !== null) return { ok: false, reason: refusal };
  if (root === "") return { ok: false, reason: "no-root" };

  const absoluteRoot = existsSync(root) ? realpathSync(root) : resolve(root);
  const target = resolve(absoluteRoot, candidate);

  let probe = target;
  const trailing: string[] = [];
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) return { ok: false, reason: "unresolvable" };
    trailing.unshift(basename(probe));
    probe = parent;
  }

  const realProbe = realpathSync(probe);
  const realTarget =
    trailing.length > 0 ? resolve(realProbe, ...trailing) : realProbe;
  const rel = relative(absoluteRoot, realTarget);
  if (rel === "") return { ok: true, path: absoluteRoot };
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return { ok: false, reason: "symlink-escape" };
  }
  return { ok: true, path: realTarget };
}

/** Resolve every pattern of a scope against one root; failures carry reasons. */
export function resolveAllWithinRoot(
  root: string,
  paths: readonly string[],
): readonly ResolvedPath[] {
  return paths.map((path) => resolveWithinRoot(root, path));
}
