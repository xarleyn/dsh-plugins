import { isAbsolute, relative, resolve } from "node:path";

import { canonicalPath, isLexicallyUnder } from "./core.js";
import type { ScopeSession } from "./host-api.js";
import { getScope } from "./host-api.js";
import {
  assertScopeAccess,
  scopedSearchRoots,
  type ScopedFilesystemOperation,
} from "./scope-visibility.js";
import {
  SESSION_SCOPE_ERROR,
  SessionScopeError,
  type EffectiveSessionScope,
} from "./session-scope.js";

export interface ScopeToolExecution {
  callId?: string;
  rootCallId?: string;
  token?: symbol;
  parent?: symbol;
  name: string;
  arguments: unknown;
  agent?: { session?: ScopeSession };
  signal?: AbortSignal;
}

export interface ScopeToolExecutionResult {
  isError: boolean;
  value?: unknown;
  content: unknown[];
  error?: unknown;
  additionalContexts?: unknown[];
}

export interface ScopeToolDispatcher {
  execute(execution: ScopeToolExecution): Promise<ScopeToolExecutionResult>;
}

export interface ScopeToolGuardOptions {
  splitBroadSearches?: boolean;
  isolatedBackendReady?: boolean;
  sandboxMode?: string;
}

export interface ToolPathRequest {
  path: string;
  operation: ScopedFilesystemOperation;
}

export interface ScopeToolAdapter {
  name: string;
  extractPaths(argumentsValue: unknown): ToolPathRequest[];
}

const DENIAL_REASON = `${SESSION_SCOPE_ERROR.DENIED}: Path is outside the active session scope. Change the session scope if access is required.`;
const ISOLATION_UNAVAILABLE_REASON = `${SESSION_SCOPE_ERROR.ISOLATION_UNAVAILABLE}: Isolated session scope is unavailable for this process execution.`;
const ISOLATION_DANGER_REASON = `${SESSION_SCOPE_ERROR.ISOLATION_UNAVAILABLE}: Isolated session scope cannot execute shell processes with danger-full-access.`;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringField(value: unknown, name: string): string | undefined {
  const object = record(value);
  return typeof object?.[name] === "string" ? object[name] : undefined;
}

function singlePathAdapter(
  name: string,
  field: string,
  operation: ScopedFilesystemOperation | ((args: Record<string, unknown>) => ScopedFilesystemOperation),
): ScopeToolAdapter {
  return {
    name,
    extractPaths(value) {
      const args = record(value);
      const path = stringField(value, field);
      if (args === undefined || path === undefined) return [];
      return [{ path, operation: typeof operation === "function" ? operation(args) : operation }];
    },
  };
}

function searchPathAdapter(name: string): ScopeToolAdapter {
  return {
    name,
    extractPaths(value) {
      const args = record(value);
      if (args === undefined) return [];
      const path = stringField(value, "path") ?? ".";
      return [{ path, operation: "search" }];
    },
  };
}

export const DEFAULT_TOOL_ADAPTERS: readonly ScopeToolAdapter[] = Object.freeze([
  singlePathAdapter("read", "file_path", "read"),
  singlePathAdapter("read_image", "file_path", "read"),
  singlePathAdapter("write", "file_path", "write"),
  singlePathAdapter("edit", "file_path", "write"),
  searchPathAdapter("glob"),
  searchPathAdapter("grep"),
  singlePathAdapter("str_replace_editor", "path", (args) => args.command === "view" ? "list" : "write"),
]);

export class ScopeToolAdapterRegistry {
  private readonly adapters = new Map<string, ScopeToolAdapter>();

  constructor(adapters: readonly ScopeToolAdapter[] = DEFAULT_TOOL_ADAPTERS) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: ScopeToolAdapter): () => void {
    if (!adapter.name || this.adapters.has(adapter.name)) {
      throw new Error(`session-scope tool adapter already registered: ${adapter.name}`);
    }
    this.adapters.set(adapter.name, adapter);
    return () => {
      if (this.adapters.get(adapter.name) === adapter) this.adapters.delete(adapter.name);
    };
  }

  requests(execution: ScopeToolExecution): ToolPathRequest[] {
    return this.adapters.get(execution.name)?.extractPaths(execution.arguments) ?? [];
  }
}

function absoluteToolPath(
  path: string,
  scope: EffectiveSessionScope,
  sessionWorkspaceRoot?: string,
): string {
  const target = isAbsolute(path) ? path : resolve(scope.workspaceRoot, path);
  const workspaceSpellings = [scope.workspaceRoot, sessionWorkspaceRoot]
    .filter((root): root is string => typeof root === "string" && root.length > 0);
  const originatedInsideWorkspace = workspaceSpellings.some((root) => isLexicallyUnder(target, root));
  const canonicalTarget = canonicalPath(target);
  const aliasMappedTarget = sessionWorkspaceRoot
    && !samePath(sessionWorkspaceRoot, scope.workspaceRoot)
    && isLexicallyUnder(target, sessionWorkspaceRoot)
    ? resolve(scope.workspaceRoot, relative(sessionWorkspaceRoot, target))
    : undefined;
  const identityTarget = !samePath(canonicalTarget, target)
    ? canonicalTarget
    : aliasMappedTarget ?? canonicalTarget;

  // A path lexically inside the session workspace which resolves outside it
  // is a symlink/alias escape, not an ordinary external host path.
  if (originatedInsideWorkspace && !isLexicallyUnder(identityTarget, scope.workspaceRoot)) {
    throw new SessionScopeError(SESSION_SCOPE_ERROR.SYMLINK_ESCAPE, "Path resolves outside the session workspace.");
  }
  // Missing targets cannot be realpathed, so identityTarget may instead be
  // mapped from a session-header alias (notably a Windows 8.3 path).
  return identityTarget;
}

/** Monotonic tool guard: undefined allows; a stable reason string denies. */
export function guardScopeToolExecution(
  execution: ScopeToolExecution,
  adapters: ScopeToolAdapterRegistry,
  fallbackWorkspaceRoot = "",
  options: ScopeToolGuardOptions = {},
): string | undefined {
  const session = execution.agent?.session;
  if (session === undefined) return undefined;
  const scope = getScope(session, fallbackWorkspaceRoot);
  const sessionWorkspaceRoot = session.header?.cwd;
  if (scope.mode === "full") return undefined;
  // Current LSP providers index and return locations for the entire immutable
  // session cwd. An input-path check alone cannot prevent hidden sibling
  // symbols or hover content from leaking through the server result.
  if (execution.name === "lsp") return DENIAL_REASON;
  try {
    for (const request of adapters.requests(execution)) {
      const target = absoluteToolPath(request.path, scope, sessionWorkspaceRoot);
      if (
        request.operation === "search"
        && options.splitBroadSearches === true
        && (execution.name === "glob" || execution.name === "grep")
      ) {
        scopedSearchRoots(scope, target);
      } else {
        assertScopeAccess(scope, target, request.operation);
      }
    }
    if (scope.mode === "isolated" && (execution.name === "bash" || execution.name === "terminal_open")) {
      if (options.isolatedBackendReady !== true) return ISOLATION_UNAVAILABLE_REASON;
      const args = record(execution.arguments);
      if (options.sandboxMode === "danger-full-access" || stringField(args, "sandbox_permissions") === "danger-full-access") {
        return ISOLATION_DANGER_REASON;
      }
      const field = execution.name === "bash" ? "workdir" : "cwd";
      const requestedWorkingDirectory = stringField(args, field);
      if (requestedWorkingDirectory !== undefined) {
        const target = absoluteToolPath(requestedWorkingDirectory, scope, sessionWorkspaceRoot);
        if (!samePath(target, scope.workspaceRoot)) assertScopeAccess(scope, target, "list");
      }
    }
    return undefined;
  } catch {
    return DENIAL_REASON;
  }
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function mergeGlobValues(
  requestedRoot: string,
  results: readonly ScopeToolExecutionResult[],
  scope: EffectiveSessionScope,
): ScopeToolExecutionResult {
  const paths = new Set<string>();
  for (const result of results) {
    const value = record(result.value);
    if (!Array.isArray(value?.paths)) continue;
    for (const path of value.paths) {
      if (typeof path !== "string") continue;
      try {
        assertScopeAccess(scope, absoluteToolPath(path, scope), "search");
        paths.add(path);
      } catch {
        // A malformed or changed search backend cannot leak a hidden path.
      }
    }
  }
  return {
    isError: false,
    value: { root: requestedRoot, paths: [...paths] },
    content: [],
  };
}

function mergeGrepValues(
  results: readonly ScopeToolExecutionResult[],
  scope: EffectiveSessionScope,
): ScopeToolExecutionResult {
  const matches: unknown[] = [];
  for (const result of results) {
    const value = record(result.value);
    if (!Array.isArray(value?.matches)) continue;
    for (const match of value.matches) {
      const path = stringField(match, "path");
      if (path === undefined) continue;
      try {
        assertScopeAccess(scope, absoluteToolPath(path, scope), "search");
        matches.push(match);
      } catch {
        // Drop the entire match, including its line content, on any path leak.
      }
    }
  }
  return {
    isError: false,
    value: { matches },
    content: [],
  };
}

/**
 * Split a navigation-root glob/grep into child calls under content roots.
 * Direct searches already inside one content root pass through unchanged.
 */
export async function dispatchScopedSearchExecution(
  execution: ScopeToolExecution,
  dispatcher: ScopeToolDispatcher,
  next: () => Promise<ScopeToolExecutionResult>,
  fallbackWorkspaceRoot = "",
): Promise<ScopeToolExecutionResult> {
  if (execution.name !== "glob" && execution.name !== "grep") return next();
  const session = execution.agent?.session;
  const args = record(execution.arguments);
  if (session === undefined || args === undefined) return next();
  const scope = getScope(session, fallbackWorkspaceRoot);
  if (scope.mode === "full") return next();

  const requestedPath = typeof args.path === "string" ? args.path : ".";
  const requestedRoot = absoluteToolPath(requestedPath, scope, session.header?.cwd);
  const roots = scopedSearchRoots(scope, requestedRoot);
  if (roots.length === 1 && samePath(roots[0]!, requestedRoot)) return next();

  const results: ScopeToolExecutionResult[] = [];
  for (let index = 0; index < roots.length; index += 1) {
    const result = await dispatcher.execute({
      callId: `${execution.callId ?? execution.name}:scope:${index}`,
      rootCallId: execution.rootCallId ?? execution.callId,
      name: execution.name,
      arguments: { ...args, path: roots[index] },
      agent: execution.agent,
      signal: execution.signal,
      parent: execution.token,
    });
    if (result.isError) return result;
    results.push(result);
  }

  return execution.name === "glob"
    ? mergeGlobValues(requestedPath, results, scope)
    : mergeGrepValues(results, scope);
}
