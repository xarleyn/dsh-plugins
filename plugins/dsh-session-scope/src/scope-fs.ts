import { AsyncLocalStorage } from "node:async_hooks";

import type { ScopeSession } from "./host-api.js";
import { getScope } from "./host-api.js";
import { isLexicallyUnder } from "./core.js";
import type { ScopeToolExecution } from "./tool-guard.js";
import {
  SESSION_SCOPE_ERROR,
  SessionScopeError,
  type EffectiveSessionScope,
} from "./session-scope.js";

export interface ScopeFsTarget {
  targetKey: unknown;
  displayPath: string;
}

export interface ScopeFsDirEntry {
  name: string;
  type: "file" | "directory" | "other";
  target: ScopeFsTarget;
  [key: string]: unknown;
}

export interface ScopeAwareFileSystem {
  resolve(path: string, options?: { cwd?: string; signal?: AbortSignal }): Promise<ScopeFsTarget>;
  contains(parent: ScopeFsTarget, child: ScopeFsTarget): boolean;
  stat(target: ScopeFsTarget, signal?: AbortSignal): Promise<unknown>;
  lstat(path: string, options?: { cwd?: string }, signal?: AbortSignal): Promise<unknown>;
  readText(target: ScopeFsTarget, signal?: AbortSignal): Promise<string>;
  streamText(target: ScopeFsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>>;
  readBytes(target: ScopeFsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>;
  listDir(target: ScopeFsTarget, signal?: AbortSignal): Promise<ScopeFsDirEntry[]>;
  writeText(target: ScopeFsTarget, ...args: unknown[]): Promise<unknown>;
  editText(target: ScopeFsTarget, ...args: unknown[]): Promise<unknown>;
}

interface ResolvedScope {
  scope: EffectiveSessionScope;
  workspace: ScopeFsTarget;
  workspaceSpellings: string[];
  content: ScopeFsTarget[];
  navigation: ScopeFsTarget[];
}

interface CachedScope extends ResolvedScope {
  eventCount: number;
  key: string;
}

type ScopeFsAccess = "content" | "navigation" | "denied";

interface SessionScopeRuntimeContext {
  session: ScopeSession;
  execution?: ScopeToolExecution;
}

const DENIAL_MESSAGE = "Path is outside the active session scope. Change the session scope if access is required.";

export class SessionScopeRuntime {
  readonly storage = new AsyncLocalStorage<SessionScopeRuntimeContext>();

  private readonly cache = new WeakMap<ScopeSession, CachedScope>();

  run<T>(session: ScopeSession | undefined, operation: () => T, execution?: ScopeToolExecution): T {
    if (session === undefined) return operation();
    return this.storage.run({ session, execution }, operation);
  }

  currentSession(): ScopeSession | undefined {
    return this.storage.getStore()?.session;
  }

  currentExecution(): ScopeToolExecution | undefined {
    return this.storage.getStore()?.execution;
  }

  private async resolvedScope(
    fs: ScopeAwareFileSystem,
    session: ScopeSession,
    fallbackWorkspaceRoot: string,
  ): Promise<ResolvedScope> {
    const scope = getScope(session, fallbackWorkspaceRoot);
    if (scope.mode === "full") {
      const workspace = await fs.resolve(scope.workspaceRoot);
      return {
        scope,
        workspace,
        workspaceSpellings: [scope.workspaceRoot, session.header?.cwd ?? fallbackWorkspaceRoot],
        content: [],
        navigation: [],
      };
    }
    const key = JSON.stringify([scope.mode, scope.workspaceRoot, scope.roots, scope.navigationRoots]);
    const cached = this.cache.get(session);
    if (cached?.eventCount === session.events.length && cached.key === key) return cached;
    const resolveOne = (path: string) => fs.resolve(path, { cwd: scope.workspaceRoot });
    const value: CachedScope = {
      scope,
      workspace: await resolveOne(scope.workspaceRoot),
      workspaceSpellings: [scope.workspaceRoot, session.header?.cwd ?? fallbackWorkspaceRoot],
      content: await Promise.all(scope.roots.map(resolveOne)),
      navigation: await Promise.all(
        [...new Set([scope.workspaceRoot, ...scope.navigationRoots])].map(resolveOne),
      ),
      eventCount: session.events.length,
      key,
    };
    this.cache.set(session, value);
    return value;
  }

  private classify(fs: ScopeAwareFileSystem, resolved: ResolvedScope, target: ScopeFsTarget): ScopeFsAccess {
    if (resolved.scope.mode === "full") return "content";
    if (!fs.contains(resolved.workspace, target)) {
      const originatedInsideWorkspace = resolved.workspaceSpellings.some((root) =>
        root.length > 0 && isLexicallyUnder(target.displayPath, root)
      );
      return originatedInsideWorkspace ? "denied" : "content";
    }
    if (resolved.content.some((root) => fs.contains(root, target))) return "content";
    if (resolved.navigation.some((root) => fs.contains(root, target) && fs.contains(target, root))) {
      return "navigation";
    }
    return "denied";
  }

  private deny(): never {
    throw new SessionScopeError(SESSION_SCOPE_ERROR.DENIED, DENIAL_MESSAGE);
  }

  patchFileSystem(fs: ScopeAwareFileSystem, fallbackWorkspaceRoot = ""): () => void {
    const original = {
      stat: fs.stat.bind(fs),
      lstat: fs.lstat.bind(fs),
      readText: fs.readText.bind(fs),
      streamText: fs.streamText.bind(fs),
      readBytes: fs.readBytes.bind(fs),
      listDir: fs.listDir.bind(fs),
      writeText: fs.writeText.bind(fs),
      editText: fs.editText.bind(fs),
    };
    const resolveCurrent = async () => {
      const session = this.currentSession();
      return session === undefined ? undefined : this.resolvedScope(fs, session, fallbackWorkspaceRoot);
    };

    fs.stat = async (target, signal) => {
      const scope = await resolveCurrent();
      if (scope !== undefined && this.classify(fs, scope, target) === "denied") this.deny();
      return original.stat(target, signal);
    };
    fs.lstat = async (path, options, signal) => {
      const scope = await resolveCurrent();
      if (scope !== undefined) {
        const target = await fs.resolve(path, { cwd: options?.cwd ?? scope.scope.workspaceRoot, signal });
        if (this.classify(fs, scope, target) === "denied") this.deny();
      }
      return original.lstat(path, options, signal);
    };
    fs.readText = async (target, signal) => {
      const scope = await resolveCurrent();
      if (scope !== undefined && this.classify(fs, scope, target) !== "content") this.deny();
      return original.readText(target, signal);
    };
    fs.streamText = async (target, signal) => {
      const scope = await resolveCurrent();
      if (scope !== undefined && this.classify(fs, scope, target) !== "content") this.deny();
      return original.streamText(target, signal);
    };
    fs.readBytes = async (target, signal, maxBytes) => {
      const scope = await resolveCurrent();
      if (scope !== undefined && this.classify(fs, scope, target) !== "content") this.deny();
      return original.readBytes(target, signal, maxBytes);
    };
    fs.listDir = async (target, signal) => {
      const scope = await resolveCurrent();
      if (scope === undefined || scope.scope.mode === "full") return original.listDir(target, signal);
      const access = this.classify(fs, scope, target);
      if (access === "denied") this.deny();
      const entries = await original.listDir(target, signal);
      if (access === "content") return entries;
      return entries.filter((entry) => scope.content.some((root) =>
        fs.contains(entry.target, root) || fs.contains(root, entry.target)
      ));
    };
    fs.writeText = async (target, ...args) => {
      const scope = await resolveCurrent();
      if (scope !== undefined && this.classify(fs, scope, target) !== "content") this.deny();
      return original.writeText(target, ...args);
    };
    fs.editText = async (target, ...args) => {
      const scope = await resolveCurrent();
      if (scope !== undefined && this.classify(fs, scope, target) !== "content") this.deny();
      return original.editText(target, ...args);
    };

    return () => {
      fs.stat = original.stat;
      fs.lstat = original.lstat;
      fs.readText = original.readText;
      fs.streamText = original.streamText;
      fs.readBytes = original.readBytes;
      fs.listDir = original.listDir;
      fs.writeText = original.writeText;
      fs.editText = original.editText;
    };
  }
}
