import type { Context } from "@deepseek-ai/cordis";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import type { SessionControlFrame, SessionFollowFrame, SessionFollowRequest,
  SessionPageRequest, SessionPage, SessionListValue, SessionProjectionsValue,
  SessionPromptRequest, SessionPromptValue, SessionAttachmentRequest, SessionAttachmentValue,
  SessionRenameRequest, SessionRenameValue, SessionCancelValue, SessionUpdateQueueRequest,
  SessionUpdateQueueValue, SessionAddress, SessionSearchRequest, SessionSearchValue,
  SessionSelectModelRequest, SessionSelectModelValue } from "@deepseek-ai/dsh-api-session-controller/types";
import type { QaChatSharingStore } from "./store.js";
import type { SessionEventEntry } from "@deepseek-ai/dsh-api-session-controller/types";

/** Durable access is checked before and after asynchronous reads and per frame. */
export class QaChatTransport {
  private readonly locks = new Map<string, Promise<unknown>>();
  constructor(private readonly ctx: Context, private readonly store: () => QaChatSharingStore,
    private readonly admit: (token: string, id: string) => Promise<unknown>,
    private readonly participantPolicy?: (userId: string, id: string) => Promise<unknown>) {}

  async list(token: string, signal: AbortSignal): Promise<SessionListValue> {
    this.store().visible(token);
    const value = await this.ctx.sessionController.list({}, signal);
    const allowed = new Set(this.store().visible(token).map(item => item.sessionId));
    const owned = new Set(this.store().visible(token).filter(item => item.mode === "owner").map(item => item.sessionId));
    for (let count = 0; count < value.items.length; count++) {
      let changed = false;
      for (const item of value.items) if (item.origin === "subagent" && item.parentSessionId !== undefined &&
        owned.has(String(item.parentSessionId)) && !owned.has(String(item.sessionId))) {
        owned.add(String(item.sessionId)); allowed.add(String(item.sessionId)); changed = true;
      }
      if (!changed) break;
    }
    return { items: value.items.filter(item => allowed.has(String(item.sessionId))) };
  }

  async page(token: string, request: SessionPageRequest, signal: AbortSignal): Promise<SessionPage> {
    const access = await this.addressAccess(token, request.address, signal);
    const value = await this.ctx.sessionController.page(request, signal);
    this.store().revalidate(token, access);
    return { ...value, records: value.records.map(record => this.signRecord(token, access.sessionId, record)) };
  }

  async search(token: string, request: SessionSearchRequest, signal: AbortSignal): Promise<SessionSearchValue> {
    await this.list(token, signal);
    const value = await this.ctx.sessionController.search(request, signal);
    const allowed = new Set((await this.list(token, signal)).items.map(item => String(item.sessionId)));
    return { items: value.items.filter(item => allowed.has(String(item.sessionId))), hasMore: false };
  }

  async projections(token: string, id: string, signal: AbortSignal): Promise<SessionProjectionsValue> {
    const access = await this.sessionAccess(token, id, signal);
    const value = await this.ctx.sessionController.projections({ sessionId: SessionId(id) }, signal);
    this.store().revalidate(token, access);
    return value;
  }

  async *follow(token: string, request: SessionFollowRequest, signal: AbortSignal): AsyncIterable<SessionFollowFrame> {
    const access = await this.addressAccess(token, request.address, signal);
    const id = access.sessionId;
    const abort = new AbortController();
    const onAbort = () => abort.abort(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    const poll = setInterval(() => {
      try { this.store().revalidate(token, access); }
      catch (error) { abort.abort(error); }
    }, 250);
    poll.unref();
    try {
      for await (const frame of this.ctx.sessionController.follow(request, abort.signal)) {
        this.store().revalidate(token, access);
        yield frame.type === "snapshot" ? { ...frame, records: frame.records.map(record => this.signRecord(token, id, record)) }
          : frame.type === "event" ? this.signRecord(token, id, frame) : frame;
      }
    } finally { clearInterval(poll); signal.removeEventListener("abort", onAbort); abort.abort(); }
  }

  async *control(token: string, signal: AbortSignal): AsyncIterable<SessionControlFrame> {
    // Polling a bounded catalog also surfaces grants/revocations on idle chats.
    // No native Host-wide baseline or delta is exposed to a QA account.
    while (!signal.aborted) {
      const listing = await this.list(token, signal);
      const projections: Record<string, NonNullable<SessionProjectionsValue>> = {};
      for (const item of listing.items) {
        try { const value = await this.projections(token, String(item.sessionId), signal);
          if (value !== null) projections[String(item.sessionId)] = value; } catch { /* revoked between reads */ }
      }
      yield { type: "baseline", value: { projections } };
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
        const timer = setTimeout(done, 1000); timer.unref();
        signal.addEventListener("abort", done, { once: true });
        if (signal.aborted) done();
      });
    }
  }

  /** Queue admission is serialized, rechecked after resume, and signed before insertion. */
  async prompt(token: string, request: SessionPromptRequest, signal: AbortSignal): Promise<SessionPromptValue> {
    return this.serial(String(request.sessionId), async () => {
      const access = this.store().write(token, String(request.sessionId));
      if (access.mode !== "owner" && request.mode !== "queue") throw new Error("Only the owner may steer a chat.");
      if (access.mode !== "owner" && request.content.some(part => part.type === "text" && /^\s*\//u.test(part.text)))
        throw new Error("Only the owner may run chat skills or commands.");
      const prior = this.store().requestActor(access.sessionId, String(request.requestId));
      if (prior !== undefined) {
        if (prior.userId !== access.actorId) throw new Error("Prompt identity belongs to another participant.");
        if (prior.revision !== null && prior.revision !== access.revision) throw new Error("Prompt access has changed.");
      }
      await this.admit(token, access.sessionId);
      if (access.mode === "collaborate") await this.participantPolicy?.(access.actorId, access.sessionId);
      signal.throwIfAborted();
      this.store().revalidate(token, access);
      const session = this.ctx.sessions?.get(SessionId(access.sessionId));
      const historicalRequest = session?.snapshotEvents().some(event => event.type === "user/message" &&
        "rpcId" in event.data.source && String(event.data.source.rpcId) === String(request.requestId));
      const agent = this.ctx.agents?.get(SessionId(access.sessionId));
      const pendingRequest = [...(agent?.inbox.nextTurn ?? []), ...(agent?.inbox.nextStep ?? [])].some(message =>
        "rpcId" in message.source && String(message.source.rpcId) === String(request.requestId));
      if (prior === undefined && (historicalRequest || pendingRequest)) {
        if (access.mode !== "owner") throw new Error("Prompt identity belongs to the original author.");
        return this.ctx.sessionController.prompt(request, signal);
      }
      if (prior === undefined) this.store().recordAuthor(token, access, String(request.requestId));
      const value = await this.ctx.sessionController.prompt(request, signal);
      this.store().revalidate(token, access);
      return value;
    });
  }

  async attachment(token: string, request: SessionAttachmentRequest): Promise<SessionAttachmentValue> {
    const access = await this.sessionAccess(token, String(request.sessionId), new AbortController().signal);
    const value = await this.ctx.sessionController.attachment(request);
    this.store().revalidate(token, access);
    return value;
  }

  async rename(token: string, request: SessionRenameRequest): Promise<SessionRenameValue> {
    return this.ownerOperation(token, String(request.sessionId), () => this.ctx.sessionController.rename(request));
  }
  async selectModel(token: string, request: SessionSelectModelRequest): Promise<SessionSelectModelValue> {
    return this.ownerOperation(token, String(request.sessionId), () => this.ctx.sessionController.selectModel(request));
  }
  async cancel(token: string, id: string): Promise<SessionCancelValue> {
    return this.ownerOperation(token, id, () => this.ctx.sessionController.cancel({ sessionId: SessionId(id) }));
  }
  async updateQueue(token: string, request: SessionUpdateQueueRequest): Promise<SessionUpdateQueueValue> {
    return this.ownerOperation(token, String(request.sessionId), () => this.ctx.sessionController.updateQueue(request));
  }
  private async ownerOperation<T>(token: string, id: string, operation: () => T | Promise<T>): Promise<T> {
    return this.serial(id, async () => { const access = this.store().owner(token, id);
      await this.admit(token, id); this.store().revalidate(token, access); return operation(); });
  }
  private async serial<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.locks.set(id, next);
    try { return await next; } finally { if (this.locks.get(id) === next) this.locks.delete(id); }
  }
  private async sessionAccess(token: string, id: string, signal: AbortSignal) {
    try { return this.store().access(token, id); } catch {
      // A delegated child carries no membership of its own. Resolve its
      // authoritative lineage and require the root owner, never a participant.
      this.store().visible(token);
      const listing = await this.ctx.sessionController.list({}, signal);
      const rows = new Map(listing.items.map(item => [String(item.sessionId), item]));
      const seen = new Set<string>(); let current = id;
      while (true) {
        if (seen.has(current)) throw new Error("Chat access is unavailable."); seen.add(current);
        const row = rows.get(current);
        if (row?.origin !== "subagent" || row.parentSessionId === undefined) break;
        current = String(row.parentSessionId);
      }
      if (current === id) throw new Error("Chat access is unavailable.");
      return this.store().owner(token, current);
    }
  }
  private async addressAccess(token: string, address: SessionAddress, signal: AbortSignal) {
    const access = await this.sessionAccess(token, String(address.kind === "session" ? address.sessionId : address.parentSessionId), signal);
    if (address.kind === "subagent" && access.mode !== "owner") throw new Error("Only the root owner may inspect a delegated session.");
    return access;
  }
  private signRecord(token: string, id: string, record: SessionEventEntry): SessionEventEntry {
    if (record.event.type !== "user/message") return record;
    const data = record.event.data as unknown as { source?: { rpcId?: string } };
    const source = data.source;
    const author = this.store().authors(token, id).find(item => item.requestId === source?.rpcId)?.displayName
      ?? this.store().access(token, id).ownerName;
    if (source === undefined) return record;
    return { ...record, event: { ...record.event, data: {
      ...data, source: { ...source, qaAuthor: author },
    } as unknown as SessionEventEntry["event"]["data"] } };
  }
}
