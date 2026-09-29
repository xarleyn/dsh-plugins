import type { Context } from "@deepseek-ai/cordis";
import type { Session } from "@deepseek-ai/dsh-session";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";

/** The turn-end failure facts the record is built from. */
interface TurnFailure {
  readonly code: string;
  readonly message: string;
}

/**
 * The provider the Host interpolates into its own registry refusal:
 * `llm.registration(provider)` throws this sentence before any adapter runs, so
 * on a stand whose adapters never registered, the folded request header — the
 * route of the last request that actually left — is still empty while the
 * failure names the provider the chat had asked for. The match is anchored to
 * the whole sentence, so only the quoted name is ever taken; a provider message
 * is free text that can carry a credential, and none of it is recorded.
 */
const REGISTRY_REFUSAL = /^no adapter registered for provider "(.+)"$/;

function routedProvider(
  session: Session,
  failure: TurnFailure,
): string | undefined {
  const header = session.requestHeader()?.config.provider;
  if (typeof header === "string" && header.length > 0) return header;
  if (failure.code !== "NO_ADAPTER") return undefined;
  return REGISTRY_REFUSAL.exec(failure.message)?.[1];
}

/**
 * Write a failed turn where the operator of the stand reads it.
 *
 * The chat row of a failed turn carries the failure code and nothing else: the
 * provider's own message is deliberately kept out of the browser, and the
 * session journal that holds it is a zstd archive nobody reads over an
 * operator's shoulder. So a stand whose provider adapters never registered —
 * every turn ending `NO_ADAPTER` — shows its tester «Помощнику не удалось
 * завершить ответ.» and stays undiagnosable until someone decodes frames by
 * hand. This listener puts the facts an operator needs — the chat, the turn, the
 * code and, when the Host knew it, the provider the request was routed to — into
 * the plugin's own daily log, which is mirrored to the container's stdout from
 * `warn` up.
 */
export function registerTurnFailureLog(
  ctx: Context,
  logger: PluginLogger,
  resolveChat: (sessionId: string) => string | undefined,
): () => void {
  return ctx.on(
    "session/event",
    (session, event) => {
      if (event.type !== "turn/end") return;
      if (event.data.reason.kind !== "error") return;
      // A delegated expert is recorded as the failure of the chat that owns it,
      // because an operator reads the log against the chats of /qa and the
      // expert's own id names none of them; a session this deployment does not
      // claim stays out of the log.
      const chat = resolveChat(String(session.id));
      if (chat === undefined) return;
      const failure = event.data.reason.error;
      const provider = routedProvider(session, failure);
      logger.error("session.turn-failed", {
        sessionId: chat,
        turn: event.data.turn,
        code: failure.code,
        ...(provider === undefined ? {} : { provider }),
      });
    },
    { global: true },
  );
}
