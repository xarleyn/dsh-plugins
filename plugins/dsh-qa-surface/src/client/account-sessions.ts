import type { Context } from "@deepseek-ai/cordis";
import type { QaSessions } from "./types.js";
import type { QaChatWire, QaSessionRemotes } from "./chat-sharing-api.js";
import type { SessionControlFrame } from "@deepseek-ai/dsh-api-session-controller/types";
import type { ConnectionGenerationState } from "@deepseek-ai/dsh-client-connection/client";

interface NativeSessions extends QaSessions {
  handleControlFrame(frame: SessionControlFrame): void;
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
  const session = {
    ...remote.session,
    list: (_request, signal) =>
      token() === null
        ? Promise.resolve({ ok: true as const, value: { items: [] } })
        : wire.chatList(token()!, signal),
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
