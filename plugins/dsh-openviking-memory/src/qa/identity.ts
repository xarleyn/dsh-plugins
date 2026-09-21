/**
 * Which QA account a session's memory belongs to.
 *
 * One memory plugin serves every chat on a deployment, while every QA account
 * must keep its own OpenViking space. QA Surface is the authority on that
 * attribution: `principalForSession` answers only for a chat root the account
 * itself attested, and fails closed for anything else — including an admin
 * viewing somebody else's conversation.
 *
 * This module turns that authority into a per-session answer and caches it:
 * a chat root resolves directly, a delegated child inherits the root that
 * created it, and a session nobody has claimed yet resolves to nothing. The
 * plugin reads "nothing" as *leave this session alone* rather than *use the
 * shared space*, so a conversation never lands in — or reads from — an account
 * space before it has been attributed to one.
 */

import type { Context } from "@deepseek-ai/cordis";
import type { Session } from "@deepseek-ai/dsh-session";

/** What the plugin needs from QA Surface; the host half of its public service. */
export interface QaMemoryPrincipal {
  readonly userId: string;
}

/**
 * Structural face of `ctx.qaSurface`. Declared here rather than imported so the
 * memory plugin keeps working — and keeps typechecking — in a deployment that
 * installs no QA surface at all.
 */
export interface QaMemorySurface {
  /** The account behind a directly attested chat root, or nothing. */
  principalForSession(sessionId: string): QaMemoryPrincipal | undefined;
  /** The account behind a bearer token; the settings page authenticates so. */
  principalForToken(token: string): QaMemoryPrincipal | undefined;
}

/**
 * How long an unresolved session is trusted to stay unresolved. A chat is
 * attested when its browser half opens it, which can trail the moment the
 * session starts (a restart resumes chats before anybody re-opens them), so a
 * "no" is re-asked — but not on every step of every turn.
 */
const UNRESOLVED_RETRY_MS = 5_000;

interface CachedResolution {
  /** The account, or an explicit `undefined` while the session is unclaimed. */
  readonly userId: string | undefined;
  /** When the answer was last computed; only unresolved answers expire. */
  readonly at: number;
}

/** Resolves and remembers the QA account behind a session. */
export class QaMemoryIdentity {
  private readonly roots = new Map<string, string>();
  private readonly resolved = new Map<string, CachedResolution>();
  private installDisposer: (() => void) | undefined;
  private installed = false;

  constructor(private readonly surface: () => QaMemorySurface | undefined) {}

  /**
   * Follow `session/created`. A child session carries the id of the session
   * that created it, which is what makes the inheritance below possible without
   * asking the surface about a session it deliberately refuses to answer for.
   *
   * Registered unconditionally, and cheaply: recording a lineage needs no
   * surface, and a deployment that mounts none never consults the map.
   */
  install(ctx: Context): void {
    if (this.installed) return;
    this.installed = true;
    this.installDisposer = ctx.on("session/created", (session) => {
      this.inherit(session);
    });
  }

  /** Drop every cached answer; the surface behind them has gone away. */
  dispose(): void {
    this.installDisposer?.();
    this.installDisposer = undefined;
    this.installed = false;
    this.roots.clear();
    this.resolved.clear();
  }

  /** Forget one session's attribution; called when its agent is gone. */
  forget(sessionId: string): void {
    this.roots.delete(sessionId);
    this.resolved.delete(sessionId);
  }

  /**
   * The account this session belongs to, or `undefined` while the session is
   * unattributed. Cheap after the first answer: a resolved account is cached
   * for the session's lifetime.
   */
  userIdFor(session: Session | undefined): string | undefined {
    const surface = this.surface();
    if (surface === undefined || session === undefined) return undefined;

    const sessionId = String(session.id);
    const cached = this.resolved.get(sessionId);
    if (
      cached !== undefined &&
      (cached.userId !== undefined ||
        Date.now() - cached.at < UNRESOLVED_RETRY_MS)
    ) {
      return cached.userId;
    }

    const userId =
      this.directUserId(surface, sessionId) ??
      this.inheritedUserId(surface, session, sessionId);
    this.resolved.set(sessionId, { userId, at: Date.now() });
    return userId;
  }

  private directUserId(
    surface: QaMemorySurface,
    sessionId: string,
  ): string | undefined {
    return surface.principalForSession(sessionId)?.userId;
  }

  /**
   * The account of the chat this session was delegated from. The delegation
   * parent is remembered from `session/created`; the header is the fallback for
   * a session whose creation predates this plugin instance.
   */
  private inheritedUserId(
    surface: QaMemorySurface,
    session: Session,
    sessionId: string,
  ): string | undefined {
    const parent = session.header?.parentSession;
    const parentId = parent === undefined ? undefined : String(parent);
    const candidate =
      this.roots.get(sessionId) ??
      (parentId === undefined
        ? undefined
        : (this.roots.get(parentId) ?? parentId));
    if (candidate === undefined) return undefined;
    this.roots.set(sessionId, candidate);
    return this.directUserId(surface, candidate);
  }

  /** Remember which chat a newly created session descends from. */
  private inherit(session: Session): void {
    const parent = session.header?.parentSession;
    if (parent === undefined) return;
    const parentId = String(parent);
    const sessionId = String(session.id);
    this.roots.set(sessionId, this.roots.get(parentId) ?? parentId);
  }
}
