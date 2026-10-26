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
  // Only the current identity/connection may publish a catalog. Native list
  // pulls have their own generation fence; replay must obey it as well.
  let epoch = 0;
  let disposed = false;
  const created = new Map<string, { summary: SessionSummary; until: number }>();
  let listed: readonly string[] = [];
  function replay(value: SessionListValue): SessionListValue {
    const items = [...value.items];
    for (const [id, entry] of created) {
      if (
        items.some((item) => String(item.sessionId) === id) ||
        entry.until <= Date.now()
      ) {
        created.delete(id);
      } else items.push(entry.summary);
    }
    const ids = items.map((item) => String(item.sessionId));
    for (const item of items) facadeSessions.handleSessionAdded(item);
    for (const id of listed) {
      if (!ids.includes(id)) facadeSessions.handleSessionRemoved(SessionId(id));
    }
    listed = ids;
    return { ...value, items };
  }
  const session = {
    ...remote.session,
    list: async (_request: unknown, signal?: AbortSignal) => {
      const identity = token();
      const requestEpoch = epoch;
      if (identity === null || disposed)
        return { ok: true as const, value: { items: [] as SessionSummary[] } };
      const result = await wire.chatList(identity, signal);
      if (
        disposed ||
        signal?.aborted ||
        epoch !== requestEpoch ||
        token() !== identity
      )
        return { ok: true as const, value: { items: [] as SessionSummary[] } };
      if (result.ok) return { ...result, value: replay(result.value) };
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
  sessions.rememberAdmitted = (id) => {
    if (disposed || token() === null) return;
    // QA create or read admission has already accepted this exact id.
    // Seed only its existence; all history, projections and writes still use
    // the authenticated Host transport. A pre-create scan cannot erase it.
    const summary: SessionSummary = {
      sessionId: SessionId(id),
      updatedAt: Date.now(),
      agentAvailable: true,
      formatStatus: "current",
      running: false,
      blank: true,
    };
    created.set(id, { summary, until: Date.now() + 60_000 });
    listed = [...new Set([...listed, id])];
    sessions.handleSessionAdded(summary);
  };
  let control: AbortController | undefined;
  const startControl = () => {
    if (
      control !== undefined ||
      disposed ||
      token() === null ||
      generation.getSnapshot() === undefined
    )
      return;
    const lifetime = new AbortController();
    const controlEpoch = epoch;
    control = lifetime;
    void (async () => {
      try {
        for await (const frame of wire.chatControl(token()!, lifetime.signal)) {
          if (lifetime.signal.aborted || disposed || controlEpoch !== epoch)
            return;
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
    if (identityChanged || connectedGeneration !== currentGeneration)
      epoch += 1;
    if (identityChanged) {
      identity = next;
      created.clear();
      for (const id of listed) sessions.handleSessionRemoved(SessionId(id));
      listed = [];
      control?.abort();
      control = undefined;
      // Invalidate any native in-flight pull even when signing out: refresh
      // alone would join the old identity's single-flight request.
      sessions.handleConnected();
    }
    // Catalog/account notifications are not new connections. Resetting the
    // native baseline on each notification discards a slower in-flight list.
    if (next !== null && currentGeneration !== undefined) {
      if (!identityChanged && connectedGeneration !== currentGeneration)
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
      epoch += 1;
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
