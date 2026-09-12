import { vi, type Mock } from "vitest";
import type { ConversationSnapshot } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {
  SessionFace,
  SessionListState,
} from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-client-connection/client";
import type { QaSessionControllerOptions } from "../../src/client/QaSessionController.js";
import type { StorageLike } from "../../src/client/types.js";

export class Source<T> {
  private readonly listeners = new Set<() => void>();
  constructor(private value: T) {}
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  set(value: T) {
    this.value = value;
    for (const listener of this.listeners) listener();
  }
}

export function conversation(_id: string): ConversationSnapshot {
  // No Chat view is registered in tests, so the transcript projects empty.
  return {
    views: { get: () => undefined },
    activeTargets: new Set(),
  };
}

export function sessionFace(id: string) {
  const source = new Source({
    running: false,
    openState: "open",
    blank: true,
    removed: false,
  });
  const prompt = vi.fn(async () => ({
    ok: true as const,
    value: { accepted: true as const },
  }));
  const cancel = vi.fn(async () => ({
    ok: true as const,
    value: { accepted: true as const },
  }));
  const face = {
    sessionId: id as SessionId,
    projections: { faceOf: vi.fn() },
    getSnapshot: source.getSnapshot,
    subscribe: source.subscribe,
    prompt,
    cancel,
  } as unknown as SessionFace;
  return { face, source, prompt, cancel };
}

export function conversationBinding(id: string) {
  return {
    snapshot: new Source(conversation(id)),
    // Subscribing the Chat target activates it; tests never register one.
    target: vi.fn(() => new Source(undefined)),
  };
}

/** One controller world: the fake injects plus the handles tests assert on. */
export interface QaSessionTestWorld {
  sessions: QaSessionControllerOptions["sessions"];
  api: QaSessionControllerOptions["api"];
  conversation: QaSessionControllerOptions["conversation"];
  connection: QaSessionControllerOptions["connection"];
  storage: StorageLike;
  stored: Map<string, string>;
  faces: Map<string, ReturnType<typeof sessionFace>>;
  bindings: Map<string, ReturnType<typeof conversationBinding>>;
  create: Mock;
  selectAgentPreset: Mock;
  open: Mock;
  list: Source<SessionListState>;
  secureSession: Mock;
}

export function harness(existing: string[] = []): QaSessionTestWorld {
  const faces = new Map(existing.map((id) => [id, sessionFace(id)]));
  const bindings = new Map(existing.map((id) => [id, conversationBinding(id)]));
  const list = new Source<SessionListState>({
    ids: existing as never[],
    byId: Object.fromEntries(
      existing.map((id) => [
        id,
        { id, displayTitle: id, running: false, blank: true, updatedAt: 1 },
      ]),
    ) as SessionListState["byId"],
    current: undefined,
    phase: "ready",
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  });
  const open = vi.fn();
  const sessions = {
    list,
    open,
    binding: (id: never) => {
      const found = bindings.get(String(id));
      return found === undefined
        ? undefined
        : { sessionId: id, session: faces.get(String(id))?.face, ctx: {} };
    },
  } as unknown as QaSessionControllerOptions["sessions"];
  let sequence = existing.length;
  const create = vi.fn(async () => {
    const id = `created-${++sequence}`;
    faces.set(id, sessionFace(id));
    bindings.set(id, conversationBinding(id));
    const before = list.getSnapshot();
    list.set({
      ...before,
      ids: [id, ...before.ids],
      byId: {
        ...before.byId,
        [id]: {
          id,
          displayTitle: id,
          running: false,
          blank: true,
          updatedAt: 2,
        },
      } as SessionListState["byId"],
    } as SessionListState);
    return id as never;
  });
  Object.assign(sessions, { create });
  const selectModel = vi.fn(async () => ({
    ok: true as const,
    value: { selected: {} },
  }));
  const selectAgentPreset = vi.fn(async () => ({
    ok: true as const,
    value: "qa-assistant",
  }));
  const api = {
    selectModel,
    selectAgentPreset,
  } as unknown as QaSessionControllerOptions["api"];
  const conversation = {
    binding: (id: never) => bindings.get(String(id)),
  } as unknown as QaSessionControllerOptions["conversation"];
  const connection = new Source(
    {},
  ) as unknown as QaSessionControllerOptions["connection"];
  const stored = new Map<string, string>();
  const storage: StorageLike = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
    removeItem: (key) => stored.delete(key),
  };
  const secureSession = vi.fn<QaSessionControllerOptions["secureSession"]>(
    async (token: string, sessionId: string) => ({
      ok: true as const,
      value: {
        sessionId,
        enabled: true,
        agentPresetMatches: true,
        workspaceMatches: true,
        modelMatches: true,
        sandboxIsReadOnly: true,
        approvalIsNever: true,
        permissionPreset: "qa-read-only",
        toolPolicyLoaded: true,
        toolAllowList: [],
      },
    }),
  );
  return {
    sessions,
    api,
    conversation,
    connection,
    storage,
    stored,
    faces,
    bindings,
    create,
    selectAgentPreset,
    open,
    list,
    secureSession,
  };
}
