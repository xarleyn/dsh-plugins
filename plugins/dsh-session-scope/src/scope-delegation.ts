import { SELECTION_EVENT, canonicalPath, type SessionEvent } from "./core.js";
import {
  SESSION_SCOPE_ERROR,
  SESSION_SCOPE_EVENT,
  SessionScopeError,
  createSessionScopeEvent,
  effectiveSessionScope,
  type EffectiveSessionScope,
  type SessionHeader,
  type SessionScopeEventData,
} from "./session-scope.js";

export interface DelegatedSessionHeader extends SessionHeader {
  id?: string;
  parentSession?: string;
  seedLength?: number;
  origin?: "subagent";
}

export interface DelegatedScopeSession {
  header: DelegatedSessionHeader;
  events: readonly SessionEvent[];
  append(type: typeof SESSION_SCOPE_EVENT, data: SessionScopeEventData): unknown;
}

export type ParentSessionResolver = (id: string) => DelegatedScopeSession | undefined;

function hasScopeSnapshot(events: readonly SessionEvent[]): boolean {
  return events.some((event) => event.type === SESSION_SCOPE_EVENT);
}

function hasInheritedScopeState(events: readonly SessionEvent[]): boolean {
  return events.some((event) => event.type === SESSION_SCOPE_EVENT || event.type === SELECTION_EVENT);
}

function inheritedSeedScope(session: DelegatedScopeSession): EffectiveSessionScope | undefined {
  const seedLength = session.header.seedLength ?? 0;
  if (seedLength <= 0) return undefined;
  const inherited = session.events.slice(0, seedLength);
  return hasInheritedScopeState(inherited)
    ? effectiveSessionScope(inherited, session.header)
    : undefined;
}

function hasOwnScopeSnapshot(session: DelegatedScopeSession): boolean {
  const ownStart = session.header.seedLength ?? 0;
  return hasScopeSnapshot(session.events.slice(ownStart));
}

/**
 * Persist a subagent's parent scope before the child can execute.
 *
 * A forked child prefers the immutable seed prefix, which captures the scope
 * at the fork boundary. A fresh child resolves its live parent. Resumed
 * children already carry their own delegation snapshot and are left alone.
 */
export function initializeDelegatedSessionScope(
  child: DelegatedScopeSession,
  resolveParent: ParentSessionResolver,
): SessionScopeEventData | undefined {
  if (child.header.origin !== "subagent" || hasOwnScopeSnapshot(child)) return undefined;

  let scope = inheritedSeedScope(child);
  if (scope === undefined) {
    const parentId = child.header.parentSession;
    const parent = parentId === undefined ? undefined : resolveParent(parentId);
    if (parent === undefined) {
      throw new SessionScopeError(
        SESSION_SCOPE_ERROR.PARENT_UNAVAILABLE,
        "The parent session scope is unavailable.",
      );
    }
    scope = effectiveSessionScope(parent.events, parent.header);
  }

  const childWorkspace = child.header.cwd ?? "";
  if (!childWorkspace || canonicalPath(scope.workspaceRoot) !== canonicalPath(childWorkspace)) {
    throw new SessionScopeError(
      SESSION_SCOPE_ERROR.PARENT_UNAVAILABLE,
      "The parent session scope does not match the child workspace.",
    );
  }

  const event = createSessionScopeEvent(
    scope.mode,
    scope.mode === "full" ? [] : scope.roots,
    childWorkspace,
    "delegation",
  );
  child.append(SESSION_SCOPE_EVENT, event);
  return event;
}
