import { vi, type Mock } from "vitest";
import type {
  ConversationNode,
  ConversationSnapshot,
} from "@deepseek-ai/dsh-client-ui-conversation/client";
import { legacy, snapshot as chatView } from "./conversation-fakes.js";
import type {
  SessionFace,
  SessionListState,
} from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-client-connection/client";
import type { QaSessionControllerOptions } from "../../src/client/QaSessionController.js";
import type { QaFileDraft } from "../../src/types.js";
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
    views: { get: () => undefined, grouped: () => undefined },
    activeTargets: new Set(),
  };
}

/**
 * The session snapshot a test drives. The queue rows are not part of it at
 * `rc.2`: pending input rides the session's Inbox projection, which a test sets
 * through {@link sessionFace}'s `inbox` source.
 */
export interface FakeSessionSnapshot {
  running: boolean;
  openState: string;
  blank: boolean;
  removed: boolean;
  pendingSubmissions: readonly Record<string, unknown>[];
}

/** One queued message of the Inbox projection, as the Host publishes it. */
export function queuedMessage(
  id: string,
  content: readonly Record<string, unknown>[],
  rpcId?: string,
): Record<string, unknown> {
  return {
    id,
    role: "user",
    content,
    source: { kind: "user", ...(rpcId === undefined ? {} : { rpcId }) },
  };
}

export function sessionFace(id: string) {
  const source = new Source<FakeSessionSnapshot>({
    running: false,
    openState: "open",
    blank: true,
    removed: false,
    pendingSubmissions: [],
  });
  // The Host's Inbox projection: the messages waiting for the next turn.
  const inbox = new Source<Record<string, unknown> | undefined>({
    "next-turn": [],
  });
  const prompt = vi.fn(async () => ({
    ok: true as const,
    value: { accepted: true as const },
  }));
  const cancel = vi.fn(async () => ({
    ok: true as const,
    value: { accepted: true as const },
  }));
  const updateQueue: Mock<(...args: unknown[]) => Promise<unknown>> = vi.fn(
    async () => ({
      ok: true as const,
      value: { accepted: true as const },
    }),
  );
  let submissions = 0;
  const beginSubmission: Mock<
    (input: Record<string, unknown>) => {
      requestId: string;
      abandon: () => void;
    }
  > = vi.fn(() => ({
    requestId: `request-${++submissions}`,
    abandon: vi.fn(),
  }));
  const face = {
    sessionId: id as SessionId,
    projections: {
      faceOf: (key: string) =>
        key === "inbox" ? inbox : new Source(undefined),
    },
    getSnapshot: source.getSnapshot,
    subscribe: source.subscribe,
    prompt,
    cancel,
    updateQueue,
    beginSubmission,
  } as unknown as SessionFace;
  return { face, source, inbox, prompt, cancel, updateQueue, beginSubmission };
}

export function conversationBinding(id: string) {
  return {
    snapshot: new Source(conversation(id)),
    // Subscribing the Chat target activates it; tests never register one.
    target: vi.fn(() => new Source(undefined)),
  };
}

/**
 * Replace the Chat slice the bound surface projects and notify it, the way the
 * Host publishes one assembled transcript frame.
 */
export function publishChatSlice(
  binding: ReturnType<typeof conversationBinding> | undefined,
  slice: ReturnType<typeof legacy>,
): void {
  if (binding === undefined) return;
  binding.snapshot.set(chatView(slice));
  binding.target.mock.results[0]?.value.set(undefined);
}

/**
 * Land one durable user row in the Chat slice: the hand the Host makes when
 * the prompt it admitted reaches the transcript, which is what replaces the
 * browser's optimistic copy of the question.
 */
export function landDurableUserRow(
  binding: ReturnType<typeof conversationBinding> | undefined,
  text: string,
): void {
  publishChatSlice(
    binding,
    legacy({
      nodes: [
        {
          kind: "user",
          seq: 1,
          time: 10,
          source: {},
          content: [{ type: "text", text }],
        },
      ] as ConversationNode[],
    }),
  );
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
  createSession: Mock;
  selectAgentPreset: Mock;
  retain: Mock;
  list: Source<SessionListState>;
  secureSession: Mock;
}

/**
 * An upload service whose answer the test releases when it wants to.
 *
 * Staging an attachment is the one external round-trip a send makes *after* its
 * target was chosen, so the moment its answer arrives is what a chat switch has
 * to be proved against.
 */
export function deferredUpload() {
  const outcome = {
    ok: true as const,
    value: {
      receiptId: "receipt-late",
      file: { attachmentId: "sha256:late", name: "note.txt", bytes: 5 },
    },
  };
  let release: (value: typeof outcome) => void = () => {};
  const pending = new Promise<typeof outcome>((resolve) => {
    release = resolve;
  });
  return {
    service: { upload: vi.fn(() => pending) },
    settle: () => release(outcome),
  };
}

/** One attached file, as the composer hands it to `send`. */
export function fileDraft(name = "note.txt"): QaFileDraft {
  return {
    kind: "file",
    id: `draft-${name}`,
    name,
    bytes: 5,
    blob: new Blob(["hello"]),
  };
}

export function harness(
  existing: string[] = [],
  options: { readonly subagents?: readonly string[] } = {},
): QaSessionTestWorld {
  const subagents = new Set(options.subagents ?? []);
  const listed = [...existing, ...subagents];
  const summaryOf = (id: string) =>
    subagents.has(id)
      ? {
          id,
          displayTitle: id,
          running: false,
          blank: false,
          updatedAt: 1,
          parentId: "session-root",
          origin: "subagent",
        }
      : { id, displayTitle: id, running: false, blank: true, updatedAt: 1 };
  const faces = new Map(listed.map((id) => [id, sessionFace(id)]));
  const bindings = new Map(listed.map((id) => [id, conversationBinding(id)]));
  const list = new Source<SessionListState>({
    ids: listed as never[],
    byId: Object.fromEntries(
      listed.map((id) => [id, summaryOf(id)]),
    ) as SessionListState["byId"],
    phase: "ready",
    projectionsBySession: {},
  });
  // `rc.2` has no Host navigation: binding a chat means retaining it, and the
  // reference is what a test proves the controller holds and releases.
  const retain = vi.fn(() => ({
    ready: Promise.resolve({}),
    release: vi.fn(),
  }));
  const sessions = {
    list,
    retain,
    binding: (id: never) => {
      const found = bindings.get(String(id));
      return found === undefined
        ? undefined
        : { sessionId: id, session: faces.get(String(id))?.face, ctx: {} };
    },
  } as unknown as QaSessionControllerOptions["sessions"];
  let sequence = listed.length;
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
        [id]: { ...summaryOf(id), updatedAt: 2 },
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
        sandboxModeMatches: true,
        approvalIsNever: true,
        permissionPreset: "qa-read-only",
        toolPolicyLoaded: true,
        toolAllowList: [],
      },
    }),
  );
  const createSession = vi.fn<QaSessionControllerOptions["createSession"]>(
    async () => ({ ok: true, value: String(await create()) }),
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
    createSession,
    selectAgentPreset,
    retain,
    list,
    secureSession,
  };
}
