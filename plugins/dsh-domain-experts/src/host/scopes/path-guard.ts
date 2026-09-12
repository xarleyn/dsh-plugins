import type { FilesystemScopeConfig, ResourceClass } from "../../types.js";
import { normalizePath } from "../schema.js";

/**
 * Lexical path containment for scope globs.
 *
 * This is the plugin's only real enforcement primitive: it is pure, so both a
 * host-side worker adapter and the resolver's enforcement table use the same
 * decision, and every escape case in the tests exercises the code that a
 * consumer would actually call. It never touches the filesystem — a symlink
 * check needs real paths and belongs to the consumer that has them
 * ({@link import("./filesystem.js").resolveWithinRoot}).
 */

/** A compiled pattern, reusable across many candidates. */
export interface CompiledGlob {
  readonly pattern: string;
  test(path: string): boolean;
}

const CACHE_LIMIT = 512;
const cache = new Map<string, CompiledGlob>();

/**
 * Compile a workspace-relative glob.
 *
 * - `**` spans path separators and may match zero segments, so `a/**` matches
 *   `a` itself as well as everything below it.
 * - `*` and `?` stay inside one segment.
 */
export function compileGlob(pattern: string): CompiledGlob {
  const cached = cache.get(pattern);
  if (cached !== undefined) return cached;
  const compiled = { pattern, test: matcherFor(pattern) };
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(pattern, compiled);
  return compiled;
}

function matcherFor(pattern: string): (path: string) => boolean {
  const normalized = normalizePath(pattern);
  if (normalized === "") return () => false;
  const expression = globToRegExp(normalized);
  return (path: string) => expression.test(normalizePath(path));
}

function globToRegExp(pattern: string): RegExp {
  let out = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] ?? "";
    if (char === "*") {
      const isDouble = pattern[index + 1] === "*";
      if (!isDouble) {
        out += "[^/]*";
        continue;
      }
      const followedBySlash = pattern[index + 2] === "/";
      if (followedBySlash) {
        // `**/` — zero or more whole segments.
        out += "(?:[^/]+/)*";
        index += 2;
      } else {
        // A trailing `/**` also matches the directory itself; a bare `**`
        // matches everything.
        out = out.endsWith("/") ? `${out.slice(0, -1)}(?:/.*)?` : `${out}.*`;
        index += 1;
      }
      continue;
    }
    if (char === "?") {
      out += "[^/]";
      continue;
    }
    out += char.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  }
  return new RegExp(`${out}$`, "u");
}

export function globMatches(pattern: string, path: string): boolean {
  return compileGlob(pattern).test(path);
}

/** Why a candidate path was refused. */
export type PathRefusal =
  | "empty"
  | "absolute"
  | "escape"
  | "nul-byte"
  | "denied"
  | "outside-scope";

export type PathDecision =
  | { readonly allowed: true; readonly class: ResourceClass; readonly matchedBy: string }
  | { readonly allowed: false; readonly reason: PathRefusal; readonly matchedBy: string };

export interface PathRules {
  readonly primary: readonly string[];
  readonly sharedReadOnly: readonly string[];
  readonly denied: readonly string[];
}

/** Reject the shapes that make a glob decision meaningless before matching. */
export function refusalFor(candidate: string): PathRefusal | null {
  const trimmed = candidate.trim();
  if (trimmed === "") return "empty";
  if (trimmed.includes("\0")) return "nul-byte";
  if (trimmed.startsWith("/") || /^[A-Za-z]:[/\\]/u.test(trimmed)) return "absolute";
  const segments = normalizePath(trimmed).split("/");
  if (segments.includes("..")) return "escape";
  return null;
}

/**
 * Decide one candidate path against a filesystem scope.
 *
 * Denial wins over any allow, and a path that no rule classifies is refused:
 * the enforced reading of the scope is "already inside the allowed set", not
 * "not explicitly forbidden".
 */
export function decidePath(rules: PathRules, candidate: string): PathDecision {
  const refusal = refusalFor(candidate);
  if (refusal !== null) return { allowed: false, reason: refusal, matchedBy: "" };
  const path = normalizePath(candidate);

  for (const pattern of rules.denied) {
    if (globMatches(pattern, path)) {
      return { allowed: false, reason: "denied", matchedBy: pattern };
    }
  }
  for (const pattern of rules.primary) {
    if (globMatches(pattern, path)) {
      return { allowed: true, class: "primary", matchedBy: pattern };
    }
  }
  for (const pattern of rules.sharedReadOnly) {
    if (globMatches(pattern, path)) {
      return { allowed: true, class: "shared", matchedBy: pattern };
    }
  }
  return { allowed: false, reason: "outside-scope", matchedBy: "" };
}

export function pathRulesOf(filesystem: FilesystemScopeConfig): PathRules {
  return {
    primary: filesystem.primary,
    sharedReadOnly: filesystem.sharedReadOnly,
    denied: filesystem.denied,
  };
}

/** Allowed roots a consumer can hand to a path-aware worker. */
export function allowedRootsOf(filesystem: FilesystemScopeConfig): readonly string[] {
  return [...filesystem.primary, ...filesystem.sharedReadOnly];
}

/** Read-only roots; a consumer must not let a worker write below these. */
export function readOnlyRootsOf(filesystem: FilesystemScopeConfig): readonly string[] {
  return [...filesystem.sharedReadOnly];
}

export function isWriteAllowed(filesystem: FilesystemScopeConfig, candidate: string): boolean {
  const decision = decidePath(pathRulesOf(filesystem), candidate);
  return decision.allowed && decision.class === "primary";
}
