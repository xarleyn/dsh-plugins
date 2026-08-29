import type { DirectoryEntry, DirectoryListing } from "./core.js";
import { isLexicallyUnder } from "./core.js";
import {
  SESSION_SCOPE_ERROR,
  SessionScopeError,
  type EffectiveSessionScope,
} from "./session-scope.js";

export type ScopePathVisibility = "content" | "navigation" | "denied";
export type ScopedFilesystemOperation = "read" | "write" | "list" | "search";

function samePath(left: string, right: string, caseSensitive: boolean): boolean {
  return caseSensitive ? left === right : left.toLowerCase() === right.toLowerCase();
}

export function classifyScopePath(
  scope: EffectiveSessionScope,
  target: string,
  caseSensitive = process.platform !== "win32",
): ScopePathVisibility {
  if (scope.mode === "full") return "content";
  // Scope narrows only the session workspace. OS/user paths outside it remain
  // governed by the ordinary DSH permission policy (see the spec non-goals).
  if (!isLexicallyUnder(target, scope.workspaceRoot, caseSensitive)) return "content";
  if (scope.roots.some((root) => isLexicallyUnder(target, root, caseSensitive))) return "content";
  if (scope.navigationRoots.some((root) => samePath(target, root, caseSensitive))) return "navigation";
  return "denied";
}

export function assertScopeAccess(
  scope: EffectiveSessionScope,
  target: string,
  operation: ScopedFilesystemOperation,
  caseSensitive = process.platform !== "win32",
): ScopePathVisibility {
  const visibility = classifyScopePath(scope, target, caseSensitive);
  const allowed = visibility === "content" || operation === "list" && visibility === "navigation";
  if (!allowed) {
    throw new SessionScopeError(
      SESSION_SCOPE_ERROR.DENIED,
      "Path is outside the active session scope.",
    );
  }
  return visibility;
}

function entryLeadsToContent(
  entry: DirectoryEntry,
  scope: EffectiveSessionScope,
  caseSensitive: boolean,
): boolean {
  return scope.roots.some((root) =>
    isLexicallyUnder(root, entry.path, caseSensitive)
    || isLexicallyUnder(entry.path, root, caseSensitive)
  );
}

/** Filter a one-level listing without disclosing hidden sibling names. */
export function filterScopeDirectoryListing(
  scope: EffectiveSessionScope,
  listing: DirectoryListing,
  caseSensitive = process.platform !== "win32",
): DirectoryListing {
  const visibility = assertScopeAccess(scope, listing.path, "list", caseSensitive);
  if (scope.mode === "full" || visibility === "content") return listing;
  return {
    ...listing,
    crumbs: listing.crumbs.filter((crumb) =>
      classifyScopePath(scope, crumb.path, caseSensitive) !== "denied"
    ),
    entries: listing.entries.filter((entry) => entryLeadsToContent(entry, scope, caseSensitive)),
  };
}

/**
 * Reduce a glob/grep/search request to content roots. Callers execute one
 * search per returned root and merge results; an empty array is a denial.
 */
export function scopedSearchRoots(
  scope: EffectiveSessionScope,
  requestedRoot: string,
  caseSensitive = process.platform !== "win32",
): string[] {
  if (scope.mode === "full") return [requestedRoot];
  const insideWorkspace = isLexicallyUnder(requestedRoot, scope.workspaceRoot, caseSensitive);
  const containsWorkspace = isLexicallyUnder(scope.workspaceRoot, requestedRoot, caseSensitive);
  if (!insideWorkspace && !containsWorkspace) return [requestedRoot];
  if (scope.roots.some((root) => isLexicallyUnder(requestedRoot, root, caseSensitive))) {
    return [requestedRoot];
  }
  const roots = scope.roots.filter((root) => isLexicallyUnder(root, requestedRoot, caseSensitive));
  if (roots.length === 0) {
    throw new SessionScopeError(
      SESSION_SCOPE_ERROR.DENIED,
      "Path is outside the active session scope.",
    );
  }
  return roots;
}
