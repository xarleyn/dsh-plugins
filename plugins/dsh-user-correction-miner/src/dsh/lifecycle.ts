import type { Context } from "@deepseek-ai/cordis";
import type { Session, SessionEvent } from "@deepseek-ai/dsh-session";
import type { CorrectionMinerEngine } from "../mining/engine.js";

/** Register only O(1) observation on the synchronous session event hot path. */
export function registerLifecycle(ctx: Context, engine: CorrectionMinerEngine): void {
  ctx.on("session/event", (session: Session, event: SessionEvent) => {
    engine.observeEvent(session, event);
  });
  ctx.on("session/disposed", (session: Session) => {
    engine.observeDisposed(session);
  });
}
