import { canonicalPath, isLexicallyUnder, listDirectoryLevel, type DirectoryListing, type SessionEvent } from "./core.js";
import {
  SESSION_SCOPE_ERROR,
  SESSION_SCOPE_EVENT,
  SessionScopeError,
  createSessionScopeEvent,
  effectiveSessionScope,
  type EffectiveSessionScope,
  type NormalizeSessionScopeOptions,
  type SessionHeader,
  type SessionScopeEventData,
  type SessionScopeMode,
  type SessionScopeSource,
} from "./session-scope.js";

export interface ScopeSession {
  header?: SessionHeader;
  events: SessionEvent[];
  append(type: typeof SESSION_SCOPE_EVENT, data: SessionScopeEventData): unknown;
}

export interface SetScopeInput {
  mode: SessionScopeMode;
  roots?: unknown;
  source?: SessionScopeSource;
}

export interface ScopeCapabilities {
  focused: true;
  isolated: boolean;
  isolatedBackend: "bwrap" | null;
}

function sessionWorkspaceRoot(session: ScopeSession, fallbackWorkspaceRoot = ""): string {
  const cwd = session.header?.cwd;
  return typeof cwd === "string" && cwd.length > 0 ? cwd : fallbackWorkspaceRoot;
}

export function getScope(session: ScopeSession, fallbackWorkspaceRoot = ""): EffectiveSessionScope {
  return effectiveSessionScope(session.events, {
    cwd: sessionWorkspaceRoot(session, fallbackWorkspaceRoot),
  });
}

export function setScope(
  session: ScopeSession,
  input: SetScopeInput,
  fallbackWorkspaceRoot = "",
  options?: NormalizeSessionScopeOptions,
): SessionScopeEventData {
  const workspaceRoot = sessionWorkspaceRoot(session, fallbackWorkspaceRoot);
  const event = createSessionScopeEvent(
    input.mode,
    input.roots ?? [],
    workspaceRoot,
    input.source ?? "command",
    options,
  );
  const current = getScope(session, fallbackWorkspaceRoot);
  if (
    current.mode === event.mode
    && current.workspaceRoot === event.workspaceRoot
    && current.roots.length === event.roots.length
    && current.roots.every((root, index) => root === event.roots[index])
  ) {
    return event;
  }
  session.append(SESSION_SCOPE_EVENT, event);
  return event;
}

export async function listScopeDirectory(
  session: ScopeSession,
  path: string,
  fallbackWorkspaceRoot = "",
): Promise<DirectoryListing> {
  const workspaceRoot = canonicalPath(sessionWorkspaceRoot(session, fallbackWorkspaceRoot));
  const target = canonicalPath(path);
  if (!workspaceRoot || !isLexicallyUnder(target, workspaceRoot)) {
    throw new SessionScopeError(
      SESSION_SCOPE_ERROR.OUTSIDE_WORKSPACE,
      "Path is outside the session workspace.",
    );
  }
  return listDirectoryLevel(target);
}

export function getScopeCapabilities(
  platform = process.platform,
  isolatedBackendReady = false,
): ScopeCapabilities {
  const isolated = platform === "linux" && isolatedBackendReady;
  return {
    focused: true,
    isolated,
    isolatedBackend: isolated ? "bwrap" : null,
  };
}

export function detectScopeCapabilities(platform = process.platform): ScopeCapabilities {
  // The standalone API has no provider instance to probe and therefore stays
  // conservative. Plugin startup passes functional provider evidence to
  // getScopeCapabilities after exercising the isolated bwrap profile.
  return getScopeCapabilities(platform, false);
}
