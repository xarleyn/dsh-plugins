import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import {
  MAX_ROOTS,
  SELECTION_EVENT,
  canonicalPath,
  isLexicallyUnder,
  selectionOf,
  type SessionEvent,
} from "./core.js";

export const SESSION_SCOPE_EVENT = "session-scope/set" as const;

export const SESSION_SCOPE_ERROR = Object.freeze({
  DENIED: "SESSION_SCOPE_DENIED",
  INVALID_ROOT: "SESSION_SCOPE_INVALID_ROOT",
  OUTSIDE_WORKSPACE: "SESSION_SCOPE_OUTSIDE_WORKSPACE",
  SYMLINK_ESCAPE: "SESSION_SCOPE_SYMLINK_ESCAPE",
  ISOLATION_UNAVAILABLE: "SESSION_SCOPE_ISOLATION_UNAVAILABLE",
  PROCESS_ACTIVE: "SESSION_SCOPE_PROCESS_ACTIVE",
  PARENT_UNAVAILABLE: "SESSION_SCOPE_PARENT_UNAVAILABLE",
  STALE_WORKSPACE: "SESSION_SCOPE_STALE_WORKSPACE",
} as const);

export type SessionScopeErrorCode = (typeof SESSION_SCOPE_ERROR)[keyof typeof SESSION_SCOPE_ERROR];
export type SessionScopeMode = "full" | "focused" | "isolated";
export type SessionScopeSource = "ui" | "command" | "migration" | "delegation";

export interface SessionScopeEventData {
  version: 1;
  mode: SessionScopeMode;
  roots: string[];
  workspaceRoot: string;
  source?: SessionScopeSource;
}

export interface SessionHeader {
  cwd?: string;
}

export interface EffectiveSessionScope {
  mode: SessionScopeMode;
  workspaceRoot: string;
  roots: string[];
  navigationRoots: string[];
}

export interface ScopePathServices {
  canonical(path: string): string;
  isDirectory(path: string): boolean;
}

export interface NormalizeSessionScopeOptions {
  allowExternalRoots?: boolean;
  caseSensitive?: boolean;
  paths?: ScopePathServices;
}

const DEFAULT_PATH_SERVICES: ScopePathServices = {
  canonical: canonicalPath,
  isDirectory(path) {
    if (!existsSync(path)) return false;
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
};

const MODES = new Set<SessionScopeMode>(["full", "focused", "isolated"]);

export class SessionScopeError extends Error {
  readonly code: SessionScopeErrorCode;

  constructor(code: SessionScopeErrorCode, message: string) {
    super(message);
    this.name = "SessionScopeError";
    this.code = code;
  }
}

function comparisonKey(path: string, caseSensitive: boolean): string {
  return caseSensitive ? path : path.toLowerCase();
}

/** Drop duplicate and descendant roots already covered by a selected parent. */
export function collapseNestedRoots(
  roots: readonly string[],
  caseSensitive = process.platform !== "win32",
): string[] {
  const unique = new Map<string, string>();
  for (const root of roots) {
    if (typeof root !== "string" || root.length === 0) continue;
    unique.set(comparisonKey(root, caseSensitive), root);
  }
  const candidates = [...unique.values()].sort(
    (left, right) => left.length - right.length
      || comparisonKey(left, caseSensitive).localeCompare(comparisonKey(right, caseSensitive)),
  );
  const result: string[] = [];
  for (const candidate of candidates) {
    if (result.some((root) => isLexicallyUnder(candidate, root, caseSensitive))) continue;
    result.push(candidate);
  }
  return result.sort((left, right) =>
    comparisonKey(left, caseSensitive).localeCompare(comparisonKey(right, caseSensitive))
  );
}

/** Ancestors visible only for navigation from the workspace to content roots. */
export function navigationRootsFor(
  workspaceRoot: string,
  roots: readonly string[],
  caseSensitive = process.platform !== "win32",
): string[] {
  if (!workspaceRoot) return [];
  const ancestors = new Map<string, string>();
  for (const root of roots) {
    if (!isLexicallyUnder(root, workspaceRoot, caseSensitive)) continue;
    let current = dirname(root);
    while (isLexicallyUnder(current, workspaceRoot, caseSensitive)) {
      ancestors.set(comparisonKey(current, caseSensitive), current);
      if (comparisonKey(current, caseSensitive) === comparisonKey(workspaceRoot, caseSensitive)) break;
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  const distanceFromWorkspace = (path: string): number => {
    let distance = 0;
    let current = path;
    while (comparisonKey(current, caseSensitive) !== comparisonKey(workspaceRoot, caseSensitive)) {
      const parent = dirname(current);
      if (parent === current) return Number.MAX_SAFE_INTEGER;
      distance += 1;
      current = parent;
    }
    return distance;
  };
  return [...ancestors.values()].sort((left, right) =>
    distanceFromWorkspace(left) - distanceFromWorkspace(right)
      || comparisonKey(left, caseSensitive).localeCompare(comparisonKey(right, caseSensitive))
  );
}

/** Validate and canonicalize roots immediately before persisting a snapshot. */
export function normalizeSessionScopeRoots(
  input: unknown,
  workspaceRoot: string,
  options: NormalizeSessionScopeOptions = {},
): string[] {
  const {
    allowExternalRoots = false,
    caseSensitive = process.platform !== "win32",
    paths = DEFAULT_PATH_SERVICES,
  } = options;
  if (!Array.isArray(input)) {
    throw new SessionScopeError(SESSION_SCOPE_ERROR.INVALID_ROOT, "Invalid session scope root list.");
  }
  if (input.length > MAX_ROOTS) {
    throw new SessionScopeError(
      SESSION_SCOPE_ERROR.INVALID_ROOT,
      `Session scope supports at most ${MAX_ROOTS} roots.`,
    );
  }
  if (!isAbsolute(workspaceRoot) || !paths.isDirectory(workspaceRoot)) {
    throw new SessionScopeError(SESSION_SCOPE_ERROR.STALE_WORKSPACE, "The session workspace is unavailable.");
  }

  const lexicalWorkspace = resolve(workspaceRoot);
  const canonicalWorkspace = paths.canonical(workspaceRoot);
  const roots: string[] = [];
  for (const candidate of input) {
    if (typeof candidate !== "string" || !isAbsolute(candidate) || !paths.isDirectory(candidate)) {
      throw new SessionScopeError(
        SESSION_SCOPE_ERROR.INVALID_ROOT,
        "A selected session scope root is invalid or unavailable.",
      );
    }
    const lexicalCandidate = resolve(candidate);
    const canonicalCandidate = paths.canonical(candidate);
    const lexicalInside = isLexicallyUnder(lexicalCandidate, lexicalWorkspace, caseSensitive);
    const canonicalInside = isLexicallyUnder(canonicalCandidate, canonicalWorkspace, caseSensitive);
    if (!allowExternalRoots && !lexicalInside && !canonicalInside) {
      throw new SessionScopeError(
        SESSION_SCOPE_ERROR.OUTSIDE_WORKSPACE,
        "A selected path is outside the session workspace.",
      );
    }
    if (!allowExternalRoots && lexicalInside && !canonicalInside) {
      throw new SessionScopeError(
        SESSION_SCOPE_ERROR.SYMLINK_ESCAPE,
        "A selected path resolves outside the session workspace.",
      );
    }
    roots.push(canonicalCandidate);
  }
  return collapseNestedRoots(roots, caseSensitive);
}

function isScopeMode(value: unknown): value is SessionScopeMode {
  return typeof value === "string" && MODES.has(value as SessionScopeMode);
}

function latestScopeData(events: readonly SessionEvent[]): Record<string, unknown> | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === SESSION_SCOPE_EVENT) return events[index]?.data;
  }
  return undefined;
}

function foldedRoots(
  roots: unknown,
  workspaceRoot: string,
  caseSensitive: boolean,
): string[] {
  if (!Array.isArray(roots) || !workspaceRoot) return [];
  const valid = roots.flatMap((root) => {
    if (typeof root !== "string" || !isAbsolute(root)) return [];
    const canonicalRoot = canonicalPath(root);
    return isLexicallyUnder(canonicalRoot, workspaceRoot, caseSensitive)
      ? [canonicalRoot]
      : [];
  });
  return collapseNestedRoots(valid, caseSensitive);
}

/** Fold new durable state, falling back to the upstream event only for legacy sessions. */
export function effectiveSessionScope(
  events: readonly SessionEvent[],
  sessionHeader: SessionHeader = {},
  caseSensitive = process.platform !== "win32",
): EffectiveSessionScope {
  const data = latestScopeData(events);
  const headerRoot = typeof sessionHeader.cwd === "string" ? sessionHeader.cwd : "";
  const canonicalHeaderRoot = headerRoot ? canonicalPath(headerRoot) : "";
  if (data !== undefined) {
    const validSnapshot = data.version === 1 && isScopeMode(data.mode);
    const mode: SessionScopeMode = validSnapshot ? data.mode as SessionScopeMode : "focused";
    const eventRoot = typeof data.workspaceRoot === "string" ? data.workspaceRoot : "";
    const canonicalEventRoot = eventRoot ? canonicalPath(eventRoot) : "";
    const workspaceRoot = canonicalHeaderRoot || canonicalEventRoot;
    if (mode === "full") return { mode, workspaceRoot, roots: [], navigationRoots: [] };

    // Malformed or stale persisted restrictions fail closed instead of widening
    // the session back to the full workspace.
    const stale = Boolean(
      canonicalHeaderRoot
      && canonicalEventRoot
      && comparisonKey(canonicalHeaderRoot, caseSensitive) !== comparisonKey(canonicalEventRoot, caseSensitive),
    );
    const roots = validSnapshot && !stale
      ? foldedRoots(data.roots, workspaceRoot, caseSensitive)
      : [];
    return {
      mode,
      workspaceRoot,
      roots,
      navigationRoots: navigationRootsFor(workspaceRoot, roots, caseSensitive),
    };
  }

  if (events.some((event) => event.type === SELECTION_EVENT)) {
    const legacy = selectionOf(events);
    const workspaceRoot = canonicalHeaderRoot
      || (legacy.workspaceRoot ? canonicalPath(legacy.workspaceRoot) : "");
    const roots = foldedRoots(legacy.roots, workspaceRoot, caseSensitive);
    return {
      mode: "focused",
      workspaceRoot,
      roots,
      navigationRoots: navigationRootsFor(workspaceRoot, roots, caseSensitive),
    };
  }

  return { mode: "full", workspaceRoot: canonicalHeaderRoot, roots: [], navigationRoots: [] };
}

export function createSessionScopeEvent(
  mode: SessionScopeMode,
  roots: unknown,
  workspaceRoot: string,
  source: SessionScopeSource,
  options?: NormalizeSessionScopeOptions,
): SessionScopeEventData {
  const canonicalWorkspaceRoot = (options?.paths ?? DEFAULT_PATH_SERVICES).canonical(workspaceRoot);
  return {
    version: 1,
    mode,
    workspaceRoot: canonicalWorkspaceRoot,
    roots: mode === "full" ? [] : normalizeSessionScopeRoots(roots, workspaceRoot, options),
    source,
  };
}
