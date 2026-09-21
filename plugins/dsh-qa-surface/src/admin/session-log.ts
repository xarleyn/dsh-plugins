import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { SessionId } from "@deepseek-ai/dsh-session";
import type { QaTranscriptUnavailableReason } from "../types.js";
import type { StoredSessionEvent } from "./conversation-log.js";

/**
 * Read access to the deployment's conversations.
 *
 * Two sources, because neither alone is complete:
 *
 * - Durable storage (`ctx.sessionQuery`) owns history — every conversation a
 *   deployment ever had, including the ones this process never opened. Its
 *   concrete backend is a deployment choice, so the service is read off the
 *   context at call time and described structurally: the QA bundle must keep
 *   loading on a deployment that serves no query engine.
 * - The live session store (`ctx.sessions`) owns the chats running right now.
 *   It is the one source that always exists, and it is what a chat becomes the
 *   moment its first message is appended.
 *
 * Reads never throw for an unavailable backend: the caller gets a reason, so
 * the review viewer can say why a transcript is missing instead of failing the
 * whole page.
 */

export interface QaStoredSessionHeader {
  readonly id: string;
  /** Epoch milliseconds, as the session header records it. */
  readonly createdAt: number;
  readonly cwd?: string;
  /** Set on a subagent's session; such sessions are not conversations. */
  readonly parentSessionId?: string;
  readonly agentPreset?: string;
}

export type QaSessionReadResult =
  | { readonly ok: true; readonly events: readonly StoredSessionEvent[] }
  | { readonly ok: false; readonly reason: QaTranscriptUnavailableReason };

/**
 * One listing of the deployment's sessions together with what the answer
 * covers. The distinction is load-bearing: on a deployment that serves no
 * durable query engine the listing is only what this process has open, and a
 * chat nobody opened since the last restart is absent from it without being
 * gone.
 */
export interface QaSessionListing {
  readonly headers: readonly QaStoredSessionHeader[];
  /**
   * True when the listing answers for every stored session, not only the live
   * ones. A consumer that must never read "absent" as "deleted" — the
   * ownership sweep — reclaims nothing against an incomplete listing.
   */
  readonly complete: boolean;
}

export interface QaSessionLogReader {
  list(): Promise<QaSessionListing>;
  read(sessionId: string): Promise<QaSessionReadResult>;
  /**
   * Whether the Harness holds this session in memory right now. Such a session
   * is still being written: storage removal cannot take it away, because the
   * next flush would put its log back.
   */
  live(sessionId: string): boolean;
  /**
   * The events of a session this process is holding, without touching storage.
   *
   * This is a *probe*, not a read: it never fails and never waits, and
   * `undefined` means only that this process does not hold the session — not
   * that the session has no log. What it is good for is the one question a
   * warm reader has to ask on every page: has anything been appended since the
   * seq I already projected? A session the Harness holds is appended in this
   * process, so its in-memory events answer that without a stored read, and
   * the answer is strictly *newer* than what storage has flushed.
   *
   * `after` is that cursor: events at or below it are not materialized, so a
   * reader that already knows a prefix pays for the pass over the session's
   * event references and not for the events it has already seen. The snapshot
   * can still be partial (a session that existed in an earlier run of the
   * process, or a long one), which is why a caller may use it to extend what it
   * already knows and never to replace it.
   */
  snapshot(
    sessionId: string,
    options?: { readonly after?: number | undefined },
  ): readonly StoredSessionEvent[] | undefined;
}

/** What one storage-removal call did, id by id. */
export interface QaSessionEraseOutcome {
  /** Ids whose stored directories were removed. */
  readonly removed: readonly string[];
  /**
   * Ids with no stored directory to remove: the session is already gone, or
   * this deployment keeps it somewhere directories cannot express.
   */
  readonly absent: readonly string[];
}

/**
 * Removal of stored sessions.
 *
 * The Harness has no deletion seam: `sessionPersistence` offers
 * create/open/flush/stat/list, and the in-memory store drops a session only
 * when the fiber that owns it disposes. A deployment that wants a conversation
 * to stop existing therefore has to remove the artifacts storage keeps, which
 * for the directory-backed backend means the session directories under the
 * home. Implementations report what they could not do instead of guessing.
 */
export interface QaStoredSessionEraser {
  erase(sessionIds: readonly string[]): Promise<QaSessionEraseOutcome>;
}

/**
 * The durable query engine as this package consumes it. Described structurally
 * on purpose (see the module comment): the harness service is optional here,
 * and pinning its package would force every deployment to install a query
 * backend the admin console can live without.
 */
interface SessionQueryLike {
  listSessions(): Promise<readonly { readonly header: unknown }[]>;
  readSession(sessionId: string): Promise<{ readonly events: unknown }>;
}

interface SessionLike {
  readonly id: unknown;
  readonly header: { readonly createdAt?: unknown };
  snapshotEvents(): readonly unknown[];
}

interface SessionStoreLike {
  list(): readonly SessionLike[];
  get(id: SessionId): SessionLike | undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** One parent reference, whichever shape the header version stores it in. */
function parentIdOf(value: unknown): string | undefined {
  const direct = string(value);
  if (direct !== undefined) return direct;
  const nested = record(value);
  return string(nested?.id) ?? string(nested?.sessionId);
}

function headerOf(header: unknown): QaStoredSessionHeader | undefined {
  const entry = record(header);
  if (entry === undefined) return undefined;
  const id = string(entry.id);
  const createdAt = entry.createdAt;
  if (id === undefined || typeof createdAt !== "number") return undefined;
  const cwd = string(entry.cwd);
  const parentSessionId = parentIdOf(entry.parentSession);
  const agentPreset = string(entry.agentPreset);
  return {
    id,
    createdAt,
    ...(cwd === undefined ? {} : { cwd }),
    ...(parentSessionId === undefined ? {} : { parentSessionId }),
    ...(agentPreset === undefined ? {} : { agentPreset }),
  };
}

/** One event read back from storage, in the shape the projector consumes. */
function eventOf(value: unknown): StoredSessionEvent | undefined {
  const entry = record(value);
  if (entry === undefined) return undefined;
  const seq = entry.seq;
  const type = string(entry.type);
  if (typeof seq !== "number" || type === undefined) return undefined;
  return {
    seq,
    type,
    data: entry.data,
    ...(typeof entry.time === "number" ? { time: entry.time } : {}),
  };
}

/**
 * Build the reader for one plugin instance. The services are looked up per
 * call rather than captured: a cordis provider is only visible once its fiber
 * is active, and a reference taken at construction time would stay dead.
 */
export function createSessionLogReader(ctx: Context): QaSessionLogReader {
  const sessions = (): SessionStoreLike | undefined =>
    (ctx as unknown as { get(name: string): unknown }).get("sessions") as
      SessionStoreLike | undefined;

  const query = (): SessionQueryLike | undefined =>
    (ctx as unknown as { get(name: string): unknown }).get("sessionQuery") as
      SessionQueryLike | undefined;

  const liveList = (): readonly QaStoredSessionHeader[] => {
    const store = sessions();
    if (store === undefined) return [];
    return store
      .list()
      .map((session) => headerOf(session.header))
      .filter(
        (header): header is QaStoredSessionHeader => header !== undefined,
      );
  };

  /**
   * The holding session's events, materialized only above `after`.
   *
   * The raw events are opaque here, so the cursor is tested on the raw `seq`
   * before an event is turned into the shape a projector consumes: a probe that
   * is asked for what was appended after a seq allocates for that suffix and
   * not for the conversation.
   */
  const snapshotOf = (
    sessionId: string,
    after: number | undefined,
  ): readonly StoredSessionEvent[] | undefined => {
    const store = sessions();
    if (store === undefined) return undefined;
    const session = store.get(sessionId as SessionId);
    if (session === undefined) return undefined;
    const events: StoredSessionEvent[] = [];
    for (const value of session.snapshotEvents()) {
      const seq = record(value)?.seq;
      if (typeof seq !== "number") continue;
      if (after !== undefined && seq <= after) continue;
      const event = eventOf(value);
      if (event !== undefined) events.push(event);
    }
    return events;
  };

  const liveRead = (sessionId: string): QaSessionReadResult | undefined => {
    if (sessions() === undefined) return undefined;
    const events = snapshotOf(sessionId, undefined);
    return events === undefined ? undefined : { ok: true, events };
  };

  return {
    live(sessionId: string): boolean {
      return sessions()?.get(sessionId as SessionId) !== undefined;
    },

    async list(): Promise<QaSessionListing> {
      const engine = query();
      if (engine === undefined) {
        return { headers: liveList(), complete: false };
      }
      try {
        const records = await engine.listSessions();
        const stored = records
          .map((entry) => headerOf(entry.header))
          .filter(
            (header): header is QaStoredSessionHeader => header !== undefined,
          );
        const seen = new Set(stored.map(({ id }) => id));
        // A chat that has just been created exists live before its first
        // durable flush; without this merge it would be invisible to the
        // admin console for the length of the turn.
        return {
          headers: [...stored, ...liveList().filter(({ id }) => !seen.has(id))],
          complete: true,
        };
      } catch {
        // The engine failed this once, so it answers for nothing: the live
        // list is not a complete view, and the caller must be told that.
        return { headers: liveList(), complete: false };
      }
    },

    snapshot(
      sessionId: string,
      options?: { readonly after?: number | undefined },
    ): readonly StoredSessionEvent[] | undefined {
      return snapshotOf(sessionId, options?.after);
    },

    async read(sessionId: string): Promise<QaSessionReadResult> {
      const engine = query();
      if (engine !== undefined) {
        try {
          const snapshot = await engine.readSession(sessionId);
          const events = (Array.isArray(snapshot.events) ? snapshot.events : [])
            .map(eventOf)
            .filter(
              (event): event is StoredSessionEvent => event !== undefined,
            );
          if (events.length > 0) return { ok: true, events };
        } catch {
          // A log this reader cannot parse (an event type it does not know)
          // reaches the reviewer as "unreadable" rather than as a broken page.
          return { ok: false, reason: "unreadable" };
        }
      }
      const live = liveRead(sessionId);
      if (live !== undefined) return live;
      return { ok: false, reason: "not-found" };
    },
  };
}

/** A reader over an explicit set of logs; the tests' seam, and the empty default. */
export function staticSessionLogReader(input: {
  readonly sessions?: readonly QaStoredSessionHeader[];
  readonly events?: Readonly<Record<string, readonly StoredSessionEvent[]>>;
  /**
   * Whether the listed sessions are the fixture's whole world. True by
   * default — a fixture that names its sessions means them to be all of them;
   * pass false to stand for a live-only view of a larger deployment.
   */
  readonly complete?: boolean;
  /** Ids the fixture's Harness still holds open. */
  readonly held?: readonly string[];
}): QaSessionLogReader {
  const held = new Set(input.held ?? []);
  return {
    live(sessionId: string) {
      return held.has(sessionId);
    },
    snapshot(
      sessionId: string,
      options?: { readonly after?: number | undefined },
    ) {
      if (!held.has(sessionId)) return undefined;
      const events = input.events?.[sessionId] ?? [];
      const after = options?.after;
      return after === undefined
        ? events
        : events.filter((event) => event.seq > after);
    },
    async list() {
      return {
        headers: input.sessions ?? [],
        complete: input.complete ?? true,
      };
    },
    async read(sessionId: string) {
      const events = input.events?.[sessionId];
      return events === undefined
        ? { ok: false, reason: "not-found" }
        : { ok: true, events };
    },
  };
}

/**
 * The stored sessions of a directory-backed deployment: one directory per
 * session under `<home>/sessions/<project>/<sessionId>`, named by the id the
 * header carries. The home follows the same convention as the deployment's
 * other stores (`DSH_HOME`, then the working directory).
 *
 * Removal is by directory name and never by guessing a project key: the id is
 * what the caller knows, and the directory either exists under one of the
 * projects or does not exist at all.
 */
export function createSessionEraser(home?: string): QaStoredSessionEraser {
  const root = (): string =>
    path.join(
      home ?? process.env.DSH_HOME?.trim() ?? process.cwd(),
      "sessions",
    );

  return {
    async erase(sessionIds: readonly string[]): Promise<QaSessionEraseOutcome> {
      const removed: string[] = [];
      const absent: string[] = [];
      const rootPath = root();
      const projects = existsSync(rootPath)
        ? readdirSync(rootPath, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(rootPath, entry.name))
        : [];
      for (const sessionId of sessionIds) {
        // An id is a harness-minted token and the directory it names is its
        // last path segment. Requiring exactly that — and a location inside
        // the sessions root — means an empty string, a traversal or a path
        // names nothing, instead of naming some other directory to remove.
        const directory = projects
          .map((project) => path.resolve(project, sessionId))
          .filter(
            (candidate) =>
              candidate.startsWith(`${rootPath}${path.sep}`) &&
              path.basename(candidate) === sessionId,
          )
          .find((candidate) => existsSync(candidate));
        if (directory === undefined) {
          absent.push(sessionId);
          continue;
        }
        rmSync(directory, { recursive: true, force: true });
        removed.push(sessionId);
      }
      return { removed, absent };
    },
  };
}
