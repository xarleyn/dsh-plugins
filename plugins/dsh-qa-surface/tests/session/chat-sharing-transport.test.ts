import { afterEach, describe, expect, it, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import type {
  SessionPromptRequest,
  SessionPageRequest,
  SessionFollowFrame,
  SessionProjectionsValue,
} from "@deepseek-ai/dsh-api-session-controller/types";
import { QaChatTransport } from "../../src/chat-sharing/transport.js";
import { sharingFixture } from "./chat-sharing.helpers.js";
const close: (() => void)[] = [];
afterEach(() => {
  for (const dispose of close.splice(0)) dispose();
  vi.useRealTimers();
});
function fixture() {
  const f = sharingFixture();
  close.push(() => f.store.storage.close());
  const native = {
    prompt: vi.fn(async () => ({ accepted: true })),
    rename: vi.fn(),
    cancel: vi.fn(),
    updateQueue: vi.fn(),
    selectModel: vi.fn(),
    attachment: vi.fn(async () => ({ data: "demo" })),
    search: vi.fn(async () => ({
      items: [
        { sessionId: "chat-a", snippet: "Shared content" },
        { sessionId: "private-chat", snippet: "Private content" },
      ],
      hasMore: true,
    })),
    list: vi.fn(async () => ({
      items: [{ sessionId: "chat-a" }, { sessionId: "private-chat" }],
    })),
    page: vi.fn(async () => ({
      records: [
        {
          type: "event",
          event: {
            type: "user/message",
            seq: 1,
            time: 1,
            data: {
              source: { kind: "user", rpcId: "demo-request" },
              content: [{ type: "text", text: "Shared question" }],
            },
          },
        },
      ],
    })),
    follow: vi.fn(),
    // 0.2.1 projections carry their sequence space on the value itself.
    projections: vi.fn(async (): Promise<SessionProjectionsValue> => ({
      kind: "sequenced",
      asOfSeq: 1,
      values: {},
    })),
  };
  const admit = vi.fn(async () => undefined);
  const agents = delegated();
  const transport = new QaChatTransport(
    {
      sessionController: native,
      agents: {
        list: () => agents,
        get: (id: string) =>
          agents.find((agent) => agent.session.header.id === id),
      },
    } as unknown as Context,
    () => f.store,
    admit,
  );
  return { ...f, native, admit, agents, transport };
}
/** A chat with a running reviewer, an idle reviewer, a grandchild and a neighbour. */
function delegated() {
  const rows = [
    { id: "review-running", parent: "chat-a", status: "running" },
    { id: "review-idle", parent: "chat-a", status: "idle" },
    { id: "grandchild", parent: "review-idle", status: "running" },
    { id: "other-chat-child", parent: "chat-b", status: "running" },
    { id: "plain-session", parent: undefined, status: "running" },
  ];
  return rows.map((row) => ({
    session: {
      header: {
        id: row.id,
        origin: row.parent === undefined ? undefined : "subagent",
        parentSession: row.parent,
      },
    },
    status: row.status,
    cancel: vi.fn(),
  }));
}
const request = (id: string): SessionPromptRequest =>
  ({
    sessionId: "chat-a",
    requestId: id,
    mode: "queue",
    content: [{ type: "text", text: "Synthetic question" }],
  }) as unknown as SessionPromptRequest;
const signal = () => new AbortController().signal;
describe("authenticated QA chat transport", () => {
  it("rechecks current grants as one synchronous batch immediately before a control frame", async () => {
    const f = fixture();
    f.native.list.mockResolvedValue({
      items: [{ sessionId: "chat-a", agentAvailable: true }],
    } as never);
    const visible = f.store.visible.bind(f.store);
    let reads = 0;
    vi.spyOn(f.store, "visible").mockImplementation((token) => {
      if (++reads === 3)
        f.store.set(f.owner.token, "chat-a", f.reader.user.email, null);
      return visible(token);
    });
    const abort = new AbortController();
    const iterable = f.transport.control(f.reader.token, abort.signal);
    const stream = iterable[Symbol.asyncIterator]();
    expect((await stream.next()).value).toEqual({
      type: "baseline",
      value: { projections: {} },
    });
    expect(f.native.projections).toHaveBeenCalledOnce();
    abort.abort();
    await stream.return?.();
  });

  it("polls cold cache hints without replaying histories and still reads live projections", async () => {
    const f = fixture();
    f.native.list.mockResolvedValue({
      items: [
        {
          sessionId: "chat-a",
          agentAvailable: false,
          projections: { kind: "cached", asOfSeq: 2, values: {} },
        },
      ],
    } as never);
    const controller = new AbortController();
    const coldIterable = f.transport.control(f.reader.token, controller.signal);
    const stream = coldIterable[Symbol.asyncIterator]();
    expect((await stream.next()).value).toEqual({
      type: "baseline",
      value: { projections: { "chat-a": { asOfSeq: 2, values: {} } } },
    });
    expect(f.native.projections).not.toHaveBeenCalled();
    controller.abort();
    await stream.return?.();
    f.native.list.mockResolvedValue({
      items: [{ sessionId: "chat-a", agentAvailable: true }],
    } as never);
    const liveController = new AbortController();
    const liveIterable = f.transport.control(
      f.reader.token,
      liveController.signal,
    );
    const live = liveIterable[Symbol.asyncIterator]();
    await live.next();
    expect(f.native.projections).toHaveBeenCalledOnce();
    liveController.abort();
    await live.return?.();
  });
  it("omits a migration-required row from the control baseline", async () => {
    // 0.2.1 splits SessionProjectionsValue by kind: a migration-required row
    // carries no event cut, so it cannot seed an asOfSeq-keyed baseline.
    const f = fixture();
    f.native.projections.mockResolvedValue({
      kind: "migration-required",
      values: {},
    });
    f.native.list.mockResolvedValue({
      items: [{ sessionId: "chat-a", agentAvailable: true }],
    } as never);
    const controller = new AbortController();
    const iterable = f.transport.control(f.reader.token, controller.signal);
    const stream = iterable[Symbol.asyncIterator]();
    expect((await stream.next()).value).toEqual({
      type: "baseline",
      value: { projections: {} },
    });
    expect(f.native.projections).toHaveBeenCalledOnce();
    controller.abort();
    await stream.return?.();
  });
  it("uses an account-scoped catalog and rechecks a grant revoked during the read", async () => {
    const f = fixture();
    const listForSessions = vi.fn(async () => {
      f.store.set(f.owner.token, "chat-a", f.reader.user.email, null);
      return {
        items: [{ sessionId: "chat-a" }, { sessionId: "private-chat" }],
      };
    });
    Object.assign(f.native, { listForSessions });
    expect((await f.transport.list(f.reader.token, signal())).items).toEqual(
      [],
    );
    expect(listForSessions).toHaveBeenCalledWith(["chat-a"], expect.anything());
    expect(f.native.list).not.toHaveBeenCalled();
  });
  it("refuses reader writes and outsider history/images before native work", async () => {
    const f = fixture();
    await expect(
      f.transport.prompt(f.reader.token, request("read-request"), signal()),
    ).rejects.toThrow("read-only");
    await expect(
      f.transport.page(
        f.outsider.token,
        {
          address: { kind: "session", sessionId: "chat-a" },
        } as SessionPageRequest,
        signal(),
      ),
    ).rejects.toThrow();
    await expect(
      f.transport.attachment(f.outsider.token, {
        sessionId: "chat-a",
      } as never),
    ).rejects.toThrow();
    expect(f.native.prompt).not.toHaveBeenCalled();
    expect(f.native.page).not.toHaveBeenCalled();
    expect(f.native.attachment).not.toHaveBeenCalled();
    expect(
      (await f.transport.list(f.reader.token, signal())).items,
    ).toHaveLength(1);
  });
  it("serializes competing senders, signs authors and rejects cross-author replay", async () => {
    const f = fixture();
    let release: () => void = () => undefined;
    f.admit.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(undefined);
        }),
    );
    const one = f.transport.prompt(
      f.owner.token,
      request("owner-request"),
      signal(),
    );
    const two = f.transport.prompt(
      f.collaborator.token,
      request("demo-request"),
      signal(),
    );
    await vi.waitFor(() => expect(f.admit).toHaveBeenCalledTimes(1));
    release();
    await Promise.all([one, two]);
    expect(
      f.native.prompt.mock.calls.map(
        (call) => (call as unknown as [SessionPromptRequest])[0].requestId,
      ),
    ).toEqual(["owner-request", "demo-request"]);
    await expect(
      f.transport.prompt(f.owner.token, request("demo-request"), signal()),
    ).rejects.toThrow("another participant");
    const page = await f.transport.page(
      f.reader.token,
      {
        address: { kind: "session", sessionId: "chat-a" },
      } as SessionPageRequest,
      signal(),
    );
    expect(
      (page.records[0]?.event.data as { source: { qaAuthor: string } }).source
        .qaAuthor,
    ).toBe(f.collaborator.user.displayName);
  });
  it("rechecks revocation after async resume and before queue insertion", async () => {
    const f = fixture();
    f.admit.mockImplementation(async () => {
      f.store.set(f.owner.token, "chat-a", f.collaborator.user.email, null);
    });
    await expect(
      f.transport.prompt(
        f.collaborator.token,
        request("revoked-request"),
        signal(),
      ),
    ).rejects.toThrow();
    expect(f.native.prompt).not.toHaveBeenCalled();
    expect(f.store.authors(f.owner.token, "chat-a")).toEqual([]);
  });
  it("keeps rename/cancel/queue administration owner-only", async () => {
    const f = fixture();
    for (const token of [
      f.reader.token,
      f.collaborator.token,
      f.outsider.token,
    ]) {
      await expect(
        f.transport.rename(token, {
          sessionId: "chat-a",
          title: "Updated",
        } as never),
      ).rejects.toThrow();
      await expect(f.transport.cancel(token, "chat-a")).rejects.toThrow();
      await expect(
        f.transport.updateQueue(token, { sessionId: "chat-a" } as never),
      ).rejects.toThrow();
      await expect(
        f.transport.selectModel(token, { sessionId: "chat-a" } as never),
      ).rejects.toThrow();
    }
    expect(f.native.rename).not.toHaveBeenCalled();
    expect(f.native.cancel).not.toHaveBeenCalled();
  });
  it("stops the chat's delegated work with the chat", async () => {
    // Cancelling the parent aborts one turn. A reviewer or a delegated run is
    // its own resident agent, so a Stop press that only reached the parent
    // left the reader watching work that would not stop.
    const f = fixture();
    await f.transport.cancel(f.owner.token, "chat-a");
    const [reviewRunning, reviewIdle, grandchild, neighbour, plain] = f.agents;
    expect(reviewRunning?.cancel).toHaveBeenCalledWith(
      { kind: "user" },
      { keepInbox: true },
    );
    expect(grandchild?.cancel).toHaveBeenCalled();
    expect(reviewIdle?.cancel).not.toHaveBeenCalled();
    expect(neighbour?.cancel).not.toHaveBeenCalled();
    expect(plain?.cancel).not.toHaveBeenCalled();
  });
  it("leaves delegated work alone when the parent refused the stop", async () => {
    const f = fixture();
    f.native.cancel.mockRejectedValue(new Error("session/agent-busy"));
    await expect(f.transport.cancel(f.owner.token, "chat-a")).rejects.toThrow();
    for (const agent of f.agents) expect(agent.cancel).not.toHaveBeenCalled();
  });
  it("filters search snippets and rechecks recipient access after search", async () => {
    const f = fixture();
    expect(
      await f.transport.search(f.reader.token, { query: "content" }, signal()),
    ).toEqual({
      items: [{ sessionId: "chat-a", snippet: "Shared content" }],
      hasMore: false,
    });
    f.native.search.mockImplementationOnce(async () => {
      f.store.set(f.owner.token, "chat-a", f.reader.user.email, null);
      return {
        items: [{ sessionId: "chat-a", snippet: "Revoked content" }],
        hasMore: false,
      };
    });
    expect(
      (await f.transport.search(f.reader.token, { query: "content" }, signal()))
        .items,
    ).toEqual([]);
  });
  it("shows delegated descendants only to the root owner, including their images", async () => {
    const f = fixture();
    f.native.list.mockResolvedValue({
      items: [
        { sessionId: "chat-a" },
        { sessionId: "child", parentSessionId: "chat-a", origin: "subagent" },
      ],
    } as never);
    expect(
      (await f.transport.list(f.owner.token, signal())).items,
    ).toHaveLength(2);
    expect(
      (await f.transport.list(f.reader.token, signal())).items,
    ).toHaveLength(1);
    await expect(
      f.transport.attachment(f.owner.token, { sessionId: "child" } as never),
    ).resolves.toEqual({ data: "demo" });
    await expect(
      f.transport.attachment(f.reader.token, { sessionId: "child" } as never),
    ).rejects.toThrow();
  });
  it("terminates an already opened idle subscription after revocation", async () => {
    const f = fixture();
    vi.useFakeTimers();
    let wasAborted = false;
    f.native.follow.mockImplementation((_request, lifetime: AbortSignal) =>
      (async function* () {
        yield {
          type: "event",
          event: { type: "turn/start", seq: 1, time: 1, data: { turn: 1 } },
        } as SessionFollowFrame;
        await new Promise<void>((resolve) =>
          lifetime.addEventListener(
            "abort",
            () => {
              wasAborted = true;
              resolve();
            },
            { once: true },
          ),
        );
        lifetime.throwIfAborted();
      })(),
    );
    const frames = f.transport.follow(
      f.reader.token,
      { address: { kind: "session", sessionId: "chat-a" } } as never,
      signal(),
    );
    const iterator = frames[Symbol.asyncIterator]();
    expect((await iterator.next()).done).toBe(false);
    const result = iterator.next();
    const rejection = expect(result).rejects.toThrow();
    f.store.set(f.owner.token, "chat-a", f.reader.user.email, null);
    await vi.advanceTimersByTimeAsync(300);
    await rejection;
    expect(wasAborted).toBe(true);
  });
  it("withholds a history response revoked while the storage read is running", async () => {
    const f = fixture();
    f.native.page.mockImplementationOnce(async () => {
      f.store.set(f.owner.token, "chat-a", f.reader.user.email, null);
      return { records: [] };
    });
    await expect(
      f.transport.page(
        f.reader.token,
        { address: { kind: "session", sessionId: "chat-a" } } as never,
        signal(),
      ),
    ).rejects.toThrow();
  });
});
