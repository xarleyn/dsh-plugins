import type { Context } from "@deepseek-ai/cordis";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";

/**
 * Write a failed turn where the operator of the stand reads it.
 *
 * The chat row of a failed turn carries the failure code and nothing else: the
 * provider's own message is deliberately kept out of the browser, and the
 * session journal that holds it is a zstd archive nobody reads over an
 * operator's shoulder. So a stand whose provider adapters never registered —
 * every turn ending `NO_ADAPTER` — shows its tester «Помощнику не удалось
 * завершить ответ.» and stays undiagnosable until someone decodes frames by
 * hand. This listener puts the two facts an operator needs, the code and the
 * provider the request was routed to, into the plugin's own daily log, which is
 * mirrored to the container's stdout from `warn` up.
 *
 * The provider is read from the session's folded request header rather than
 * from the failure message: a provider message is free text that can echo a
 * credential, while the header field is the structured name the Harness routed
 * by. Nothing of the message is recorded.
 */
export function registerTurnFailureLog(
  ctx: Context,
  logger: PluginLogger,
  isQaSession: (sessionId: string) => boolean,
): () => void {
  return ctx.on(
    "session/event",
    (session, event) => {
      if (event.type !== "turn/end") return;
      if (event.data.reason.kind !== "error") return;
      // The reader resolves a delegated expert to the chat that owns it, so a
      // turn that died inside a subagent is recorded as that chat's failure, and
      // a session this deployment does not claim stays out of the log.
      if (!isQaSession(String(session.id))) return;
      const provider = session.requestHeader()?.config.provider;
      logger.error("session.turn-failed", {
        sessionId: String(session.id),
        turn: event.data.turn,
        code: event.data.reason.error.code,
        ...(provider === undefined ? {} : { provider }),
      });
    },
    { global: true },
  );
}
