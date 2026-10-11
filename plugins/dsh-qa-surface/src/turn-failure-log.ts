import type { Context } from "@deepseek-ai/cordis";
import type { Session } from "@deepseek-ai/dsh-session";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";

/** The turn-end failure facts the record is built from. */
interface TurnFailure {
  readonly code: string;
  readonly message: string;
}

/**
 * The two sentences the Host writes when the adapter registry has nothing for
 * the route it was asked for: `llm.registration(provider)` throws the first
 * before any adapter runs, and the pi-ai adapter throws the second when its
 * snapshot carries no profile for that provider. Either way the turn died
 * before a request left, so the session's folded header — the header the NEXT
 * request will be compared against, i.e. conversation state rather than the
 * identity of this call — names some earlier route or nothing, while the
 * sentence names the provider this very turn asked for. Each alternative is
 * matched whole and the name is one quoted run with no quote inside it, so a
 * message only shaped like a refusal — free text that can carry a credential and
 * go on quoting paths — contributes nothing to the record.
 */
const REGISTRY_REFUSAL =
  /^(?:no adapter registered for provider|pi-ai adapter does not own provider) "([^"]+)"$/;

function routedProvider(
  session: Session,
  failure: TurnFailure,
): string | undefined {
  if (failure.code === "NO_ADAPTER") {
    const named = REGISTRY_REFUSAL.exec(failure.message)?.[1];
    if (named !== undefined) return named;
  }
  const header = session.requestHeader()?.config.provider;
  return typeof header === "string" && header.length > 0 ? header : undefined;
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
 * hand. This listener puts the facts an operator needs — the chat, the session
 * that died inside it, the turn, the code, and the provider the Host was asked
 * to route to — into the plugin's own daily log, which is mirrored to the
 * container's stdout from `warn` up.
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
      const failingId = String(session.id);
      // A delegated expert is recorded as the failure of the chat that owns it,
      // because an operator reads the log against the chats of /qa and the
      // expert's own id names none of them; a session this deployment does not
      // claim stays out of the log.
      const chat = resolveChat(failingId);
      if (chat === undefined) return;
      const failure = event.data.reason.error;
      const provider = routedProvider(session, failure);
      logger.error("session.turn-failed", {
        sessionId: chat,
        // The chat is what the operator matches against /qa; the session that
        // actually died says which of its turns to open in the journal. Without
        // it, two experts of one chat failing on their turn 3 write the same
        // line twice.
        ...(chat === failingId ? {} : { failedSessionId: failingId }),
        turn: event.data.turn,
        code: failure.code,
        ...(provider === undefined ? {} : { provider }),
      });
    },
    { global: true },
  );
}
