import type { Context } from "@deepseek-ai/cordis";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import type { QaSessions } from "./types.js";
import type { QaChatWire, QaSessionRemotes } from "./chat-sharing-api.js";
import type {
  SessionControlFrame,
  SessionListValue,
  SessionSummary,
} from "@deepseek-ai/dsh-api-session-controller/types";
import type { ConnectionGenerationState } from "@deepseek-ai/dsh-client-connection/client";

interface NativeSessions extends QaSessions {
  handleControlFrame(frame: SessionControlFrame): void;
  handleSessionAdded(summary: SessionSummary): void;
  handleSessionRemoved(sessionId: SessionId): void;
  handleConnected(): void;
}
/** Use the installed native Session class and projections with a tokenized transport. */
export function createQaAccountSessions(
  ctx: Context,
  root: QaSessions,
  remote: QaSessionRemotes,
  wire: QaChatWire,
  token: () => string | null,
  generation: ConnectionGenerationState,
  subscribeAccount: (listener: () => void) => () => void,
): QaSessions {
  const refuse = async (): Promise<never> => {
    throw new Error("Use the authenticated QA operation.");
  };
  // The secured transport owns the only Session-list feed this facade gets:
  // the Host's forwarded api-session events are wired for the ambient
  // instance alone, so a listing answer that the manager discards — a
  // generation reset between the pull and its application is the shape this
  // had on the stand — leaves the catalog blind to the chat the account just
  // created, and the adoption refuses it with `sessions.retain: unknown
  // session`. Replay every listing through the manager's own addition and
  // removal paths, so a listed row lands whatever else happens to the pull
  // that carried it. The replay is declared after the facade and referenced
  // through the hoisted function below: the listing closure runs only once a
  // caller pulls, which is always after the facade exists.
  let listed: readonly string[] = [];
  function replay({ items }: SessionListValue): void {
    const ids = items.map((item) => String(item.sessionId));
    for (const item of items) facadeSessions.handleSessionAdded(item);
    for (const id of listed) {
      if (!ids.includes(id)) facadeSessions.handleSessionRemoved(SessionId(id));
    }
    listed = ids;
  }
  const session = {
    ...remote.session,
    list: async (_request: unknown, signal?: AbortSignal) => {
      if (token() === null)
        return { ok: true as const, value: { items: [] as SessionSummary[] } };
      const result = await wire.chatList(token()!, signal);
      if (result.ok) replay(result.value);
      return result;
    },
    page: (request, signal) => wire.chatPage(token() ?? "", request, signal),
    follow: (request, signal) =>
      wire.chatFollow(token() ?? "", request, signal),
    control: (signal) => wire.chatControl(token() ?? "", signal),
    projections: (request, signal) =>
      wire.chatProjections(token() ?? "", String(request.sessionId), signal),
    prompt: (request, signal) =>
      wire.chatPrompt(token() ?? "", request, signal),
    attachment: (request) => wire.chatAttachment(token() ?? "", request),
    rename: (request) => wire.chatRename(token() ?? "", request),
    cancel: (request) =>
      wire.chatCancel(token() ?? "", String(request.sessionId)),
    updateQueue: (request) => wire.chatUpdateQueue(token() ?? "", request),
    search: (request, signal) =>
      wire.chatSearch(token() ?? "", request, signal),
    selectModel: (request) => wire.chatSelectModel(token() ?? "", request),
    create: refuse,
    fork: refuse,
  } satisfies QaSessionRemotes["session"];
  const secured: QaSessionRemotes = {
    $stream: remote.$stream.bind(remote),
    session,
    commands: { execute: refuse },
    subagents: { prompt: refuse, interruptByParent: refuse },
  };
  // rc.2 exposes the constructor on the public Session service instance. Keep
  // this compatibility seam isolated and prove it with the real installed SDK.
  const Constructor = root.constructor as new (
    context: Context,
    remotes: QaSessionRemotes,
  ) => NativeSessions;
  const sessions = new Constructor(ctx.isolate("sessions"), secured);
  const facadeSessions: NativeSessions = sessions;
  let control: AbortController | undefined;
  let disposed = false;
  const startControl = () => {
    if (
      control !== undefined ||
      disposed ||
      token() === null ||
      generation.getSnapshot() === undefined
    )
      return;
    const lifetime = new AbortController();
    control = lifetime;
    void (async () => {
      try {
        for await (const frame of wire.chatControl(token()!, lifetime.signal)) {
          if (lifetime.signal.aborted || disposed) return;
          sessions.handleControlFrame(frame);
        }
      } catch {
        /* Retry with the current identity on the next bounded refresh. */
      } finally {
        if (control === lifetime) control = undefined;
      }
    })();
  };
  let identity: string | null = null;
  let connectedGeneration: ReturnType<ConnectionGenerationState["getSnapshot"]>;
  const reconcile = () => {
    const next = token();
    const currentGeneration = generation.getSnapshot();
    const identityChanged = identity !== next;
    if (identityChanged) {
      identity = next;
      control?.abort();
      control = undefined;
      if (next === null || currentGeneration === undefined)
        void sessions.refresh();
    }
    // Catalog/account notifications are not new connections. Resetting the
    // native baseline on each notification discards a slower in-flight list.
    if (next !== null && currentGeneration !== undefined) {
      if (identityChanged || connectedGeneration !== currentGeneration)
        sessions.handleConnected();
      startControl();
    }
    connectedGeneration = currentGeneration;
  };
  const unsubscribe = subscribeAccount(reconcile);
  const unsubscribeGeneration = generation.subscribe(() => {
    control?.abort();
    control = undefined;
    reconcile();
  });
  const refresh = setInterval(() => {
    if (token() !== null) {
      void sessions.refresh();
      startControl();
    }
  }, 1000);
  ctx.effect(
    () => () => {
      disposed = true;
      clearInterval(refresh);
      unsubscribe();
      unsubscribeGeneration();
      control?.abort();
    },
    "qa.account-session-transport",
  );
  reconcile();
  return sessions;
}
