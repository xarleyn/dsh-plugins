import type { Context } from "@deepseek-ai/cordis";

/**
 * Which sessions belong to this deployment.
 *
 * The admission boundary attests chat roots. A delegated child never appears
 * there — its scope chain does not reach the chat's own agent context — so it
 * inherits its chat from the session that created it. Both interactive seams
 * (tool approvals and user questions) read ownership from here, which is what
 * keeps one chat answered by exactly one surface.
 */
export class QaSessionOwnership {
  /** Child session → the attested chat that owns it. */
  private readonly inherited = new Map<string, string>();
  private disposeListener: (() => void) | undefined;
  private installed = false;

  constructor(private readonly isAttested: (sessionId: string) => boolean) {}

  /** Listen for the children of an attested chat; safe to call from each seam. */
  install(ctx: Context): void {
    if (this.installed) return;
    this.installed = true;
    this.disposeListener = ctx.on("session/created", (session) => {
      const parent = session.header.parentSession;
      if (parent === undefined) return;
      const root = this.rootOf(String(parent));
      if (root !== undefined) this.inherited.set(String(session.id), root);
    });
  }

  /** The attested chat behind a session: itself, or the root it inherited. */
  rootOf(sessionId: string): string | undefined {
    const inherited = this.inherited.get(sessionId);
    if (inherited !== undefined) return inherited;
    return this.isAttested(sessionId) ? sessionId : undefined;
  }

  /**
   * Drop one session's inheritance. Called when its agent is gone; the chat's
   * own claim needs no bookkeeping here, because it resolves through the
   * admission's attested set, which owns that lifetime.
   */
  forget(sessionId: string): void {
    this.inherited.delete(sessionId);
  }

  dispose(): void {
    this.inherited.clear();
    this.disposeListener?.();
    this.disposeListener = undefined;
    this.installed = false;
  }
}
